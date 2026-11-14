use super::*;
use crate::config::Patch;
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    dir: PathBuf,
    store: Store,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nexo-local-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).unwrap();
        let store = Store::new(dir.join("config.json"));
        Self { dir, store }
    }
    fn seed(&self) {
        std::fs::write(self.dir.join("config.json"), json!({
            "version": 3, "language":"en", "compact":true, "unknown":42,
            "sources":[{"id":"official","label":"Official","kind":"official","metadata":{"keep":1}}],
            "localApps":[{"id":"manual-1","name":"Original","executable":"C:\\Apps\\App.EXE","icon":"C:\\icon.png","metadata":{"keep":2}}],
            "localBindings":[{"sourceId":"source","appId":"other","executable":"C:\\Apps\\Other.exe","metadata":{"keep":3}}]
        }).to_string()).unwrap();
    }
    fn raw(&self) -> String {
        std::fs::read_to_string(self.dir.join("config.json")).unwrap()
    }
    fn json(&self) -> Value {
        serde_json::from_str(&self.raw()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.dir).unwrap();
    }
}

struct FakeFs {
    fixed: Cell<bool>,
    entries: RefCell<HashMap<String, Result<FileKind, FsError>>>,
}
impl FakeFs {
    fn new() -> Self {
        Self {
            fixed: Cell::new(true),
            entries: RefCell::new(HashMap::from([
                ("C:\\".into(), Ok(FileKind::Directory)),
                ("C:\\Apps".into(), Ok(FileKind::Directory)),
                ("C:\\Apps\\App.EXE".into(), Ok(FileKind::File)),
                ("C:\\Apps\\Other.exe".into(), Ok(FileKind::File)),
            ])),
        }
    }
    fn set(&self, path: &str, kind: Result<FileKind, FsError>) {
        self.entries.borrow_mut().insert(path.into(), kind);
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
struct FakePicker(Result<Option<String>, String>);
impl Picker for FakePicker {
    fn pick_executable(&self) -> Result<Option<String>, String> {
        self.0.clone()
    }
}
fn pick(path: &str) -> FakePicker {
    FakePicker(Ok(Some(path.into())))
}
#[derive(Default)]
struct FakeLauncher {
    launches: RefCell<Vec<String>>,
    fail: Cell<bool>,
}
impl Launcher for FakeLauncher {
    fn spawn(&self, executable: &str) -> Result<(), String> {
        if self.fail.get() {
            return Err("nexo.local.spawnFailed".into());
        }
        self.launches.borrow_mut().push(executable.into());
        Ok(())
    }
}

#[test]
fn validation_accepts_only_absolute_fixed_executable_files_and_rejects_unsafe_paths() {
    let fs = FakeFs::new();
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\App.EXE"),
        Ok("C:\\Apps\\App.EXE".into())
    );
    for path in [
        "relative.exe",
        "C:relative.exe",
        "\\\\server\\share\\app.exe",
        "\\\\?\\C:\\app.exe",
        "C:\\Apps\\..\\app.exe",
        "C:\\Apps\\file.exe:stream",
        "C:\\Apps\\.\\App.EXE",
    ] {
        assert_eq!(
            validate_executable(&fs, path),
            Err("nexo.local.refused".into()),
            "{path}"
        );
    }
    fs.fixed.set(false);
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\App.EXE"),
        Err("nexo.local.refused".into())
    );
    fs.fixed.set(true);
    fs.set("C:\\Apps", Ok(FileKind::Reparse));
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\App.EXE"),
        Err("nexo.local.refused".into())
    );
    fs.set("C:\\Apps", Ok(FileKind::Directory));
    fs.set("C:\\Apps\\App.EXE", Ok(FileKind::Reparse));
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\App.EXE"),
        Err("nexo.local.refused".into())
    );
    fs.set("C:\\Apps\\App.EXE", Err(FsError::Refused));
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\App.EXE"),
        Err("nexo.local.refused".into())
    );
}

#[test]
fn validation_reports_missing_and_not_executable_distinctly() {
    let fs = FakeFs::new();
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\Missing.exe"),
        Err("nexo.local.missing".into())
    );
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\App.txt"),
        Err("nexo.local.notExecutable".into())
    );
    fs.set("C:\\Apps\\dir.exe", Ok(FileKind::Directory));
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\dir.exe"),
        Err("nexo.local.notExecutable".into())
    );
}

#[test]
fn add_uses_picker_defaults_to_stem_warns_on_duplicate_and_preserves_existing_data() {
    let f = Fixture::new();
    f.seed();
    let fs = FakeFs::new();
    let selected = add(&f.store, &fs, &pick("C:\\Apps\\App.EXE"))
        .unwrap()
        .unwrap();
    assert_eq!(selected.app.name, "App");
    assert_eq!(selected.app.executable, "C:\\Apps\\App.EXE");
    assert_ne!(selected.app.id, "manual-1");
    assert!(selected.duplicate);
    let reloaded = f.store.read().settings;
    assert_eq!(reloaded.local_apps.len(), 2);
    assert_eq!(reloaded.local_apps[1], selected.app);
    let raw = f.json();
    assert_eq!(raw["unknown"], 42);
    assert_eq!(raw["sources"][0]["metadata"]["keep"], 1);
    assert_eq!(raw["localApps"][0]["metadata"]["keep"], 2);
    assert_eq!(raw["localBindings"][0]["metadata"]["keep"], 3);
    assert!(reloaded.compact);
}

#[test]
fn cancel_or_invalid_selection_never_changes_data() {
    let f = Fixture::new();
    f.seed();
    let original = f.raw();
    let fs = FakeFs::new();
    assert_eq!(add(&f.store, &fs, &FakePicker(Ok(None))), Ok(None));
    assert_eq!(f.raw(), original);
    assert_eq!(
        add(&f.store, &fs, &pick("C:\\Apps\\Missing.exe")),
        Err("nexo.local.missing".into())
    );
    assert_eq!(f.raw(), original);
    assert_eq!(
        add(
            &f.store,
            &fs,
            &FakePicker(Err("nexo.local.dialogFailed".into()))
        ),
        Err("nexo.local.dialogFailed".into())
    );
    assert_eq!(f.raw(), original);
}

#[test]
fn update_renames_only_the_record_and_rejects_invalid_names_and_unknown_ids() {
    let f = Fixture::new();
    f.seed();
    let saved = update(&f.store, "manual-1", "  Renamed  ").unwrap();
    assert_eq!(saved.app.name, "Renamed");
    assert_eq!(saved.app.executable, "C:\\Apps\\App.EXE");
    assert_eq!(saved.app.icon.as_deref(), Some("C:\\icon.png"));
    assert_eq!(f.json()["localApps"][0]["metadata"]["keep"], 2);
    let original = f.raw();
    for name in ["", "   ", "bad\nname"] {
        assert_eq!(
            update(&f.store, "manual-1", name),
            Err("nexo.local.invalidName".into())
        );
        assert_eq!(f.raw(), original);
    }
    assert_eq!(
        update(&f.store, "missing", "Valid"),
        Err("nexo.local.notFound".into())
    );
    assert_eq!(f.raw(), original);
}

#[test]
fn remove_changes_only_the_selected_entry_and_never_the_selected_files() {
    let f = Fixture::new();
    f.seed();
    let executable = f.dir.join("actual.exe");
    let icon = f.dir.join("actual.png");
    std::fs::write(&executable, b"executable fixture").unwrap();
    std::fs::write(&icon, b"icon fixture").unwrap();
    let mut document = f.json();
    document["localApps"][0]["executable"] = json!(executable.to_str().unwrap());
    document["localApps"][0]["icon"] = json!(icon.to_str().unwrap());
    std::fs::write(f.dir.join("config.json"), document.to_string()).unwrap();
    remove(&f.store, "manual-1").unwrap();
    assert_eq!(std::fs::read(&executable).unwrap(), b"executable fixture");
    assert_eq!(std::fs::read(&icon).unwrap(), b"icon fixture");
    let raw = f.json();
    assert_eq!(raw["localApps"], json!([]));
    assert_eq!(raw["localBindings"][0]["metadata"]["keep"], 3);
    assert_eq!(raw["sources"][0]["metadata"]["keep"], 1);
    let original = f.raw();
    assert_eq!(
        remove(&f.store, "missing"),
        Err("nexo.local.notFound".into())
    );
    assert_eq!(f.raw(), original);
}

#[test]
fn repair_preserves_record_on_cancel_or_failure_and_updates_only_selected_path() {
    let f = Fixture::new();
    f.seed();
    let fs = FakeFs::new();
    let original = f.raw();
    assert_eq!(
        repair(&f.store, &fs, &FakePicker(Ok(None)), "manual-1"),
        Ok(None)
    );
    assert_eq!(f.raw(), original);
    assert_eq!(
        repair(&f.store, &fs, &pick("C:\\Apps\\Missing.exe"), "manual-1"),
        Err("nexo.local.missing".into())
    );
    assert_eq!(f.raw(), original);
    let result = repair(&f.store, &fs, &pick("C:\\Apps\\Other.exe"), "manual-1")
        .unwrap()
        .unwrap();
    assert_eq!(result.app.name, "Original");
    assert_eq!(result.app.executable, "C:\\Apps\\Other.exe");
    assert!(result.duplicate);
    assert_eq!(result.app.icon.as_deref(), Some("C:\\icon.png"));
    assert_eq!(f.json()["localApps"][0]["metadata"]["keep"], 2);
}

#[test]
fn open_revalidates_stored_entry_immediately_before_direct_spawn_and_surfaces_failure() {
    let f = Fixture::new();
    f.seed();
    let fs = FakeFs::new();
    let launcher = FakeLauncher::default();
    open(&f.store, &fs, &launcher, "manual-1").unwrap();
    assert_eq!(*launcher.launches.borrow(), ["C:\\Apps\\App.EXE"]);
    let original = f.raw();
    assert_eq!(
        open(&f.store, &fs, &launcher, "C:\\Apps\\Other.exe"),
        Err("nexo.local.notFound".into())
    );
    fs.set("C:\\Apps\\App.EXE", Err(FsError::Missing));
    assert_eq!(
        open(&f.store, &fs, &launcher, "manual-1"),
        Err("nexo.local.missing".into())
    );
    fs.set("C:\\Apps\\App.EXE", Ok(FileKind::Reparse));
    assert_eq!(
        open(&f.store, &fs, &launcher, "manual-1"),
        Err("nexo.local.refused".into())
    );
    fs.set("C:\\Apps\\App.EXE", Ok(FileKind::File));
    launcher.fail.set(true);
    assert_eq!(
        open(&f.store, &fs, &launcher, "manual-1"),
        Err("nexo.local.spawnFailed".into())
    );
    assert_eq!(launcher.launches.borrow().len(), 1);
    assert_eq!(f.raw(), original);
}

#[test]
fn local_operations_preserve_existing_settings_patch_behavior_and_failed_saves() {
    let f = Fixture::new();
    f.seed();
    let fs = FakeFs::new();
    f.store
        .patch(Patch {
            language: Some("es".into()),
            ..Default::default()
        })
        .unwrap();
    add(&f.store, &fs, &pick("C:\\Apps\\Other.exe")).unwrap();
    assert_eq!(f.store.read().settings.language, "es");
    f.store
        .patch(Patch {
            compact: Some(false),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(f.store.read().settings.local_apps.len(), 2);
    let future = Fixture::new();
    std::fs::write(future.dir.join("config.json"), "{\"version\":999}").unwrap();
    assert_eq!(
        add(&future.store, &fs, &pick("C:\\Apps\\Other.exe")),
        Err("nexo.config.save.future".into())
    );
    assert_eq!(future.raw(), "{\"version\":999}");
}

#[test]
fn concurrent_local_add_and_settings_patch_share_the_same_lock() {
    use crate::config::ConfigLock;
    use std::sync::{Arc, Barrier};

    let f = Fixture::new();
    f.seed();
    let lock = Arc::new(ConfigLock::default());
    let barrier = Arc::new(Barrier::new(2));
    let path = f.dir.join("config.json");
    let add_lock = Arc::clone(&lock);
    let add_barrier = Arc::clone(&barrier);
    let add_path = path.clone();
    let adding = std::thread::spawn(move || {
        let store = Store::new(add_path);
        add_barrier.wait();
        add_lock
            .with_store(&store, |store| {
                add(store, &FakeFs::new(), &pick("C:\\Apps\\Other.exe"))
            })
            .unwrap();
    });
    let patching = std::thread::spawn(move || {
        let store = Store::new(path);
        barrier.wait();
        lock.with_store(&store, |store| {
            store.patch(Patch {
                language: Some("es".into()),
                ..Default::default()
            })
        })
        .unwrap();
    });
    adding.join().unwrap();
    patching.join().unwrap();
    let settings = f.store.read().settings;
    assert_eq!(settings.language, "es");
    assert_eq!(settings.local_apps.len(), 2);
    assert_eq!(settings.local_bindings.len(), 1);
}
