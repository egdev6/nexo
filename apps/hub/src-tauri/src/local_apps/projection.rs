use super::{ExecutableFs, validate_executable};
use crate::config::{ConfigLock, Settings, Source, Store};
use crate::local_catalog::{LocalCatalogSnapshot, RefreshFence};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OfficialCandidate {
    pub id: String,
    pub name: String,
    pub executable: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRow {
    id: String,
    source: &'static str,
    name: String,
    state: LocalState,
    origin: LocalOrigin,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duplicate_of: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tagline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tags: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum LocalState {
    Ready,
    MissingExecutable,
    Unbound,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum LocalOrigin {
    Manual {
        id: String,
    },
    Catalog {
        source_id: String,
        source_label: String,
        app_id: String,
    },
}

fn encoded(value: &str) -> String {
    use std::fmt::Write;
    let mut output = String::new();
    for byte in value.bytes() {
        write!(&mut output, "{byte:02x}").expect("writing to a string cannot fail");
    }
    output
}

fn same_name(left: &str, right: &str) -> bool {
    left.trim().to_lowercase() == right.trim().to_lowercase()
}

fn same_path(left: &str, right: &str) -> bool {
    let normalized = |path: &str| {
        let path = path.replace('/', "\\");
        path.strip_prefix("\\\\?\\").unwrap_or(&path).to_lowercase()
    };
    normalized(left) == normalized(right)
}

fn state(fs: &impl ExecutableFs, executable: Option<&str>) -> LocalState {
    match executable {
        None => LocalState::Unbound,
        Some(path) if validate_executable(fs, path).is_ok() => LocalState::Ready,
        Some(_) => LocalState::MissingExecutable,
    }
}

fn snapshots(settings: &Settings, fence: &RefreshFence) -> Vec<(Source, LocalCatalogSnapshot)> {
    settings
        .sources
        .iter()
        .filter(|source| source.kind == "local")
        .filter_map(|source| {
            fence
                .current(&source.id)
                .and_then(Result::ok)
                .map(|snapshot| (source.clone(), snapshot))
        })
        .collect()
}

pub(super) fn list(
    store: &Store,
    lock: &ConfigLock,
    fs: &impl ExecutableFs,
    fence: &RefreshFence,
    official: &[OfficialCandidate],
    icon: &impl Fn(&str) -> Option<String>,
) -> Result<Vec<LocalRow>, String> {
    let (settings, source_snapshots) = lock.with_store(store, |store| {
        let settings = store.local_settings()?;
        let source_snapshots = snapshots(&settings, fence);
        Ok((settings, source_snapshots))
    })?;
    let expected_snapshots = source_snapshots.clone();
    let mut rows: Vec<(LocalRow, Option<String>)> = Vec::new();
    for app in &settings.local_apps {
        rows.push((
            LocalRow {
                id: format!("local:manual:{}", encoded(&app.id)),
                source: "local",
                name: app.name.clone(),
                state: state(fs, Some(&app.executable)),
                origin: LocalOrigin::Manual { id: app.id.clone() },
                icon_path: app.icon.as_deref().and_then(icon),
                duplicate_of: None,
                tagline: None,
                description: None,
                tags: None,
            },
            Some(app.executable.clone()),
        ));
    }
    for (source, snapshot) in source_snapshots {
        for entry in snapshot.entries {
            let executable = settings
                .local_bindings
                .iter()
                .find(|binding| {
                    binding.source_id == entry.key.source_id && binding.app_id == entry.key.app_id
                })
                .map(|binding| binding.executable.clone());
            rows.push((
                LocalRow {
                    id: format!(
                        "local:catalog:{}:{}",
                        encoded(&entry.key.source_id),
                        encoded(&entry.key.app_id)
                    ),
                    source: "local",
                    name: entry.name,
                    state: state(fs, executable.as_deref()),
                    origin: LocalOrigin::Catalog {
                        source_id: entry.key.source_id,
                        source_label: source.label.clone(),
                        app_id: entry.key.app_id,
                    },
                    icon_path: None,
                    duplicate_of: None,
                    tagline: Some(entry.tagline),
                    description: Some(entry.description),
                    tags: Some(entry.tags),
                },
                executable,
            ));
        }
    }
    lock.with_store(store, |store| {
        let current = store.local_settings()?;
        if current.sources != settings.sources
            || current.local_apps != settings.local_apps
            || current.local_bindings != settings.local_bindings
            || snapshots(&current, fence) != expected_snapshots
        {
            return Err("nexo.local.refused".into());
        }
        Ok(())
    })?;
    let duplicates: Vec<Option<String>> = rows
        .iter()
        .enumerate()
        .map(|(index, (row, executable))| {
            let matches = |name: &str, other: Option<&str>| {
                same_name(&row.name, name)
                    || executable
                        .as_deref()
                        .zip(other)
                        .is_some_and(|(left, right)| same_path(left, right))
            };
            official
                .iter()
                .find(|other| matches(&other.name, other.executable.as_deref()))
                .map(|other| other.id.clone())
                .or_else(|| {
                    rows.iter()
                        .enumerate()
                        .find(|(other_index, (other, path))| {
                            *other_index != index && matches(&other.name, path.as_deref())
                        })
                        .map(|(_, (other, _))| other.id.clone())
                })
        })
        .collect();
    Ok(rows
        .into_iter()
        .zip(duplicates)
        .map(|((mut row, _), duplicate)| {
            row.duplicate_of = duplicate;
            row
        })
        .collect())
}

#[cfg(test)]
#[path = "projection_tests.rs"]
mod tests;
