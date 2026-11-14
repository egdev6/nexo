use super::{ExecutableFs, FileKind, FsError, Launcher, Picker, Selection};
use std::os::windows::fs::MetadataExt;
use tauri::{AppHandle, WebviewWindow};
use windows_sys::Win32::{
    Storage::FileSystem::{FILE_ATTRIBUTE_REPARSE_POINT, GetDriveTypeW},
    System::WindowsProgramming::DRIVE_FIXED,
    UI::Controls::Dialogs::{
        CommDlgExtendedError, GetOpenFileNameW, OFN_DONTADDTORECENT, OFN_FILEMUSTEXIST,
        OFN_NOCHANGEDIR, OFN_NODEREFERENCELINKS, OFN_PATHMUSTEXIST, OPENFILENAMEW,
    },
};

struct SystemFs;
impl ExecutableFs for SystemFs {
    fn fixed_disk(&self, root: &str) -> bool {
        let wide: Vec<u16> = root.encode_utf16().chain(Some(0)).collect();
        unsafe { GetDriveTypeW(wide.as_ptr()) == DRIVE_FIXED }
    }

    fn inspect(&self, path: &str) -> Result<FileKind, FsError> {
        let metadata = std::fs::symlink_metadata(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                FsError::Missing
            } else {
                FsError::Refused
            }
        })?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || metadata.file_type().is_symlink()
        {
            Ok(FileKind::Reparse)
        } else if metadata.is_file() {
            Ok(FileKind::File)
        } else if metadata.is_dir() {
            Ok(FileKind::Directory)
        } else {
            Err(FsError::Refused)
        }
    }
}

struct SystemPicker(isize);
impl Picker for SystemPicker {
    fn pick_executable(&self) -> Result<Option<String>, String> {
        let filter: Vec<u16> = "*.exe\0*.exe\0\0".encode_utf16().collect();
        let mut path = vec![0_u16; 32768];
        let mut dialog = OPENFILENAMEW {
            lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
            hwndOwner: self.0 as _,
            lpstrFilter: filter.as_ptr(),
            nFilterIndex: 1,
            lpstrFile: path.as_mut_ptr(),
            nMaxFile: path.len() as u32,
            Flags: OFN_FILEMUSTEXIST
                | OFN_PATHMUSTEXIST
                | OFN_NOCHANGEDIR
                | OFN_NODEREFERENCELINKS
                | OFN_DONTADDTORECENT,
            ..Default::default()
        };
        if unsafe { GetOpenFileNameW(&mut dialog) } == 0 {
            return if unsafe { CommDlgExtendedError() } == 0 {
                Ok(None)
            } else {
                Err("nexo.local.dialogFailed".into())
            };
        }
        let length = path
            .iter()
            .position(|word| *word == 0)
            .ok_or("nexo.local.refused")?;
        let selected = String::from_utf16(&path[..length]).map_err(|_| "nexo.local.refused")?;
        Ok(Some(selected))
    }
}

struct SelectedPath(String);
impl Picker for SelectedPath {
    fn pick_executable(&self) -> Result<Option<String>, String> {
        Ok(Some(self.0.clone()))
    }
}

struct SystemLauncher;
impl Launcher for SystemLauncher {
    fn spawn(&self, executable: &str) -> Result<(), String> {
        crate::apps::windows::spawn_detached(std::path::Path::new(executable))
            .map_err(|_| "nexo.local.spawnFailed".into())
    }
}

fn selected_path(window: &WebviewWindow) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("nexo.local.refused".into());
    }
    let owner = window.hwnd().map_err(|_| "nexo.local.dialogFailed")?.0 as isize;
    SystemPicker(owner).pick_executable()
}

#[tauri::command]
pub(crate) async fn local_app_add(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<Selection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // The modal picker must never hold the shared settings lock.
        let Some(path) = selected_path(&window)? else {
            return Ok(None);
        };
        crate::config::with_locked_store(&app, &window, |store| {
            super::add(store, &SystemFs, &SelectedPath(path))
        })
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[tauri::command]
pub(crate) async fn local_app_update(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
    name: String,
) -> Result<Selection, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::config::with_locked_store(&app, &window, |store| super::update(store, &id, &name))
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[tauri::command]
pub(crate) async fn local_app_remove(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::config::with_locked_store(&app, &window, |store| super::remove(store, &id))
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[tauri::command]
pub(crate) async fn local_app_repair(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<Option<Selection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = selected_path(&window)? else {
            return Ok(None);
        };
        crate::config::with_locked_store(&app, &window, |store| {
            super::repair(store, &SystemFs, &SelectedPath(path), &id)
        })
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[tauri::command]
pub(crate) async fn local_app_open(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::config::with_locked_store(&app, &window, |store| {
            super::open(store, &SystemFs, &SystemLauncher, &id)
        })
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[cfg(test)]
mod tests {
    use super::SystemFs;
    use crate::local_apps::validate_executable;

    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("nexo-local-native-{}", std::process::id()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn system_filesystem_checks_real_fixed_disk_files_and_missing_paths() {
        let scratch = Scratch::new();
        let executable = scratch.0.join("App.EXE");
        std::fs::write(&executable, b"fixture").unwrap();
        let path = executable.to_str().unwrap();
        assert_eq!(validate_executable(&SystemFs, path), Ok(path.into()));
        let missing = scratch.0.join("Missing.exe");
        assert_eq!(
            validate_executable(&SystemFs, missing.to_str().unwrap()),
            Err("nexo.local.missing".into())
        );
        let directory = scratch.0.join("folder.exe");
        std::fs::create_dir(&directory).unwrap();
        assert_eq!(
            validate_executable(&SystemFs, directory.to_str().unwrap()),
            Err("nexo.local.notExecutable".into())
        );
    }
}
