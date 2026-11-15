//! User-selected executables only. Paths never come from command arguments.
use crate::config::{LocalApp, Settings, Store};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FileKind {
    File,
    Directory,
    Reparse,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FsError {
    Missing,
    Refused,
}

trait ExecutableFs {
    fn fixed_disk(&self, root: &str) -> bool;
    fn inspect(&self, path: &str) -> Result<FileKind, FsError>;
}

trait Picker {
    fn pick_executable(&self) -> Result<Option<String>, String>;
}

trait Launcher {
    fn spawn(&self, executable: &str) -> Result<(), String>;
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct Selection {
    app: LocalApp,
    duplicate: bool,
}

// Parse Windows paths even in the fake-backed tests on other platforms. Never
// canonicalize a symlink into an authorized path: every ancestor is inspected.
fn validate_executable(fs: &impl ExecutableFs, path: &str) -> Result<String, String> {
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
    let file = parts.last().expect("split always returns a component");
    let Some((stem, extension)) = file.rsplit_once('.') else {
        return Err("nexo.local.notExecutable".into());
    };
    if stem.trim().is_empty() || !extension.eq_ignore_ascii_case("exe") {
        return Err("nexo.local.notExecutable".into());
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
            Err(FsError::Refused) | Ok(FileKind::Reparse) => {
                return Err("nexo.local.refused".into());
            }
            Ok(FileKind::Directory) if index + 1 == parts.len() => {
                return Err("nexo.local.notExecutable".into());
            }
            Ok(FileKind::File) if index + 1 != parts.len() => {
                return Err("nexo.local.notExecutable".into());
            }
            Ok(FileKind::Directory | FileKind::File) => {}
        }
    }
    Ok(path)
}

fn selection(app: LocalApp, settings: &Settings) -> Selection {
    let same = |left: &str, right: &str| left.to_lowercase() == right.to_lowercase();
    let duplicate = settings.local_apps.iter().any(|other| {
        other.id != app.id
            && (same(&other.name, &app.name) || same(&other.executable, &app.executable))
    });
    Selection { app, duplicate }
}

fn entry_index(entries: &[Value], settings: &Settings, id: &str) -> Result<usize, String> {
    if !settings.local_apps.iter().any(|app| app.id == id) {
        return Err("nexo.local.notFound".into());
    }
    let mut matches = entries
        .iter()
        .enumerate()
        .filter(|(_, value)| value.get("id").and_then(Value::as_str) == Some(id));
    let index = matches.next().ok_or("nexo.local.notFound")?.0;
    if matches.next().is_some() {
        return Err("nexo.local.refused".into());
    }
    Ok(index)
}

fn valid_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().any(char::is_control) {
        return Err("nexo.local.invalidName".into());
    }
    Ok(name)
}

#[cfg(test)]
fn add(
    store: &Store,
    fs: &impl ExecutableFs,
    picker: &impl Picker,
) -> Result<Option<Selection>, String> {
    let Some(path) = picker.pick_executable()? else {
        return Ok(None);
    };
    let executable = validate_executable(fs, &path)?;
    let filename = executable.rsplit('\\').next().expect("validated filename");
    let name = valid_name(filename.rsplit_once('.').expect("validated extension").0)?;
    save_new(store, executable.clone(), name, None).map(Some)
}

// All manual additions use the same ID, duplicate detection and config mutation.
fn save_new(
    store: &Store,
    executable: String,
    name: &str,
    icon: Option<String>,
) -> Result<Selection, String> {
    let name = valid_name(name)?.to_owned();
    store.mutate_local_apps(|entries, settings| {
        let id = loop {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let candidate = format!(
                "manual-{nanos:x}-{:x}-{:x}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            );
            if !entries
                .iter()
                .any(|entry| entry.get("id").and_then(Value::as_str) == Some(&candidate))
            {
                break candidate;
            }
        };
        let app = LocalApp {
            id,
            name,
            executable,
            icon,
        };
        let result = selection(app.clone(), settings);
        entries.push(json!(app));
        Ok(result)
    })
}

fn update(store: &Store, id: &str, name: &str) -> Result<Selection, String> {
    let name = valid_name(name)?.to_owned();
    store.mutate_local_apps(|entries, settings| {
        let index = entry_index(entries, settings, id)?;
        let mut app = settings
            .local_apps
            .iter()
            .find(|app| app.id == id)
            .expect("entry checked")
            .clone();
        app.name = name;
        entries[index]
            .as_object_mut()
            .ok_or("nexo.local.refused")?
            .insert("name".into(), json!(app.name));
        Ok(selection(app, settings))
    })
}

fn remove(store: &Store, id: &str) -> Result<(), String> {
    store.mutate_local_apps(|entries, settings| {
        let index = entry_index(entries, settings, id)?;
        entries.remove(index);
        Ok(())
    })
}

fn repair(
    store: &Store,
    fs: &impl ExecutableFs,
    picker: &impl Picker,
    id: &str,
) -> Result<Option<Selection>, String> {
    let Some(path) = picker.pick_executable()? else {
        return Ok(None);
    };
    let executable = validate_executable(fs, &path)?;
    store.mutate_local_apps(|entries, settings| {
        let index = entry_index(entries, settings, id)?;
        let mut app = settings
            .local_apps
            .iter()
            .find(|app| app.id == id)
            .expect("entry checked")
            .clone();
        app.executable = executable;
        entries[index]
            .as_object_mut()
            .ok_or("nexo.local.refused")?
            .insert("executable".into(), json!(app.executable));
        Ok(Some(selection(app, settings)))
    })
}

fn open(
    store: &Store,
    fs: &impl ExecutableFs,
    launcher: &impl Launcher,
    id: &str,
) -> Result<(), String> {
    let settings = store.local_settings()?;
    let app = settings
        .local_apps
        .iter()
        .find(|app| app.id == id)
        .ok_or("nexo.local.notFound")?;
    let path = validate_executable(fs, &app.executable)?;
    launcher.spawn(&path)
}

mod icons;
pub(crate) mod projection;
mod selection_tokens;

#[cfg(windows)]
pub(crate) mod windows;

#[cfg(test)]
#[path = "local_apps_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "vp_local.rs"]
mod vp_local;
