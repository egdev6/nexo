use super::*;
use crate::local_apps::{self, FileKind, FsError, Picker, icons};
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
const EXE: &str = "C:\\Apps\\App.exe";
const ICON: &str = "C:\\Apps\\selected.png";

struct FakeFs(RefCell<HashMap<String, Result<FileKind, FsError>>>);
impl FakeFs {
    fn new() -> Self {
        Self(RefCell::new(HashMap::from([
            ("C:\\".into(), Ok(FileKind::Directory)),
            ("C:\\Apps".into(), Ok(FileKind::Directory)),
            (EXE.into(), Ok(FileKind::File)),
            (ICON.into(), Ok(FileKind::File)),
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
struct Fixture {
    directory: PathBuf,
    store: Store,
    lock: ConfigLock,
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
    fn list(
        &self,
        official: &[OfficialCandidate],
        icon: &impl Fn(&str) -> Option<String>,
    ) -> Vec<Value> {
        list(&self.store, &self.lock, &self.fs, official, icon)
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
fn lists_manual_rows_and_warns_on_official_name_or_executable_matches() {
    let f = Fixture::new();
    let manual = f.manual("Private");
    let second = f.manual("Example App");
    icons::pick_icon(&f.store, &f.fs, &IconPicker, &manual).unwrap();
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
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["source"], "local");
    assert_eq!(rows[0]["state"], "ready");
    assert_eq!(rows[0]["executable"], EXE);
    assert_eq!(rows[0]["origin"], json!({"kind":"manual", "id":manual}));
    assert_eq!(rows[1]["origin"], json!({"kind":"manual", "id":second}));
    assert_eq!(rows[0]["iconPath"], "C:\\Nexo\\local-icons\\icon-1.png");
    assert_eq!(rows[0]["duplicateOf"], "official-path");
    assert_eq!(rows[1]["duplicateOf"], "official-name");
    assert_ne!(rows[0]["id"], rows[1]["id"]);
    assert_eq!(rows, f.list(&official, &icon));
    assert!(f.list(&official, &|_| None)[0].get("iconPath").is_none());
}

#[test]
fn legacy_catalog_data_never_adds_rows_or_changes_a_read() {
    let f = Fixture::new();
    let manual = f.manual("Private");
    let path = f.directory.join("config.json");
    let mut document: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    document["version"] = json!(3);
    document["sources"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"work", "label":"Work", "kind":"local", "location":"C:\\work.json"}));
    document["localBindings"] = json!([{"sourceId":"work", "appId":"app", "executable":EXE}]);
    std::fs::write(&path, document.to_string()).unwrap();
    let before = std::fs::read(&path).unwrap();
    f.fs.set(EXE, Err(FsError::Missing));
    let rows = f.list(&[], &|_| None);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["origin"], json!({"kind":"manual", "id":manual}));
    assert_eq!(rows[0]["state"], "missingExecutable");
    assert!(rows[0].get("duplicateOf").is_none());
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn a_manual_record_changed_during_inspection_cannot_return_stale_rows() {
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
    let manual = f.manual("Private");
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
        let worker = scope.spawn(move || list(store, lock, &fs, &[], &|_| None));
        entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        f.lock
            .with_store(&f.store, |store| {
                local_apps::update(store, &manual, "Changed")
            })
            .unwrap();
        resume_tx.send(()).unwrap();
        assert_eq!(worker.join().unwrap(), Err("nexo.local.refused".into()));
    });
    assert_eq!(f.list(&[], &|_| None)[0]["name"], "Changed");
}

#[test]
fn duplicate_manual_rows_remain_distinct_and_all_warn_without_an_official_match() {
    let f = Fixture::new();
    f.manual("example app");
    f.manual("example app");
    let rows = f.list(&[], &|_| None);
    assert_eq!(rows.len(), 2);
    for row in &rows {
        let duplicate = row["duplicateOf"].as_str().unwrap();
        assert_ne!(duplicate, row["id"].as_str().unwrap());
        assert!(rows.iter().any(|other| other["id"] == duplicate));
    }
    assert_eq!(rows, f.list(&[], &|_| None));
}
