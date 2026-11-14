use super::*;
use crate::local_apps::{self, FileKind, FsError, Picker, catalog, icons};
use crate::local_catalog::{LocalCatalogError, LocalCatalogReader};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
const EXE: &str = "C:\\Apps\\App.exe";
const ICON: &str = "C:\\Apps\\selected.png";
const CATALOG: &str = "C:\\Catalog\\apps.json";
const FULL: &str = include_str!("../../../../../crates/nexo-catalog/fixtures/full.json");

struct FakeFs(RefCell<HashMap<String, Result<FileKind, FsError>>>);
impl FakeFs {
    fn new() -> Self {
        Self(RefCell::new(HashMap::from([
            ("C:\\".into(), Ok(FileKind::Directory)),
            ("C:\\Apps".into(), Ok(FileKind::Directory)),
            ("C:\\Catalog".into(), Ok(FileKind::Directory)),
            (EXE.into(), Ok(FileKind::File)),
            (ICON.into(), Ok(FileKind::File)),
            (CATALOG.into(), Ok(FileKind::File)),
        ])))
    }
    fn set(&self, path: &str, value: Result<FileKind, FsError>) {
        self.0.borrow_mut().insert(path.into(), value);
    }
}
impl ExecutableFs for FakeFs {
    fn fixed_disk(&self, _: &str) -> bool {
        true
    }
    fn inspect(&self, path: &str) -> Result<FileKind, FsError> {
        self.0
            .borrow()
            .get(path)
            .copied()
            .unwrap_or(Err(FsError::Missing))
    }
}
impl icons::IconFs for FakeFs {
    fn read_icon(&self, _: &str) -> Result<Vec<u8>, String> {
        Ok(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\0\0\0\0\x3a\x7e\x9b\x55\0\0\0\rIDAT\x78\x01\x01\x02\0\xfd\xff\0\0\0\x02\0\x01\x7e\x05\x0d\xd2\0\0\0\0IEND\xae\x42\x60\x82".to_vec())
    }
    fn read_owned_icon(&self, _: &str) -> Result<Vec<u8>, String> {
        Err("nexo.local.iconReadFailed".into())
    }
    fn save_icon(&self, _: &[u8], _: &str) -> Result<String, String> {
        Ok("icon-1.png".into())
    }
    fn delete_icon(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}
struct ExecPicker;
impl Picker for ExecPicker {
    fn pick_executable(&self) -> Result<Option<String>, String> {
        Ok(Some(EXE.into()))
    }
}
struct IconPicker;
impl icons::IconPicker for IconPicker {
    fn pick_icon(&self) -> Result<Option<String>, String> {
        Ok(Some(ICON.into()))
    }
}
struct CatalogPicker;
impl catalog::CatalogPicker for CatalogPicker {
    fn pick_catalog(&self) -> Result<Option<String>, String> {
        Ok(Some(CATALOG.into()))
    }
}
struct Reader(String);
impl LocalCatalogReader for Reader {
    fn open(&self, _: &str) -> io::Result<impl io::Read> {
        Ok(io::Cursor::new(self.0.as_bytes().to_vec()))
    }
}
struct Fixture {
    directory: PathBuf,
    store: Store,
    lock: ConfigLock,
    fence: RefreshFence,
    fs: FakeFs,
}
impl Fixture {
    fn new() -> Self {
        let directory = std::env::temp_dir().join(format!(
            "nexo-local-list-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&directory).unwrap();
        Self {
            store: Store::new(directory.join("config.json")),
            directory,
            lock: ConfigLock::default(),
            fence: RefreshFence::default(),
            fs: FakeFs::new(),
        }
    }
    fn manual(&self, name: &str) -> String {
        let id = local_apps::add(&self.store, &self.fs, &ExecPicker)
            .unwrap()
            .unwrap()
            .app
            .id;
        local_apps::update(&self.store, &id, name).unwrap();
        id
    }
    fn reader(&self) -> Reader {
        let mut doc: Value = serde_json::from_str(FULL).unwrap();
        doc["apps"][0]["integrationLevel"] = json!("launch");
        Reader(doc.to_string())
    }
    fn catalog(&self) -> String {
        catalog::set(
            &self.store,
            &self.lock,
            &self.fs,
            &self.reader(),
            &CatalogPicker,
            &self.fence,
            None,
        )
        .unwrap()
        .unwrap()
        .source_id
    }
    fn bind(&self, source: &str) {
        catalog::bind(
            &self.store,
            &self.lock,
            &self.fs,
            &self.reader(),
            &ExecPicker,
            &self.fence,
            &crate::local_catalog::LocalEntryKey {
                source_id: source.into(),
                app_id: "example-app".into(),
            },
        )
        .unwrap();
    }
    fn list(
        &self,
        official: &[OfficialCandidate],
        icon: &impl Fn(&str) -> Option<String>,
    ) -> Vec<Value> {
        list(
            &self.store,
            &self.lock,
            &self.fs,
            &self.fence,
            official,
            icon,
        )
        .unwrap()
        .iter()
        .map(|row| serde_json::to_value(row).unwrap())
        .collect()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.directory).unwrap();
    }
}

#[test]
fn empty_local_data_returns_no_rows_or_settings_writes() {
    let f = Fixture::new();
    assert!(f.list(&[], &|_| None).is_empty());
    assert!(!f.directory.join("config.json").exists());
}

#[test]
fn lists_source_scoped_rows_and_warns_on_official_name_or_executable_matches() {
    let f = Fixture::new();
    let manual = f.manual("Private");
    icons::pick_icon(&f.store, &f.fs, &IconPicker, &manual).unwrap();
    let work = f.catalog();
    let personal = f.catalog();
    f.bind(&work);
    let official = [
        OfficialCandidate {
            id: "official-name".into(),
            name: "eXAMPLE aPP".into(),
            executable: None,
        },
        OfficialCandidate {
            id: "official-path".into(),
            name: "Different".into(),
            executable: Some("c:/apps/APP.EXE".into()),
        },
    ];
    let icon =
        |name: &str| (name == "icon-1.png").then(|| "C:\\Nexo\\local-icons\\icon-1.png".into());
    let rows = f.list(&official, &icon);
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0]["source"], "local");
    assert_eq!(rows[0]["state"], "ready");
    assert_eq!(rows[0]["origin"], json!({"kind":"manual", "id":manual}));
    assert_eq!(rows[0]["iconPath"], "C:\\Nexo\\local-icons\\icon-1.png");
    assert_eq!(rows[0]["duplicateOf"], "official-path");
    assert_eq!(
        rows[1]["origin"],
        json!({"kind":"catalog", "sourceId":work, "sourceLabel":"Local", "appId":"example-app"})
    );
    assert_eq!(
        rows[2]["origin"],
        json!({"kind":"catalog", "sourceId":personal, "sourceLabel":"Local", "appId":"example-app"})
    );
    assert_eq!(rows[1]["state"], "ready");
    assert_eq!(rows[2]["state"], "unbound");
    for row in &rows[1..] {
        assert_eq!(row["source"], "local");
        assert_eq!(row["name"], "Example App");
        assert_eq!(row["duplicateOf"], "official-name");
        assert!(row.get("iconPath").is_none());
        assert!(row.to_string().find("https://").is_none());
    }
    let ids: Vec<&str> = rows.iter().map(|row| row["id"].as_str().unwrap()).collect();
    assert!(
        ids.iter()
            .all(|id| id.starts_with("local:") && id.contains(':'))
    );
    assert_ne!(ids[0], ids[1]);
    assert_ne!(ids[1], ids[2]);
    assert_eq!(rows, f.list(&official, &icon));
    assert!(f.list(&official, &|_| None)[0].get("iconPath").is_none());
}

#[test]
fn missing_executables_and_invalid_sources_do_not_erase_other_rows_or_bindings() {
    let f = Fixture::new();
    f.manual("Private");
    let work = f.catalog();
    let personal = f.catalog();
    f.bind(&work);
    let before = std::fs::read(f.directory.join("config.json")).unwrap();
    f.fs.set(EXE, Err(FsError::Missing));
    let rows = f.list(&[], &|_| None);
    assert_eq!(
        rows.iter()
            .map(|row| row["state"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["missingExecutable", "missingExecutable", "unbound"]
    );
    let ticket = f.fence.begin(&work);
    assert!(f.fence.finish(ticket, Err(LocalCatalogError::Invalid)));
    let rows = f.list(&[], &|_| None);
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["name"], "Private");
    assert_eq!(rows[1]["origin"]["sourceId"], personal);
    assert_eq!(rows[1]["state"], "unbound");
    assert_eq!(
        std::fs::read(f.directory.join("config.json")).unwrap(),
        before
    );
}

#[test]
fn a_source_invalidated_during_inspection_cannot_return_stale_ready_rows() {
    use std::sync::mpsc;
    use std::time::Duration;

    struct BlockingFs {
        inner: FakeFs,
        entered: mpsc::Sender<()>,
        resume: mpsc::Receiver<()>,
        blocked: std::cell::Cell<bool>,
    }
    impl ExecutableFs for BlockingFs {
        fn fixed_disk(&self, root: &str) -> bool {
            self.inner.fixed_disk(root)
        }
        fn inspect(&self, path: &str) -> Result<FileKind, FsError> {
            if path == EXE && !self.blocked.replace(true) {
                self.entered.send(()).unwrap();
                self.resume.recv_timeout(Duration::from_secs(5)).unwrap();
            }
            self.inner.inspect(path)
        }
    }
    let f = Fixture::new();
    let source = f.catalog();
    f.bind(&source);
    let before = std::fs::read(f.directory.join("config.json")).unwrap();
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    let fs = BlockingFs {
        inner: FakeFs::new(),
        entered: entered_tx,
        resume: resume_rx,
        blocked: std::cell::Cell::new(false),
    };
    std::thread::scope(|scope| {
        let store = &f.store;
        let lock = &f.lock;
        let fence = &f.fence;
        let worker = scope.spawn(move || list(store, lock, &fs, fence, &[], &|_| None));
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let result = catalog::refresh(
            &f.store,
            &f.lock,
            &f.fs,
            &Reader("{".into()),
            &f.fence,
            &source,
        );
        resume_tx.send(()).unwrap();
        assert_eq!(result, Err("nexo.local.catalogInvalid".into()));
        assert_eq!(worker.join().unwrap(), Err("nexo.local.refused".into()));
    });
    assert_eq!(
        std::fs::read(f.directory.join("config.json")).unwrap(),
        before
    );
    assert!(f.list(&[], &|_| None).is_empty());
}

#[test]
fn duplicate_local_rows_remain_distinct_and_all_warn_without_an_official_match() {
    let f = Fixture::new();
    f.manual("example app");
    f.catalog();
    f.catalog();
    let rows = f.list(&[], &|_| None);
    assert_eq!(rows.len(), 3);
    for row in &rows {
        let duplicate = row["duplicateOf"].as_str().unwrap();
        assert_ne!(duplicate, row["id"].as_str().unwrap());
        assert!(rows.iter().any(|other| other["id"] == duplicate));
    }
    assert_eq!(rows, f.list(&[], &|_| None));
}
