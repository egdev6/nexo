//! Native operations for user-selected local catalogs. No catalog URL is read.
//! Source reads and parsing happen outside the settings lock; source identity and
//! refresh tickets are checked again under that lock before publishing or saving.
use super::{ExecutableFs, FileKind, FsError, Launcher, Picker, validate_executable};
use crate::config::{ConfigLock, LocalBinding, Settings, Source, Store};
use crate::local_catalog::{
    LocalCatalogError, LocalCatalogReader, LocalCatalogSnapshot, LocalEntryKey, RefreshFence,
    read_local_catalog,
};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

pub(super) trait CatalogPicker {
    fn pick_catalog(&self) -> Result<Option<String>, String>;
}

fn catalog_path(fs: &impl ExecutableFs, path: &str) -> Result<String, String> {
    let path = path.replace('/', "\\");
    let bytes = path.as_bytes();
    if bytes.len() < 4 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' {
        return Err("nexo.local.refused".into());
    }
    let parts: Vec<&str> = path[3..].split('\\').collect();
    if parts.iter().any(|part| {
        part.is_empty()
            || *part == "."
            || *part == ".."
            || part.ends_with([' ', '.'])
            || part
                .chars()
                .any(|c| c.is_control() || "<>:\"|?*".contains(c))
    }) {
        return Err("nexo.local.refused".into());
    }
    if !parts
        .last()
        .and_then(|part| part.rsplit_once('.'))
        .is_some_and(|(stem, ext)| !stem.trim().is_empty() && ext.eq_ignore_ascii_case("json"))
    {
        return Err("nexo.local.refused".into());
    }
    let mut current = path[..3].to_owned();
    if !fs.fixed_disk(&current) {
        return Err("nexo.local.refused".into());
    }
    match fs.inspect(&current) {
        Ok(FileKind::Directory) => {}
        Err(FsError::Missing) => return Err("nexo.local.missing".into()),
        _ => return Err("nexo.local.refused".into()),
    }
    for (index, part) in parts.iter().enumerate() {
        if index != 0 {
            current.push('\\');
        }
        current.push_str(part);
        match fs.inspect(&current) {
            Err(FsError::Missing) => return Err("nexo.local.missing".into()),
            Ok(FileKind::Directory) if index + 1 < parts.len() => {}
            Ok(FileKind::File) if index + 1 == parts.len() => {}
            _ => return Err("nexo.local.refused".into()),
        }
    }
    Ok(path)
}

fn error_code(error: LocalCatalogError) -> String {
    match error {
        LocalCatalogError::Unreadable => "nexo.local.catalogUnreadable",
        LocalCatalogError::Invalid => "nexo.local.catalogInvalid",
        LocalCatalogError::LaunchOnly => "nexo.local.catalogLaunchOnly",
    }
    .into()
}

fn source<'a>(settings: &'a Settings, id: &str) -> Result<&'a Source, String> {
    settings
        .sources
        .iter()
        .find(|source| source.id == id && source.kind == "local")
        .ok_or_else(|| "nexo.local.notFound".into())
}

fn selected_entries<'a>(
    map: &'a mut serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a mut Vec<Value>, String> {
    map.entry(key)
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or_else(|| "nexo.local.refused".into())
}

pub(super) fn set(
    store: &Store,
    lock: &ConfigLock,
    fs: &impl ExecutableFs,
    reader: &impl LocalCatalogReader,
    picker: &impl CatalogPicker,
    fence: &RefreshFence,
    source_id: Option<&str>,
) -> Result<Option<LocalCatalogSnapshot>, String> {
    let Some(path) = picker.pick_catalog()? else {
        return Ok(None);
    };
    let path = catalog_path(fs, &path)?;
    let (id, expected, ticket) = lock.with_store(store, |store| {
        let settings = store.local_settings()?;
        if let Some(id) = source_id {
            let expected = source(&settings, id)?.clone();
            Ok((
                id.to_owned(),
                Some(expected),
                Some(fence.begin_preserving(id)),
            ))
        } else {
            let id = loop {
                let nanos = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos();
                let id = format!(
                    "local-{nanos:x}-{:x}-{:x}",
                    std::process::id(),
                    super::NEXT_ID.fetch_add(1, Ordering::Relaxed)
                );
                if !settings.sources.iter().any(|source| source.id == id) {
                    break id;
                }
            };
            Ok((id, None, None))
        }
    })?;
    let snapshot = read_local_catalog(reader, &id, &path).map_err(error_code)?;
    lock.with_store(store, |store| {
        if ticket
            .as_ref()
            .is_some_and(|ticket| !fence.is_current(ticket))
        {
            return Err("nexo.local.refused".into());
        }
        store.mutate_local_catalog(|map, settings| {
            let replacing = expected.is_some();
            let changed = if let Some(expected) = &expected {
                let current = source(settings, &id)?;
                if current != expected {
                    return Err("nexo.local.refused".into());
                }
                current.location.as_deref() != Some(path.as_str())
            } else {
                if settings.sources.iter().any(|source| source.id == id) {
                    return Err("nexo.local.refused".into());
                }
                false
            };
            let sources = selected_entries(map, "sources")?;
            if replacing {
                let entry = sources
                    .iter_mut()
                    .find(|value| value.get("id").and_then(Value::as_str) == Some(&id))
                    .ok_or("nexo.local.notFound")?;
                entry
                    .as_object_mut()
                    .ok_or("nexo.local.refused")?
                    .insert("location".into(), json!(path));
            } else {
                sources.push(json!({"id":id,"label":"Local","kind":"local","location":path}));
            }
            if changed {
                selected_entries(map, "localBindings")?
                    .retain(|binding| binding.get("sourceId").and_then(Value::as_str) != Some(&id));
            }
            Ok(())
        })?;
        let ticket = ticket.unwrap_or_else(|| fence.begin(&id));
        fence.finish(ticket, Ok(snapshot.clone()));
        Ok(Some(snapshot))
    })
}

pub(super) fn refresh(
    store: &Store,
    lock: &ConfigLock,
    fs: &impl ExecutableFs,
    reader: &impl LocalCatalogReader,
    fence: &RefreshFence,
    source_id: &str,
) -> Result<LocalCatalogSnapshot, String> {
    let (expected, ticket) = lock.with_store(store, |store| {
        let settings = store.local_settings()?;
        Ok((
            source(&settings, source_id)?.clone(),
            fence.begin(source_id),
        ))
    })?;
    let result = expected
        .location
        .as_deref()
        .and_then(|path| catalog_path(fs, path).ok())
        .ok_or(LocalCatalogError::Unreadable)
        .and_then(|path| read_local_catalog(reader, source_id, &path));
    lock.with_store(store, |store| {
        let current = store
            .local_settings()
            .and_then(|settings| source(&settings, source_id).cloned());
        if current.as_ref() != Ok(&expected) {
            fence.finish(ticket, Err(LocalCatalogError::Unreadable));
            return Err(current.err().unwrap_or_else(|| "nexo.local.refused".into()));
        }
        if !fence.finish(ticket, result.clone()) {
            return Err("nexo.local.refused".into());
        }
        result.map_err(error_code)
    })
}

pub(super) fn clear(
    store: &Store,
    lock: &ConfigLock,
    fence: &RefreshFence,
    source_id: &str,
) -> Result<(), String> {
    lock.with_store(store, |store| {
        store.mutate_local_catalog(|map, settings| {
            source(settings, source_id)?;
            selected_entries(map, "sources")?
                .retain(|value| value.get("id").and_then(Value::as_str) != Some(source_id));
            selected_entries(map, "localBindings")?
                .retain(|value| value.get("sourceId").and_then(Value::as_str) != Some(source_id));
            Ok(())
        })?;
        fence.invalidate(source_id);
        Ok(())
    })
}

pub(super) fn bind(
    store: &Store,
    lock: &ConfigLock,
    fs: &impl ExecutableFs,
    reader: &impl LocalCatalogReader,
    picker: &impl Picker,
    fence: &RefreshFence,
    key: &LocalEntryKey,
) -> Result<Option<LocalBinding>, String> {
    let Some(path) = picker.pick_executable()? else {
        return Ok(None);
    };
    let executable = validate_executable(fs, &path)?;
    let snapshot = refresh(store, lock, fs, reader, fence, &key.source_id)?;
    if !snapshot.entries.iter().any(|entry| entry.key == *key) {
        return Err("nexo.local.notFound".into());
    }
    let binding = LocalBinding {
        source_id: key.source_id.clone(),
        app_id: key.app_id.clone(),
        executable,
    };
    lock.with_store(store, |store| {
        if fence.current(&key.source_id) != Some(Ok(snapshot)) {
            return Err("nexo.local.refused".into());
        }
        store.mutate_local_catalog(|map, settings| {
            source(settings, &key.source_id)?;
            let entries = selected_entries(map, "localBindings")?;
            let matches: Vec<usize> = entries
                .iter()
                .enumerate()
                .filter(|(_, value)| {
                    value.get("sourceId").and_then(Value::as_str) == Some(&key.source_id)
                        && value.get("appId").and_then(Value::as_str) == Some(&key.app_id)
                })
                .map(|(index, _)| index)
                .collect();
            match matches.as_slice() {
                [] => entries.push(json!(binding)),
                [index]
                    if settings
                        .local_bindings
                        .iter()
                        .any(|old| old.source_id == key.source_id && old.app_id == key.app_id) =>
                {
                    entries[*index]
                        .as_object_mut()
                        .ok_or("nexo.local.refused")?
                        .insert("executable".into(), json!(binding.executable));
                }
                _ => return Err("nexo.local.refused".into()),
            }
            Ok(Some(binding))
        })
    })
}

pub(super) fn unbind(store: &Store, lock: &ConfigLock, key: &LocalEntryKey) -> Result<(), String> {
    lock.with_store(store, |store| {
        store.mutate_local_catalog(|map, settings| {
            source(settings, &key.source_id)?;
            if !settings
                .local_bindings
                .iter()
                .any(|binding| binding.source_id == key.source_id && binding.app_id == key.app_id)
            {
                return Err("nexo.local.notFound".into());
            }
            let entries = selected_entries(map, "localBindings")?;
            let matches = entries
                .iter()
                .filter(|value| {
                    value.get("sourceId").and_then(Value::as_str) == Some(&key.source_id)
                        && value.get("appId").and_then(Value::as_str) == Some(&key.app_id)
                })
                .count();
            if matches != 1 {
                return Err("nexo.local.refused".into());
            }
            entries.retain(|value| {
                !(value.get("sourceId").and_then(Value::as_str) == Some(&key.source_id)
                    && value.get("appId").and_then(Value::as_str) == Some(&key.app_id))
            });
            Ok(())
        })
    })
}

pub(super) fn open(
    store: &Store,
    lock: &ConfigLock,
    fs: &impl ExecutableFs,
    reader: &impl LocalCatalogReader,
    launcher: &impl Launcher,
    fence: &RefreshFence,
    key: &LocalEntryKey,
) -> Result<(), String> {
    let snapshot = refresh(store, lock, fs, reader, fence, &key.source_id)?;
    if !snapshot.entries.iter().any(|entry| entry.key == *key) {
        return Err("nexo.local.notFound".into());
    }
    lock.with_store(store, |store| {
        if fence.current(&key.source_id) != Some(Ok(snapshot)) {
            return Err("nexo.local.refused".into());
        }
        let settings = store.local_settings()?;
        source(&settings, &key.source_id)?;
        let binding = settings
            .local_bindings
            .iter()
            .find(|binding| binding.source_id == key.source_id && binding.app_id == key.app_id)
            .ok_or("nexo.local.unbound")?;
        let executable = validate_executable(fs, &binding.executable)?;
        launcher.spawn(&executable)
    })
}

#[cfg(test)]
#[path = "catalog_tests.rs"]
mod tests;
