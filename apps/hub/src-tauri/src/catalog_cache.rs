use std::io::{ErrorKind, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
const CACHE_NAME: &str = "catalog-v4.json";

fn read_cache(directory: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(directory.join(CACHE_NAME)) {
        Ok(text) if nexo_catalog::parse_catalog_v4(&text).is_ok() => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(error) if matches!(error.kind(), ErrorKind::NotFound | ErrorKind::InvalidData) => {
            Ok(None)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn write_cache(directory: &Path, input: &str) -> Result<(), String> {
    nexo_catalog::parse_catalog_v4(input).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let name = format!(
        ".catalog-{}-{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    );
    let temporary = directory.join(name);
    let mut created = false;
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        created = true;
        file.write_all(input.as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, directory.join(CACHE_NAME))
    })();
    if result.is_err() && created {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn read_catalog_v4_cache(app: AppHandle) -> Result<Option<String>, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    read_cache(&directory)
}

#[tauri::command]
pub(crate) fn write_catalog_cache(app: AppHandle, input: String) -> Result<(), String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    write_cache(&directory, &input)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT: AtomicU64 = AtomicU64::new(0);
    const VALID: &str = include_str!("../../../../crates/nexo-catalog/fixtures/v4.json");
    const EMPTY: &str = "{\"schemaVersion\":4,\"apps\":[]}";

    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "nexo-catalog-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
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
    fn round_trips_valid_catalog_and_replaces_it_only_with_another_valid_catalog() {
        let dir = Scratch::new();
        assert_eq!(read_cache(&dir.0).unwrap(), None);
        write_cache(&dir.0, VALID).unwrap();
        assert_eq!(read_cache(&dir.0).unwrap().as_deref(), Some(VALID));
        write_cache(&dir.0, EMPTY).unwrap();
        assert_eq!(read_cache(&dir.0).unwrap().as_deref(), Some(EMPTY));
    }

    #[test]
    fn v4_cache_rejects_v3_and_invalid_documents_without_replacing_valid_data() {
        let dir = Scratch::new();
        write_cache(&dir.0, VALID).unwrap();
        assert_eq!(read_cache(&dir.0).unwrap().as_deref(), Some(VALID));
        for invalid in [
            "{",
            "{\"schemaVersion\":1,\"apps\":[]}",
            "{\"schemaVersion\":2,\"apps\":[]}",
            "{\"schemaVersion\":3,\"apps\":[]}",
            "{\"schemaVersion\":4,\"apps\":[{}]}",
        ] {
            assert!(write_cache(&dir.0, invalid).is_err());
            assert_eq!(read_cache(&dir.0).unwrap().as_deref(), Some(VALID));
            assert_eq!(
                std::fs::read_to_string(dir.0.join(CACHE_NAME)).unwrap(),
                VALID
            );
        }
    }

    #[test]
    fn old_cache_files_are_ignored_and_corrupt_v4_recovers() {
        let dir = Scratch::new();
        for name in ["catalog.json", "catalog-v2.json", "catalog-v3.json"] {
            std::fs::write(dir.0.join(name), "{\"schemaVersion\":3,\"apps\":[]}").unwrap();
        }
        assert_eq!(read_cache(&dir.0).unwrap(), None);
        std::fs::write(dir.0.join(CACHE_NAME), "{broken").unwrap();
        assert_eq!(read_cache(&dir.0).unwrap(), None);
        write_cache(&dir.0, EMPTY).unwrap();
        assert_eq!(read_cache(&dir.0).unwrap().as_deref(), Some(EMPTY));
    }
}
