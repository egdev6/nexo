use super::*;
use crate::local_apps::{FileKind, FsError};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfixture";
const ICO: &[u8] = b"\0\0\x01\0\x01\0fixture";

struct Fixture {
    dir: PathBuf,
    store: Store,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nexo-icons-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).unwrap();
        let store = Store::new(dir.join("config.json"));
        let value = json!({"version":3,"language":"en", "unknown":42,
            "localApps":[{"id":"manual-1","name":"App","executable":"C:\\Apps\\App.exe","icon":null,"extra":7}],
            "localBindings":[]});
        std::fs::write(dir.join("config.json"), value.to_string()).unwrap();
        Self { dir, store }
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

#[derive(Default)]
struct FakeFs {
    selected: RefCell<HashMap<String, Vec<u8>>>,
    copies: RefCell<HashMap<String, Vec<u8>>>,
    deleted: RefCell<Vec<String>>,
    reads: RefCell<Vec<String>>,
    reparse: Cell<bool>,
    fail_read: Cell<bool>,
    fail_save: Cell<bool>,
    fail_delete: Cell<bool>,
}
impl FakeFs {
    fn selected(&self, path: &str, bytes: &[u8]) {
        self.selected.borrow_mut().insert(path.into(), bytes.into());
    }
}
impl ExecutableFs for FakeFs {
    fn fixed_disk(&self, root: &str) -> bool {
        root == "C:\\"
    }
    fn inspect(&self, path: &str) -> Result<FileKind, FsError> {
        if path == "C:\\Images" && self.reparse.get() {
            Ok(FileKind::Reparse)
        } else if path == "C:\\" || path == "C:\\Images" {
            Ok(FileKind::Directory)
        } else if self.selected.borrow().contains_key(path) {
            Ok(FileKind::File)
        } else {
            Err(FsError::Missing)
        }
    }
}
impl IconFs for FakeFs {
    fn read_icon(&self, path: &str) -> Result<Vec<u8>, String> {
        self.reads.borrow_mut().push(path.into());
        if self.fail_read.get() {
            return Err("nexo.local.iconReadFailed".into());
        }
        self.selected
            .borrow()
            .get(path)
            .cloned()
            .ok_or_else(|| "nexo.local.iconReadFailed".into())
    }
    fn save_icon(&self, bytes: &[u8], extension: &str) -> Result<String, String> {
        if self.fail_save.get() {
            return Err("nexo.local.iconWriteFailed".into());
        }
        let name = format!(
            "icon-{:x}.{extension}",
            self.copies.borrow().len() + self.deleted.borrow().len() + 1
        );
        self.copies.borrow_mut().insert(name.clone(), bytes.into());
        Ok(name)
    }
    fn delete_icon(&self, name: &str) -> Result<(), String> {
        if self.fail_delete.get() {
            return Err("nexo.local.iconCleanupFailed".into());
        }
        self.deleted.borrow_mut().push(name.into());
        self.copies.borrow_mut().remove(name);
        Ok(())
    }
}
struct FakePicker(Result<Option<String>, String>);
impl IconPicker for FakePicker {
    fn pick_icon(&self) -> Result<Option<String>, String> {
        self.0.clone()
    }
}
fn pick(path: &str) -> FakePicker {
    FakePicker(Ok(Some(path.into())))
}

#[test]
fn selected_png_and_ico_are_copied_under_generated_names_and_replaced_safely() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    fs.selected("C:\\Images\\one.png", PNG);
    fs.selected("C:\\Images\\two.ICO", ICO);
    let first = pick_icon(&f.store, &fs, &pick("C:\\Images\\one.png"), "manual-1")
        .unwrap()
        .unwrap();
    let name = first.app.icon.unwrap();
    assert_ne!(name, "C:\\Images\\one.png");
    assert_eq!(fs.copies.borrow().get(&name).unwrap(), PNG);
    assert_eq!(f.json()["localApps"][0]["extra"], 7);
    assert_eq!(f.json()["unknown"], 42);
    let second = pick_icon(&f.store, &fs, &pick("C:\\Images\\two.ICO"), "manual-1")
        .unwrap()
        .unwrap();
    let newer = second.app.icon.unwrap();
    assert_ne!(name, newer);
    assert_eq!(fs.copies.borrow().get(&newer).unwrap(), ICO);
    assert_eq!(*fs.deleted.borrow(), [name]);
    assert_eq!(
        fs.selected.borrow().get("C:\\Images\\one.png").unwrap(),
        PNG
    );
    assert_eq!(
        f.store.read().settings.local_apps[0].icon.as_deref(),
        Some(newer.as_str())
    );
}

#[test]
fn cancel_invalid_content_oversize_and_unsafe_paths_never_change_saved_data() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    let original = f.raw();
    assert_eq!(
        pick_icon(&f.store, &fs, &FakePicker(Ok(None)), "manual-1"),
        Ok(None)
    );
    assert_eq!(f.raw(), original);
    fs.selected("C:\\Images\\bad.png", b"not an image");
    fs.selected("C:\\Images\\bad.ico", PNG);
    fs.selected(
        "C:\\Images\\large.png",
        &[PNG, &vec![0; MAX_ICON_BYTES]].concat(),
    );
    for (path, error) in [
        ("C:\\Images\\bad.png", "nexo.local.invalidIcon"),
        ("C:\\Images\\bad.ico", "nexo.local.invalidIcon"),
        ("C:\\Images\\large.png", "nexo.local.invalidIcon"),
        ("\\\\server\\share\\img.png", "nexo.local.refused"),
        ("C:\\Images\\..\\file.png", "nexo.local.refused"),
        ("C:\\Images\\file.exe", "nexo.local.invalidIcon"),
    ] {
        assert_eq!(
            pick_icon(&f.store, &fs, &pick(path), "manual-1"),
            Err(error.into()),
            "{path}"
        );
        assert_eq!(f.raw(), original, "{path}");
        assert!(fs.copies.borrow().is_empty(), "{path}");
    }
    assert_eq!(
        *fs.reads.borrow(),
        [
            "C:\\Images\\bad.png",
            "C:\\Images\\bad.ico",
            "C:\\Images\\large.png"
        ]
    );
}

#[test]
fn size_limit_accepts_exactly_512_kib_and_failed_commit_cleans_its_copy() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    let mut bytes = PNG.to_vec();
    bytes.resize(MAX_ICON_BYTES, 0);
    fs.selected("C:\\Images\\maximum.png", &bytes);
    let selected = pick_icon(&f.store, &fs, &pick("C:\\Images\\maximum.png"), "manual-1")
        .unwrap()
        .unwrap();
    assert_eq!(
        fs.copies
            .borrow()
            .get(selected.app.icon.as_ref().unwrap())
            .unwrap()
            .len(),
        MAX_ICON_BYTES
    );
    let original = f.raw();
    assert_eq!(
        pick_icon(&f.store, &fs, &pick("C:\\Images\\maximum.png"), "missing"),
        Err("nexo.local.notFound".into())
    );
    assert_eq!(f.raw(), original);
    assert_eq!(fs.copies.borrow().len(), 1);
}

#[test]
fn filesystem_picker_and_save_failures_preserve_the_record_and_the_selected_file() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    let path = "C:\\Images\\one.png";
    fs.selected(path, PNG);
    let original = f.raw();
    assert_eq!(
        pick_icon(
            &f.store,
            &fs,
            &FakePicker(Err("nexo.local.dialogFailed".into())),
            "manual-1"
        ),
        Err("nexo.local.dialogFailed".into())
    );
    assert_eq!(f.raw(), original);
    fs.reparse.set(true);
    assert_eq!(
        pick_icon(&f.store, &fs, &pick(path), "manual-1"),
        Err("nexo.local.refused".into())
    );
    assert!(fs.reads.borrow().is_empty());
    assert_eq!(f.raw(), original);
    fs.reparse.set(false);
    fs.fail_read.set(true);
    assert_eq!(
        pick_icon(&f.store, &fs, &pick(path), "manual-1"),
        Err("nexo.local.iconReadFailed".into())
    );
    assert_eq!(f.raw(), original);
    fs.fail_read.set(false);
    fs.fail_save.set(true);
    assert_eq!(
        pick_icon(&f.store, &fs, &pick(path), "manual-1"),
        Err("nexo.local.iconWriteFailed".into())
    );
    assert_eq!(f.raw(), original);
    fs.fail_save.set(false);
    std::fs::write(f.dir.join("config.json"), "{\"version\":999}").unwrap();
    assert_eq!(
        pick_icon(&f.store, &fs, &pick(path), "manual-1"),
        Err("nexo.config.save.future".into())
    );
    assert_eq!(f.raw(), "{\"version\":999}");
    assert!(fs.copies.borrow().is_empty());
    assert_eq!(fs.selected.borrow().get(path).unwrap(), PNG);
}

#[test]
fn shared_copies_are_kept_until_the_last_owner_is_removed() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    fs.selected("C:\\Images\\one.png", PNG);
    let name = pick_icon(&f.store, &fs, &pick("C:\\Images\\one.png"), "manual-1")
        .unwrap()
        .unwrap()
        .app
        .icon
        .unwrap();
    let mut document = f.json();
    let mut other = document["localApps"][0].clone();
    other["id"] = json!("manual-2");
    document["localApps"].as_array_mut().unwrap().push(other);
    std::fs::write(f.dir.join("config.json"), document.to_string()).unwrap();
    remove_with_icon(&f.store, &fs, "manual-1").unwrap();
    assert!(fs.deleted.borrow().is_empty());
    assert!(fs.copies.borrow().contains_key(&name));
    remove_with_icon(&f.store, &fs, "manual-2").unwrap();
    assert_eq!(*fs.deleted.borrow(), [name]);
    assert!(fs.copies.borrow().is_empty());
}

#[test]
fn normal_icon_replacement_and_removal_still_clean_up_owned_copies() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    fs.selected("C:\\Images\\one.png", PNG);
    fs.selected("C:\\Images\\two.png", PNG);
    let first = pick_icon(&f.store, &fs, &pick("C:\\Images\\one.png"), "manual-1")
        .unwrap()
        .unwrap()
        .app
        .icon
        .unwrap();
    let second = pick_icon(&f.store, &fs, &pick("C:\\Images\\two.png"), "manual-1")
        .unwrap()
        .unwrap()
        .app
        .icon
        .unwrap();
    assert_eq!(fs.deleted.borrow().as_slice(), std::slice::from_ref(&first));
    assert!(!fs.copies.borrow().contains_key(&first));
    remove_with_icon(&f.store, &fs, "manual-1").unwrap();
    assert_eq!(*fs.deleted.borrow(), [first, second]);
    assert!(fs.copies.borrow().is_empty());
    assert!(f.store.read().settings.local_apps.is_empty());
}

#[test]
fn cleanup_failure_after_replacement_or_removal_reports_the_persisted_result() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    fs.selected("C:\\Images\\one.png", PNG);
    fs.selected("C:\\Images\\two.png", PNG);
    let old = pick_icon(&f.store, &fs, &pick("C:\\Images\\one.png"), "manual-1")
        .unwrap()
        .unwrap()
        .app
        .icon
        .unwrap();
    fs.fail_delete.set(true);
    let saved = pick_icon(&f.store, &fs, &pick("C:\\Images\\two.png"), "manual-1")
        .unwrap()
        .unwrap();
    let new = saved.app.icon.unwrap();
    assert_ne!(new, old);
    assert_eq!(
        f.store.read().settings.local_apps[0].icon.as_deref(),
        Some(new.as_str())
    );
    assert!(fs.copies.borrow().contains_key(&old));
    assert!(fs.copies.borrow().contains_key(&new));
    assert_eq!(remove_with_icon(&f.store, &fs, "manual-1"), Ok(()));
    assert!(f.store.read().settings.local_apps.is_empty());
    assert!(fs.copies.borrow().contains_key(&new));
}

#[test]
fn removal_deletes_only_our_unshared_copy_not_original_or_untrusted_paths() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    fs.selected("C:\\Images\\one.png", PNG);
    let selected = pick_icon(&f.store, &fs, &pick("C:\\Images\\one.png"), "manual-1")
        .unwrap()
        .unwrap();
    let name = selected.app.icon.unwrap();
    remove_with_icon(&f.store, &fs, "manual-1").unwrap();
    assert_eq!(*fs.deleted.borrow(), [name]);
    assert!(fs.copies.borrow().is_empty());
    assert_eq!(
        fs.selected.borrow().get("C:\\Images\\one.png").unwrap(),
        PNG
    );
    assert!(f.store.read().settings.local_apps.is_empty());

    let f = Fixture::new();
    let mut value = f.json();
    value["localApps"][0]["icon"] = json!("C:\\Images\\one.png");
    std::fs::write(f.dir.join("config.json"), value.to_string()).unwrap();
    remove_with_icon(&f.store, &fs, "manual-1").unwrap();
    assert_eq!(fs.deleted.borrow().len(), 1);
}
