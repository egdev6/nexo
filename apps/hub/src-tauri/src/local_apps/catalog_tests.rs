use super::*;
use crate::local_apps::{FileKind, FsError};
use crate::local_catalog::LocalCatalogError;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
const FULL: &str = include_str!("../../../../../crates/nexo-catalog/fixtures/full.json");
const OLD: &str = "C:\\Catalog\\old.json";
const NEW: &str = "C:\\Catalog\\new.json";
const EXE: &str = "C:\\Apps\\App.exe";
const OTHER: &str = "C:\\Apps\\Other.exe";

fn document() -> Value {
    let mut value: Value = serde_json::from_str(FULL).unwrap();
    value["apps"][0]["integrationLevel"] = json!("launch");
    value
}
fn key(source: &str, app: &str) -> LocalEntryKey {
    LocalEntryKey {
        source_id: source.into(),
        app_id: app.into(),
    }
}
struct Fixture {
    dir: PathBuf,
    store: Store,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nexo-local-catalog-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).unwrap();
        let store = Store::new(dir.join("config.json"));
        std::fs::write(dir.join("config.json"), json!({
            "version":3, "language":"en", "unknown":42,
            "newsVisit":{"lastVisitAt":"2026-05-31T12:00:00Z","seenKeys":["a:one"]},
            "sources":[
                {"id":"official","label":"Official","kind":"official","metadata":{"keep":1}},
                {"id":"work","label":"Work","kind":"local","location":OLD,"metadata":{"keep":2}},
                {"id":"personal","label":"Personal","kind":"local","location":NEW,"metadata":{"keep":3}}
            ],
            "localApps":[{"id":"manual-1","name":"Private","executable":EXE}],
            "localBindings":[
                {"sourceId":"work","appId":"example-app","executable":EXE,"metadata":{"keep":4}},
                {"sourceId":"personal","appId":"example-app","executable":OTHER,"metadata":{"keep":5}}
            ]
        }).to_string()).unwrap();
        Self { dir, store }
    }
    fn raw(&self) -> Vec<u8> {
        std::fs::read(self.dir.join("config.json")).unwrap()
    }
    fn json(&self) -> Value {
        serde_json::from_slice(&self.raw()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.dir).unwrap();
    }
}
#[derive(Default)]
struct FakeFs {
    entries: RefCell<HashMap<String, Result<FileKind, FsError>>>,
    fixed: Cell<bool>,
}
impl FakeFs {
    fn new() -> Self {
        Self {
            fixed: Cell::new(true),
            entries: RefCell::new(HashMap::from([
                ("C:\\".into(), Ok(FileKind::Directory)),
                ("C:\\Catalog".into(), Ok(FileKind::Directory)),
                (OLD.into(), Ok(FileKind::File)),
                (NEW.into(), Ok(FileKind::File)),
                ("C:\\Apps".into(), Ok(FileKind::Directory)),
                (EXE.into(), Ok(FileKind::File)),
                (OTHER.into(), Ok(FileKind::File)),
            ])),
        }
    }
    fn set(&self, path: &str, result: Result<FileKind, FsError>) {
        self.entries.borrow_mut().insert(path.into(), result);
    }
}
impl ExecutableFs for FakeFs {
    fn fixed_disk(&self, _root: &str) -> bool {
        self.fixed.get()
    }
    fn inspect(&self, path: &str) -> Result<FileKind, FsError> {
        self.entries
            .borrow()
            .get(path)
            .copied()
            .unwrap_or(Err(FsError::Missing))
    }
}
#[derive(Default)]
struct Reader {
    files: RefCell<HashMap<String, String>>,
    reads: RefCell<Vec<String>>,
}
impl LocalCatalogReader for Reader {
    fn read(&self, path: &str) -> io::Result<String> {
        self.reads.borrow_mut().push(path.into());
        self.files
            .borrow()
            .get(path)
            .cloned()
            .ok_or_else(|| io::ErrorKind::NotFound.into())
    }
}
impl Reader {
    fn put(&self, path: &str, text: &str) {
        self.files.borrow_mut().insert(path.into(), text.into());
    }
}
struct CatalogChoice(Result<Option<String>, String>);
impl CatalogPicker for CatalogChoice {
    fn pick_catalog(&self) -> Result<Option<String>, String> {
        self.0.clone()
    }
}
fn choose(path: &str) -> CatalogChoice {
    CatalogChoice(Ok(Some(path.into())))
}
struct ExecChoice(Result<Option<String>, String>);
impl Picker for ExecChoice {
    fn pick_executable(&self) -> Result<Option<String>, String> {
        self.0.clone()
    }
}
fn exe(path: &str) -> ExecChoice {
    ExecChoice(Ok(Some(path.into())))
}
#[derive(Default)]
struct FakeLauncher {
    paths: RefCell<Vec<String>>,
    fail: Cell<bool>,
}
impl Launcher for FakeLauncher {
    fn spawn(&self, path: &str) -> Result<(), String> {
        if self.fail.get() {
            return Err("nexo.local.spawnFailed".into());
        }
        self.paths.borrow_mut().push(path.into());
        Ok(())
    }
}

#[test]
fn set_validates_the_entire_picked_file_before_saving_and_replaces_only_the_selected_source() {
    let f = Fixture::new();
    let fs = FakeFs::new();
    let reader = Reader::default();
    let fence = RefreshFence::default();
    let original = f.raw();
    assert_eq!(
        set(
            &f.store,
            &fs,
            &reader,
            &CatalogChoice(Ok(None)),
            &fence,
            None
        ),
        Ok(None)
    );
    assert_eq!(f.raw(), original);
    assert_eq!(
        set(
            &f.store,
            &fs,
            &reader,
            &CatalogChoice(Err("nexo.local.dialogFailed".into())),
            &fence,
            None
        ),
        Err("nexo.local.dialogFailed".into())
    );
    assert_eq!(f.raw(), original);
    let mut duplicate = document();
    let item = duplicate["apps"][0].clone();
    duplicate["apps"].as_array_mut().unwrap().push(item);
    let mut missing = document();
    missing["apps"][0]
        .as_object_mut()
        .unwrap()
        .remove("installerUrl");
    for (text, error) in [
        ("{".to_string(), "nexo.local.catalogInvalid"),
        (
            json!({"schemaVersion":3,"apps":[]}).to_string(),
            "nexo.local.catalogInvalid",
        ),
        (duplicate.to_string(), "nexo.local.catalogInvalid"),
        (missing.to_string(), "nexo.local.catalogInvalid"),
        (FULL.to_string(), "nexo.local.catalogLaunchOnly"),
    ] {
        reader.put(NEW, &text);
        assert_eq!(
            set(&f.store, &fs, &reader, &choose(NEW), &fence, Some("work")),
            Err(error.into())
        );
        assert_eq!(f.raw(), original);
    }
    assert_eq!(
        set(
            &f.store,
            &fs,
            &reader,
            &choose("\\\\server\\share\\catalog.json"),
            &fence,
            None
        ),
        Err("nexo.local.refused".into())
    );
    assert_eq!(f.raw(), original);
    fs.set("C:\\Catalog", Ok(FileKind::Reparse));
    assert_eq!(
        set(&f.store, &fs, &reader, &choose(NEW), &fence, None),
        Err("nexo.local.refused".into())
    );
    assert_eq!(f.raw(), original);
    fs.set("C:\\Catalog", Ok(FileKind::Directory));
    reader.put(NEW, &document().to_string());
    let future = Fixture::new();
    std::fs::write(future.dir.join("config.json"), b"{\"version\":999}").unwrap();
    let future_raw = future.raw();
    assert_eq!(
        set(&future.store, &fs, &reader, &choose(NEW), &fence, None),
        Err("nexo.config.save.future".into())
    );
    assert_eq!(future.raw(), future_raw);
    let snapshot = set(&f.store, &fs, &reader, &choose(NEW), &fence, None)
        .unwrap()
        .unwrap();
    assert_ne!(snapshot.source_id, "work");
    assert_ne!(snapshot.source_id, "personal");
    assert_eq!(
        snapshot.entries[0].key,
        key(&snapshot.source_id, "example-app")
    );
    let saved = f.json();
    assert_eq!(saved["sources"][0]["metadata"]["keep"], 1);
    assert_eq!(saved["newsVisit"]["seenKeys"], json!(["a:one"]));
    assert_eq!(saved["localBindings"].as_array().unwrap().len(), 2);
    assert_eq!(saved["sources"].as_array().unwrap().len(), 4);
    let ticket = fence.begin("work");
    let replaced = set(&f.store, &fs, &reader, &choose(NEW), &fence, Some("work"))
        .unwrap()
        .unwrap();
    assert_eq!(replaced.source_id, "work");
    assert!(!fence.finish(ticket, Err(LocalCatalogError::Unreadable)));
    let saved = f.json();
    assert_eq!(saved["sources"][1]["location"], NEW);
    assert_eq!(saved["sources"][1]["metadata"]["keep"], 2);
    assert_eq!(saved["localBindings"].as_array().unwrap().len(), 1);
    assert_eq!(saved["localBindings"][0]["sourceId"], "personal");
}

#[test]
fn set_accepts_an_empty_v2_catalog_without_discarding_other_sources() {
    let f = Fixture::new();
    let fs = FakeFs::new();
    let reader = Reader::default();
    reader.put(NEW, &json!({"schemaVersion":2,"apps":[]}).to_string());
    let fence = RefreshFence::default();
    let result = set(&f.store, &fs, &reader, &choose(NEW), &fence, None)
        .unwrap()
        .unwrap();
    assert!(result.entries.is_empty());
    assert_eq!(f.json()["sources"].as_array().unwrap().len(), 4);
    assert_eq!(f.json()["localBindings"].as_array().unwrap().len(), 2);
}

#[test]
fn refresh_records_error_without_changing_bindings_and_recovers_matching_entries() {
    let f = Fixture::new();
    let fs = FakeFs::new();
    let reader = Reader::default();
    let fence = RefreshFence::default();
    let raw = f.raw();
    assert_eq!(
        refresh(&f.store, &fs, &reader, &fence, "work"),
        Err("nexo.local.catalogUnreadable".into())
    );
    assert_eq!(
        fence.current("work"),
        Some(Err(LocalCatalogError::Unreadable))
    );
    reader.put(OLD, "{");
    assert_eq!(
        refresh(&f.store, &fs, &reader, &fence, "work"),
        Err("nexo.local.catalogInvalid".into())
    );
    assert_eq!(fence.current("work"), Some(Err(LocalCatalogError::Invalid)));
    reader.put(OLD, &json!({"schemaVersion":1,"apps":[]}).to_string());
    assert!(
        refresh(&f.store, &fs, &reader, &fence, "work")
            .unwrap()
            .entries
            .is_empty()
    );
    reader.put(OLD, &document().to_string());
    let current = refresh(&f.store, &fs, &reader, &fence, "work").unwrap();
    assert_eq!(current.entries[0].key, key("work", "example-app"));
    assert_eq!(fence.current("work"), Some(Ok(current)));
    assert_eq!(f.raw(), raw);
    assert_eq!(*reader.reads.borrow(), [OLD, OLD, OLD, OLD]);
}

#[test]
fn clear_removes_only_that_source_and_its_bindings_and_fences_pending_results() {
    let f = Fixture::new();
    let fence = RefreshFence::default();
    let ticket = fence.begin("work");
    assert_eq!(clear(&f.store, &fence, "work"), Ok(()));
    let saved = f.json();
    assert_eq!(saved["sources"].as_array().unwrap().len(), 2);
    assert_eq!(saved["sources"][0]["id"], "official");
    assert_eq!(saved["sources"][1]["id"], "personal");
    assert_eq!(saved["localBindings"].as_array().unwrap().len(), 1);
    assert_eq!(saved["localBindings"][0]["metadata"]["keep"], 5);
    assert_eq!(saved["localApps"].as_array().unwrap().len(), 1);
    assert!(!fence.finish(ticket, Err(LocalCatalogError::Unreadable)));
    let raw = f.raw();
    assert_eq!(
        clear(&f.store, &fence, "official"),
        Err("nexo.local.notFound".into())
    );
    assert_eq!(f.raw(), raw);
}

#[test]
fn bind_checks_entry_and_picked_executable_and_preserves_source_scoping() {
    let f = Fixture::new();
    let fs = FakeFs::new();
    let reader = Reader::default();
    reader.put(OLD, &document().to_string());
    let fence = RefreshFence::default();
    let raw = f.raw();
    assert_eq!(
        bind(
            &f.store,
            &fs,
            &reader,
            &ExecChoice(Ok(None)),
            &fence,
            &key("work", "example-app")
        ),
        Ok(None)
    );
    assert_eq!(f.raw(), raw);
    assert_eq!(
        bind(
            &f.store,
            &fs,
            &reader,
            &exe(OTHER),
            &fence,
            &key("work", "unknown")
        ),
        Err("nexo.local.notFound".into())
    );
    assert_eq!(f.raw(), raw);
    assert_eq!(
        bind(
            &f.store,
            &fs,
            &reader,
            &exe("C:\\Apps\\missing.exe"),
            &fence,
            &key("work", "example-app")
        ),
        Err("nexo.local.missing".into())
    );
    assert_eq!(f.raw(), raw);
    let binding = bind(
        &f.store,
        &fs,
        &reader,
        &exe(OTHER),
        &fence,
        &key("work", "example-app"),
    )
    .unwrap()
    .unwrap();
    assert_eq!(binding.executable, OTHER);
    let saved = f.json();
    assert_eq!(saved["localBindings"].as_array().unwrap().len(), 2);
    assert_eq!(saved["localBindings"][0]["metadata"]["keep"], 4);
    assert_eq!(saved["localBindings"][1]["metadata"]["keep"], 5);
    assert_eq!(saved["localBindings"][1]["sourceId"], "personal");
}

#[test]
fn unbind_removes_only_the_selected_association_even_if_the_catalog_disappears() {
    let f = Fixture::new();
    assert_eq!(unbind(&f.store, &key("work", "example-app")), Ok(()));
    let saved = f.json();
    assert_eq!(saved["localBindings"].as_array().unwrap().len(), 1);
    assert_eq!(saved["localBindings"][0]["sourceId"], "personal");
    assert_eq!(saved["sources"].as_array().unwrap().len(), 3);
    let raw = f.raw();
    assert_eq!(
        unbind(&f.store, &key("work", "example-app")),
        Err("nexo.local.notFound".into())
    );
    assert_eq!(f.raw(), raw);
}

#[test]
fn open_rereads_source_and_revalidates_the_bound_executable_before_direct_spawn() {
    let f = Fixture::new();
    let fs = FakeFs::new();
    let reader = Reader::default();
    let launcher = FakeLauncher::default();
    let fence = RefreshFence::default();
    let target = key("work", "example-app");
    let raw = f.raw();
    reader.put(OLD, &document().to_string());
    open(&f.store, &fs, &reader, &launcher, &fence, &target).unwrap();
    assert_eq!(*launcher.paths.borrow(), [EXE]);
    reader.put(OLD, "{");
    assert_eq!(
        open(&f.store, &fs, &reader, &launcher, &fence, &target),
        Err("nexo.local.catalogInvalid".into())
    );
    reader.put(OLD, &json!({"schemaVersion":1,"apps":[]}).to_string());
    assert_eq!(
        open(&f.store, &fs, &reader, &launcher, &fence, &target),
        Err("nexo.local.notFound".into())
    );
    reader.put(OLD, &document().to_string());
    fs.set(EXE, Err(FsError::Missing));
    assert_eq!(
        open(&f.store, &fs, &reader, &launcher, &fence, &target),
        Err("nexo.local.missing".into())
    );
    fs.set(EXE, Ok(FileKind::Reparse));
    assert_eq!(
        open(&f.store, &fs, &reader, &launcher, &fence, &target),
        Err("nexo.local.refused".into())
    );
    fs.set(EXE, Ok(FileKind::File));
    launcher.fail.set(true);
    assert_eq!(
        open(&f.store, &fs, &reader, &launcher, &fence, &target),
        Err("nexo.local.spawnFailed".into())
    );
    assert_eq!(launcher.paths.borrow().len(), 1);
    assert_eq!(f.raw(), raw);
    unbind(&f.store, &target).unwrap();
    assert_eq!(
        open(&f.store, &fs, &reader, &launcher, &fence, &target),
        Err("nexo.local.unbound".into())
    );
}
