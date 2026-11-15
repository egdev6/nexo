use super::{ExecutableFs, validate_executable};
use crate::config::{ConfigLock, Store};

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
    executable: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    duplicate_of: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum LocalState {
    Ready,
    MissingExecutable,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum LocalOrigin {
    Manual { id: String },
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

pub(super) fn list(
    store: &Store,
    lock: &ConfigLock,
    fs: &impl ExecutableFs,
    official: &[OfficialCandidate],
    icon: &impl Fn(&str) -> Option<String>,
) -> Result<Vec<LocalRow>, String> {
    let settings = lock.with_store(store, |store| store.local_settings())?;
    let mut rows: Vec<LocalRow> = settings
        .local_apps
        .iter()
        .map(|app| LocalRow {
            id: format!("local:manual:{}", encoded(&app.id)),
            source: "local",
            name: app.name.clone(),
            state: if validate_executable(fs, &app.executable).is_ok() {
                LocalState::Ready
            } else {
                LocalState::MissingExecutable
            },
            origin: LocalOrigin::Manual { id: app.id.clone() },
            icon_path: app.icon.as_deref().and_then(icon),
            executable: app.executable.clone(),
            duplicate_of: None,
        })
        .collect();
    lock.with_store(store, |store| {
        let current = store.local_settings()?;
        if current.sources != settings.sources || current.local_apps != settings.local_apps {
            return Err("nexo.local.refused".into());
        }
        Ok(())
    })?;
    let duplicates: Vec<Option<String>> = rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            let matches = |name: &str, other: Option<&str>| {
                same_name(&row.name, name)
                    || other.is_some_and(|other| same_path(&row.executable, other))
            };
            official
                .iter()
                .find(|other| matches(&other.name, other.executable.as_deref()))
                .map(|other| other.id.clone())
                .or_else(|| {
                    rows.iter()
                        .enumerate()
                        .find(|(other_index, other)| {
                            *other_index != index && matches(&other.name, Some(&other.executable))
                        })
                        .map(|(_, other)| other.id.clone())
                })
        })
        .collect();
    for (row, duplicate) in rows.iter_mut().zip(duplicates) {
        row.duplicate_of = duplicate;
    }
    Ok(rows)
}

#[cfg(test)]
#[path = "projection_tests.rs"]
mod tests;
