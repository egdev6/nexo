use super::{
    ExecutableFs, FileKind, FsError, Launcher, Picker, Selection,
    catalog::{self, CatalogPicker},
    icons::{self, IconFs, IconPicker, MAX_ICON_BYTES},
};
use crate::config::LocalBinding;
use crate::local_catalog::{LocalCatalogReader, LocalCatalogSnapshot, LocalEntryKey, RefreshFence};
use std::io::{Read, Write};
use std::os::windows::fs::MetadataExt;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};
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

struct SystemCatalogPicker(isize);
impl CatalogPicker for SystemCatalogPicker {
    fn pick_catalog(&self) -> Result<Option<String>, String> {
        let filter: Vec<u16> = "JSON\0*.json\0\0".encode_utf16().collect();
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
        Ok(Some(
            String::from_utf16(&path[..length]).map_err(|_| "nexo.local.refused")?,
        ))
    }
}

struct SelectedCatalogPath(String);
impl CatalogPicker for SelectedCatalogPath {
    fn pick_catalog(&self) -> Result<Option<String>, String> {
        Ok(Some(self.0.clone()))
    }
}

struct SystemCatalogReader;
impl LocalCatalogReader for SystemCatalogReader {
    fn open(&self, location: &str) -> std::io::Result<impl Read> {
        std::fs::File::open(location)
    }
}

struct SystemIconPicker(isize);
impl IconPicker for SystemIconPicker {
    fn pick_icon(&self) -> Result<Option<String>, String> {
        let filter: Vec<u16> = "PNG and ICO\0*.png;*.ico\0\0".encode_utf16().collect();
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
        Ok(Some(
            String::from_utf16(&path[..length]).map_err(|_| "nexo.local.refused")?,
        ))
    }
}

struct SelectedIconPath(String);
impl IconPicker for SelectedIconPath {
    fn pick_icon(&self) -> Result<Option<String>, String> {
        Ok(Some(self.0.clone()))
    }
}

struct SystemIconFs {
    directory: PathBuf,
}
impl SystemIconFs {
    fn new(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            directory: app
                .path()
                .app_data_dir()
                .map_err(|_| "nexo.local.iconWriteFailed")?
                .join("local-icons"),
        })
    }
    // A path is informational only; it grants no frontend filesystem access.
    fn owned_path(&self, name: &str) -> Option<String> {
        if !icons::managed_name(name) || self.checked_directory().is_err() {
            return None;
        }
        let path = self.directory.join(name);
        let text = path.to_str()?;
        (SystemFs.inspect(text) == Ok(FileKind::File)).then(|| text.to_owned())
    }

    fn checked_directory(&self) -> Result<(), String> {
        let path = self
            .directory
            .to_str()
            .ok_or("nexo.local.iconWriteFailed")?;
        match SystemFs.inspect(path) {
            Ok(FileKind::Directory) => Ok(()),
            _ => Err("nexo.local.iconWriteFailed".into()),
        }
    }
}
impl ExecutableFs for SystemIconFs {
    fn fixed_disk(&self, root: &str) -> bool {
        SystemFs.fixed_disk(root)
    }
    fn inspect(&self, path: &str) -> Result<FileKind, FsError> {
        SystemFs.inspect(path)
    }
}
impl IconFs for SystemIconFs {
    fn read_icon(&self, path: &str) -> Result<Vec<u8>, String> {
        let file = std::fs::File::open(path).map_err(|_| "nexo.local.iconReadFailed")?;
        let mut bytes = Vec::new();
        file.take((MAX_ICON_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| "nexo.local.iconReadFailed")?;
        Ok(bytes)
    }
    fn save_icon(&self, bytes: &[u8], extension: &str) -> Result<String, String> {
        std::fs::create_dir_all(&self.directory).map_err(|_| "nexo.local.iconWriteFailed")?;
        self.checked_directory()?;
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let name = format!(
            "icon-{nanos:x}-{:x}-{:x}.{extension}",
            std::process::id(),
            super::NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        );
        let path = self.directory.join(&name);
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "nexo.local.iconWriteFailed")?;
        if file
            .write_all(bytes)
            .and_then(|()| file.sync_all())
            .is_err()
        {
            drop(file);
            std::fs::remove_file(path).map_err(|_| "nexo.local.iconCleanupFailed")?;
            return Err("nexo.local.iconWriteFailed".into());
        }
        Ok(name)
    }
    fn delete_icon(&self, name: &str) -> Result<(), String> {
        match std::fs::symlink_metadata(&self.directory) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            _ => self
                .checked_directory()
                .map_err(|_| "nexo.local.iconCleanupFailed")?,
        }
        match std::fs::remove_file(self.directory.join(name)) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err("nexo.local.iconCleanupFailed".into()),
        }
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
pub(crate) async fn local_apps_list(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Vec<super::projection::LocalRow>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = crate::config::store(&app, &window)?;
        let lock = app.state::<crate::config::ConfigLock>();
        let fence = app.state::<RefreshFence>();
        let hub = app.state::<crate::ipc::Hub>();
        let official = crate::apps::duplicate_candidates(app.clone(), &hub);
        let icons = SystemIconFs::new(&app).ok();
        super::projection::list(&store, &lock, &SystemFs, &fence, &official, &|name| {
            icons.as_ref().and_then(|fs| fs.owned_path(name))
        })
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
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
        let fs = SystemIconFs::new(&app)?;
        crate::config::with_locked_store(&app, &window, |store| {
            icons::remove_with_icon(store, &fs, &id)
        })
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
pub(crate) async fn local_app_pick_icon(
    app: AppHandle,
    window: WebviewWindow,
    id: String,
) -> Result<Option<Selection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if window.label() != "main" {
            return Err("nexo.local.refused".into());
        }
        let owner = window.hwnd().map_err(|_| "nexo.local.dialogFailed")?.0 as isize;
        let Some(path) = SystemIconPicker(owner).pick_icon()? else {
            return Ok(None);
        };
        let fs = SystemIconFs::new(&app)?;
        crate::config::with_locked_store(&app, &window, |store| {
            icons::pick_icon(store, &fs, &SelectedIconPath(path), &id)
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

pub(crate) fn start_local_catalogs(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| -> Result<(), String> {
            let store = crate::config::store(&app, &window)?;
            let lock = app.state::<crate::config::ConfigLock>();
            let fence = app.state::<RefreshFence>();
            let sources = lock.with_store(&store, |store| Ok(store.local_settings()?.sources))?;
            for source in sources.iter().filter(|source| source.kind == "local") {
                let _ = catalog::refresh(
                    &store,
                    &lock,
                    &SystemFs,
                    &SystemCatalogReader,
                    &fence,
                    &source.id,
                );
            }
            Ok(())
        })();
        if let Err(error) = result {
            eprintln!("could not initialize local catalogs: {error}");
        }
    });
}

#[tauri::command]
pub(crate) async fn local_catalog_set(
    app: AppHandle,
    window: WebviewWindow,
    source_id: Option<String>,
) -> Result<Option<LocalCatalogSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if window.label() != "main" {
            return Err("nexo.local.refused".into());
        }
        let owner = window.hwnd().map_err(|_| "nexo.local.dialogFailed")?.0 as isize;
        let Some(path) = SystemCatalogPicker(owner).pick_catalog()? else {
            return Ok(None);
        };
        let store = crate::config::store(&app, &window)?;
        let lock = app.state::<crate::config::ConfigLock>();
        let fence = app.state::<RefreshFence>();
        catalog::set(
            &store,
            &lock,
            &SystemFs,
            &SystemCatalogReader,
            &SelectedCatalogPath(path),
            &fence,
            source_id.as_deref(),
        )
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[tauri::command]
pub(crate) async fn local_catalog_refresh(
    app: AppHandle,
    window: WebviewWindow,
    source_id: String,
) -> Result<LocalCatalogSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = crate::config::store(&app, &window)?;
        let lock = app.state::<crate::config::ConfigLock>();
        let fence = app.state::<RefreshFence>();
        catalog::refresh(
            &store,
            &lock,
            &SystemFs,
            &SystemCatalogReader,
            &fence,
            &source_id,
        )
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[tauri::command]
pub(crate) async fn local_catalog_clear(
    app: AppHandle,
    window: WebviewWindow,
    source_id: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = crate::config::store(&app, &window)?;
        let lock = app.state::<crate::config::ConfigLock>();
        let fence = app.state::<RefreshFence>();
        catalog::clear(&store, &lock, &fence, &source_id)
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[tauri::command]
pub(crate) async fn local_catalog_bind(
    app: AppHandle,
    window: WebviewWindow,
    key: LocalEntryKey,
) -> Result<Option<LocalBinding>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = selected_path(&window)? else {
            return Ok(None);
        };
        let store = crate::config::store(&app, &window)?;
        let lock = app.state::<crate::config::ConfigLock>();
        let fence = app.state::<RefreshFence>();
        catalog::bind(
            &store,
            &lock,
            &SystemFs,
            &SystemCatalogReader,
            &SelectedPath(path),
            &fence,
            &key,
        )
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[tauri::command]
pub(crate) async fn local_catalog_unbind(
    app: AppHandle,
    window: WebviewWindow,
    key: LocalEntryKey,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = crate::config::store(&app, &window)?;
        let lock = app.state::<crate::config::ConfigLock>();
        catalog::unbind(&store, &lock, &key)
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[tauri::command]
pub(crate) async fn local_catalog_open(
    app: AppHandle,
    window: WebviewWindow,
    key: LocalEntryKey,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = crate::config::store(&app, &window)?;
        let lock = app.state::<crate::config::ConfigLock>();
        let fence = app.state::<RefreshFence>();
        catalog::open(
            &store,
            &lock,
            &SystemFs,
            &SystemCatalogReader,
            &SystemLauncher,
            &fence,
            &key,
        )
    })
    .await
    .map_err(|_| "nexo.local.refused".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{SystemFs, SystemIconFs};
    use crate::local_apps::icons::{IconFs, MAX_ICON_BYTES};
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
    fn icon_files_are_created_in_the_owned_directory_and_reads_are_bounded() {
        let path =
            std::env::temp_dir().join(format!("nexo-local-native-icons-{}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        let scratch = Scratch(path);
        let source = scratch.0.join("source.png");
        let bytes = vec![42; MAX_ICON_BYTES + 10];
        std::fs::write(&source, &bytes).unwrap();
        let fs = SystemIconFs {
            directory: scratch.0.join("local-icons"),
        };
        assert_eq!(
            fs.read_icon(source.to_str().unwrap()).unwrap().len(),
            MAX_ICON_BYTES + 1
        );
        let name = fs.save_icon(b"copied", "png").unwrap();
        assert_eq!(std::fs::read(fs.directory.join(&name)).unwrap(), b"copied");
        assert_eq!(
            fs.owned_path(&name),
            fs.directory.join(&name).to_str().map(str::to_owned)
        );
        assert_eq!(fs.owned_path("../selected.png"), None);
        fs.delete_icon(&name).unwrap();
        assert_eq!(fs.owned_path(&name), None);
        assert!(!fs.directory.join(name).exists());
        assert_eq!(std::fs::read(source).unwrap(), bytes);
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
