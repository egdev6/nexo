use std::io::{ErrorKind, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

fn read_cache(directory: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(directory.join("catalog.json")) {
        Ok(text) if nexo_catalog::parse_catalog(&text).is_ok() => Ok(Some(text)),
        Ok(_) => Ok(None),
        Err(error) if matches!(error.kind(), ErrorKind::NotFound | ErrorKind::InvalidData) => {
            Ok(None)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn write_cache(directory: &Path, input: &str) -> Result<(), String> {
    nexo_catalog::parse_catalog(input).map_err(|error| error.to_string())?;
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
        std::fs::rename(&temporary, directory.join("catalog.json"))
    })();
    if result.is_err() && created {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn read_catalog_cache(app: AppHandle) -> Result<Option<String>, String> {
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
    const VALID: &str = include_str!("../../../../crates/nexo-catalog/fixtures/full.json");
    const EMPTY: &str = "{\"schemaVersion\":1,\"apps\":[]}";

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
    fn rejected_document_never_replaces_valid_cache() {
        let dir = Scratch::new();
        write_cache(&dir.0, VALID).unwrap();
        for invalid in ["{", "{\"schemaVersion\":2,\"apps\":[]}"] {
            assert!(write_cache(&dir.0, invalid).is_err());
            assert_eq!(read_cache(&dir.0).unwrap().as_deref(), Some(VALID));
        }
    }

    #[test]
    fn corrupt_cache_is_ignored_and_a_later_valid_write_recovers() {
        let dir = Scratch::new();
        std::fs::write(dir.0.join("catalog.json"), "{broken").unwrap();
        assert_eq!(read_cache(&dir.0).unwrap(), None);
        write_cache(&dir.0, EMPTY).unwrap();
        assert_eq!(read_cache(&dir.0).unwrap().as_deref(), Some(EMPTY));
    }
}
