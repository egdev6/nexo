use std::io::{ErrorKind, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

fn cache_name(version: u64) -> Result<&'static str, String> {
    match version {
        1 => Ok("catalog.json"),
        2 => Ok("catalog-v2.json"),
        _ => Err("Unsupported catalog cache version".into()),
    }
}

fn read_version(directory: &Path, version: u64) -> Result<Option<String>, String> {
    match std::fs::read_to_string(directory.join(cache_name(version)?)) {
        Ok(text)
            if nexo_catalog::parse_catalog(&text)
                .is_ok_and(|catalog| catalog.schema_version == version) =>
        {
            Ok(Some(text))
        }
        Ok(_) => Ok(None),
        Err(error) if matches!(error.kind(), ErrorKind::NotFound | ErrorKind::InvalidData) => {
            Ok(None)
        }
        Err(error) => Err(error.to_string()),
    }
}

fn read_cache(directory: &Path) -> Result<Option<String>, String> {
    read_version(directory, 1)
}

fn write_cache(directory: &Path, input: &str) -> Result<(), String> {
    let version = nexo_catalog::parse_catalog(input)
        .map_err(|error| error.to_string())?
        .schema_version;
    let target = cache_name(version)?;
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
        std::fs::rename(&temporary, directory.join(target))
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
pub(crate) fn read_catalog_v2_cache(app: AppHandle) -> Result<Option<String>, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    read_version(&directory, 2)
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
        for invalid in ["{", "{\"schemaVersion\":3,\"apps\":[]}"] {
            assert!(write_cache(&dir.0, invalid).is_err());
            assert_eq!(read_cache(&dir.0).unwrap().as_deref(), Some(VALID));
        }
    }

    #[test]
    fn v2_write_does_not_replace_the_v1_cache() {
        let dir = Scratch::new();
        write_cache(&dir.0, VALID).unwrap();
        let v2 = "{\"schemaVersion\":2,\"apps\":[]}";
        write_cache(&dir.0, v2).unwrap();
        assert_eq!(read_cache(&dir.0).unwrap().as_deref(), Some(VALID));
        assert_eq!(read_version(&dir.0, 2).unwrap().as_deref(), Some(v2));
        assert!(write_cache(&dir.0, "{\"schemaVersion\":3,\"apps\":[]}").is_err());
        assert_eq!(read_version(&dir.0, 2).unwrap().as_deref(), Some(v2));
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
