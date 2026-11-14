//! Icons are selected locally and copied into an owned directory. No path from
//! the webview is accepted, and only generated basenames can be cleaned up.
use super::{ExecutableFs, FileKind, FsError, Selection, entry_index, selection};
use crate::config::Store;
use serde_json::json;

pub(super) const MAX_ICON_BYTES: usize = 512 * 1024;

pub(super) trait IconPicker {
    fn pick_icon(&self) -> Result<Option<String>, String>;
}

pub(super) trait IconFs: ExecutableFs {
    /// Implementations must limit reads to MAX_ICON_BYTES + 1 bytes.
    fn read_icon(&self, path: &str) -> Result<Vec<u8>, String>;
    /// Create a new owned file, never overwriting an existing file.
    fn save_icon(&self, bytes: &[u8], extension: &str) -> Result<String, String>;
    fn delete_icon(&self, name: &str) -> Result<(), String>;
}

// Only fixed-disk, absolute paths without reparse points are read. As with
// executable selection, do not canonicalize through links or access a UNC path.
fn selected_file(fs: &impl ExecutableFs, path: &str) -> Result<(String, &'static str), String> {
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
    let file = parts.last().expect("split has a component");
    let extension = match file.rsplit_once('.') {
        Some((stem, ext)) if !stem.trim().is_empty() && ext.eq_ignore_ascii_case("png") => "png",
        Some((stem, ext)) if !stem.trim().is_empty() && ext.eq_ignore_ascii_case("ico") => "ico",
        _ => return Err("nexo.local.invalidIcon".into()),
    };
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
            Err(FsError::Refused) | Ok(FileKind::Reparse) => {
                return Err("nexo.local.refused".into());
            }
            Ok(FileKind::Directory) if index + 1 == parts.len() => {
                return Err("nexo.local.invalidIcon".into());
            }
            Ok(FileKind::File) if index + 1 != parts.len() => {
                return Err("nexo.local.refused".into());
            }
            Ok(FileKind::Directory | FileKind::File) => {}
        }
    }
    Ok((path, extension))
}

fn managed_name(name: &str) -> bool {
    let Some((stem, extension)) = name.rsplit_once('.') else {
        return false;
    };
    let Some(id) = stem.strip_prefix("icon-") else {
        return false;
    };
    !id.is_empty()
        && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        && matches!(extension, "png" | "ico")
}

fn delete_owned(fs: &impl IconFs, name: Option<&str>) -> Result<(), String> {
    if let Some(name) = name.filter(|name| managed_name(name)) {
        fs.delete_icon(name)?;
    }
    Ok(())
}

pub(super) fn pick_icon(
    store: &Store,
    fs: &impl IconFs,
    picker: &impl IconPicker,
    id: &str,
) -> Result<Option<Selection>, String> {
    let Some(path) = picker.pick_icon()? else {
        return Ok(None);
    };
    let (path, extension) = selected_file(fs, &path)?;
    let bytes = fs.read_icon(&path)?;
    let valid = match extension {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "ico" => bytes.len() >= 6 && bytes.starts_with(b"\0\0\x01\0") && bytes[4..6] != [0, 0],
        _ => false,
    };
    if bytes.len() > MAX_ICON_BYTES || !valid {
        return Err("nexo.local.invalidIcon".into());
    }
    let name = fs.save_icon(&bytes, extension)?;
    if !managed_name(&name) {
        return Err("nexo.local.iconWriteFailed".into());
    }
    let saved = store.mutate_local_apps(|entries, settings| {
        let index = entry_index(entries, settings, id)?;
        let mut app = settings
            .local_apps
            .iter()
            .find(|app| app.id == id)
            .expect("entry checked")
            .clone();
        let old = app.icon.replace(name.clone());
        let unshared = old.filter(|old| {
            !settings
                .local_apps
                .iter()
                .any(|other| other.id != id && other.icon.as_ref() == Some(old))
        });
        entries[index]
            .as_object_mut()
            .ok_or("nexo.local.refused")?
            .insert("icon".into(), json!(name));
        Ok((selection(app, settings), unshared))
    });
    match saved {
        Ok((selected, old)) => {
            if let Err(error) = delete_owned(fs, old.as_deref()) {
                eprintln!("could not clean up replaced local icon: {error}");
            }
            Ok(Some(selected))
        }
        Err(error) => {
            delete_owned(fs, Some(&name)).map_err(|cleanup| format!("{error}; {cleanup}"))?;
            Err(error)
        }
    }
}

pub(super) fn remove_with_icon(store: &Store, fs: &impl IconFs, id: &str) -> Result<(), String> {
    let settings = store.local_settings()?;
    let icon = settings
        .local_apps
        .iter()
        .find(|app| app.id == id)
        .and_then(|app| app.icon.as_deref());
    let unshared = icon.filter(|icon| {
        !settings
            .local_apps
            .iter()
            .any(|other| other.id != id && other.icon.as_deref() == Some(*icon))
    });
    super::remove(store, id)?;
    if let Err(error) = delete_owned(fs, unshared) {
        eprintln!("could not clean up removed local icon: {error}");
    }
    Ok(())
}

#[cfg(test)]
#[path = "icons_tests.rs"]
mod tests;
