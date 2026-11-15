use super::*;
use crate::local_apps::{FileKind, FsError};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};

static NEXT: AtomicU64 = AtomicU64::new(0);
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\0\0\0\0\x3a\x7e\x9b\x55\0\0\0\rIDAT\x78\x01\x01\x02\0\xfd\xff\0\0\0\x02\0\x01\x7e\x05\x0d\xd2\0\0\0\0IEND\xae\x42\x60\x82";
struct Fixture {
    dir: PathBuf,
    store: Store,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nexo-token-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).unwrap();
        let store = Store::new(dir.join("config.json"));
        std::fs::write(
            dir.join("config.json"),
            r#"{"version":4,"language":"en","localApps":[]}"#,
        )
        .unwrap();
        Self { dir, store }
    }
    fn raw(&self) -> String {
        std::fs::read_to_string(self.dir.join("config.json")).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.dir).unwrap();
    }
}
#[derive(Default)]
struct FakeFs {
    missing: Cell<bool>,
    bytes: RefCell<Vec<u8>>,
    copies: RefCell<HashMap<String, Vec<u8>>>,
}
impl ExecutableFs for FakeFs {
    fn fixed_disk(&self, root: &str) -> bool {
        root == "C:\\"
    }
    fn inspect(&self, path: &str) -> Result<FileKind, FsError> {
        match path {
            "C:\\" | "C:\\Apps" | "C:\\Images" => Ok(FileKind::Directory),
            "C:\\Apps\\Paint.exe" if !self.missing.get() => Ok(FileKind::File),
            "C:\\Images\\icon.png" | "C:\\Images\\icon.ico" => Ok(FileKind::File),
            _ => Err(FsError::Missing),
        }
    }
}
impl IconFs for FakeFs {
    fn read_icon(&self, _: &str) -> Result<Vec<u8>, String> {
        Ok(self.bytes.borrow().clone())
    }
    fn read_owned_icon(&self, name: &str) -> Result<Vec<u8>, String> {
        self.copies
            .borrow()
            .get(name)
            .cloned()
            .ok_or_else(|| "nexo.local.iconReadFailed".into())
    }
    fn save_icon(&self, bytes: &[u8], extension: &str) -> Result<String, String> {
        let name = format!("icon-1.{extension}");
        self.copies
            .borrow_mut()
            .insert(name.clone(), bytes.to_vec());
        Ok(name)
    }
    fn delete_icon(&self, name: &str) -> Result<(), String> {
        self.copies.borrow_mut().remove(name);
        Ok(())
    }
}
struct ExePicker(Option<&'static str>);
impl Picker for ExePicker {
    fn pick_executable(&self) -> Result<Option<String>, String> {
        Ok(self.0.map(str::to_owned))
    }
}
struct ImgPicker(Option<&'static str>);
impl IconPicker for ImgPicker {
    fn pick_icon(&self) -> Result<Option<String>, String> {
        Ok(self.0.map(str::to_owned))
    }
}
fn exe(pending: &mut PendingSelections, fs: &FakeFs, now: Instant) -> ExecutableSelection {
    pending
        .pick_executable(
            fs,
            &ExePicker(Some("C:\\Apps\\Paint.exe")),
            pending.generation(),
            now,
        )
        .unwrap()
        .unwrap()
}
fn icon(pending: &mut PendingSelections, fs: &FakeFs, now: Instant) -> IconSelection {
    pending
        .pick_icon(
            fs,
            &ImgPicker(Some("C:\\Images\\icon.png")),
            pending.generation(),
            now,
        )
        .unwrap()
        .unwrap()
}

#[test]
fn picker_issues_an_opaque_token_without_persisting_and_create_redeems_it_once() {
    let f = Fixture::new();
    let original = f.raw();
    let fs = FakeFs::default();
    let now = Instant::now();
    let mut pending = PendingSelections::default();
    let selected = exe(&mut pending, &fs, now);
    assert_eq!(selected.path, "C:\\Apps\\Paint.exe");
    assert_eq!(selected.suggested_name, "Paint");
    assert_ne!(selected.token, selected.path);
    assert_eq!(f.raw(), original);
    assert_eq!(
        pending.create(&f.store, &fs, &selected.token, "  ", None, now),
        Err("nexo.local.invalidName".into())
    );
    assert_eq!(f.raw(), original);
    let saved = pending
        .create(&f.store, &fs, &selected.token, " Custom ", None, now)
        .unwrap();
    assert_eq!(saved.app.name, "Custom");
    assert_eq!(saved.app.executable, selected.path);
    assert_eq!(saved.app.icon, None);
    assert_eq!(f.store.read().settings.local_apps, vec![saved.app]);
    let after = f.raw();
    for invalid in [&selected.token, &selected.path, &"unknown".to_owned()] {
        assert_eq!(
            pending.create(&f.store, &fs, invalid, "Other", None, now),
            Err("nexo.local.refused".into())
        );
        assert_eq!(f.raw(), after);
    }
}

#[test]
fn expiry_cancel_and_inflight_generation_reject_stale_tokens_without_writes() {
    let f = Fixture::new();
    let original = f.raw();
    let fs = FakeFs::default();
    let now = Instant::now();
    let mut pending = PendingSelections::default();
    let selected = exe(&mut pending, &fs, now);
    assert_eq!(
        pending.create(
            &f.store,
            &fs,
            &selected.token,
            "Paint",
            None,
            now + Duration::from_secs(600)
        ),
        Err("nexo.local.refused".into())
    );
    assert_eq!(f.raw(), original);
    let selected = exe(&mut pending, &fs, now);
    let generation = pending.generation();
    pending.cancel();
    assert_eq!(
        pending.create(&f.store, &fs, &selected.token, "Paint", None, now),
        Err("nexo.local.refused".into())
    );
    assert!(
        pending
            .pick_executable(
                &fs,
                &ExePicker(Some("C:\\Apps\\Paint.exe")),
                generation,
                now
            )
            .is_err()
    );
    assert_eq!(f.raw(), original);
    assert!(fs.copies.borrow().is_empty());
}

#[test]
fn executable_selection_and_redemption_revalidate_missing_non_executable_and_refused_paths() {
    let f = Fixture::new();
    let original = f.raw();
    let fs = FakeFs::default();
    let now = Instant::now();
    let mut pending = PendingSelections::default();
    for (path, expected) in [
        ("C:\\Apps\\missing.exe", "nexo.local.missing"),
        ("C:\\Apps\\bad.txt", "nexo.local.notExecutable"),
        ("\\\\server\\share\\bad.exe", "nexo.local.refused"),
    ] {
        assert_eq!(
            pending
                .pick_executable(&fs, &ExePicker(Some(path)), pending.generation(), now)
                .unwrap_err(),
            expected
        );
        assert_eq!(f.raw(), original);
    }
    assert!(
        pending
            .pick_executable(&fs, &ExePicker(None), pending.generation(), now)
            .unwrap()
            .is_none()
    );
    let selected = exe(&mut pending, &fs, now);
    fs.missing.set(true);
    assert_eq!(
        pending.create(&f.store, &fs, &selected.token, "Paint", None, now),
        Err("nexo.local.missing".into())
    );
    assert_eq!(f.raw(), original);
    assert!(fs.copies.borrow().is_empty());
}

#[test]
fn icons_are_validated_at_pick_copied_only_on_create_and_tokens_cannot_be_swapped() {
    let f = Fixture::new();
    let original = f.raw();
    let fs = FakeFs::default();
    let now = Instant::now();
    let mut pending = PendingSelections::default();
    *fs.bytes.borrow_mut() = PNG.to_vec();
    let selected = exe(&mut pending, &fs, now);
    let image = icon(&mut pending, &fs, now);
    assert!(image.preview.starts_with("data:image/png;base64,"));
    assert_ne!(image.token, selected.token);
    assert_eq!(f.raw(), original);
    assert!(fs.copies.borrow().is_empty());
    assert_eq!(
        pending.create(
            &f.store,
            &fs,
            &image.token,
            "Paint",
            Some(&selected.token),
            now
        ),
        Err("nexo.local.refused".into())
    );
    assert_eq!(
        pending.create(
            &f.store,
            &fs,
            &selected.token,
            "Paint",
            Some("C:\\Images\\icon.png"),
            now
        ),
        Err("nexo.local.refused".into())
    );
    assert_eq!(f.raw(), original);
    assert!(fs.copies.borrow().is_empty());
    let saved = pending
        .create(
            &f.store,
            &fs,
            &selected.token,
            "Paint",
            Some(&image.token),
            now,
        )
        .unwrap();
    assert_eq!(saved.app.icon.as_deref(), Some("icon-1.png"));
    assert_eq!(fs.copies.borrow()["icon-1.png"], PNG);
    let after = f.raw();
    let another = exe(&mut pending, &fs, now);
    assert_eq!(
        pending.create(
            &f.store,
            &fs,
            &another.token,
            "Other",
            Some(&image.token),
            now
        ),
        Err("nexo.local.refused".into())
    );
    assert_eq!(f.raw(), after);
    assert_eq!(fs.copies.borrow().len(), 1);
}

#[test]
fn ico_at_the_exact_size_limit_is_selected_and_copied_on_create() {
    let f = Fixture::new();
    let original = f.raw();
    let fs = FakeFs::default();
    let now = Instant::now();
    let mut pending = PendingSelections::default();
    let mut bytes = vec![0_u8; 512 * 1024];
    bytes[..6].copy_from_slice(&[0, 0, 1, 0, 1, 0]);
    let image_len = (bytes.len() - 22) as u32;
    bytes[14..18].copy_from_slice(&image_len.to_le_bytes());
    bytes[18..22].copy_from_slice(&22_u32.to_le_bytes());
    *fs.bytes.borrow_mut() = bytes.clone();
    let selected = exe(&mut pending, &fs, now);
    let image = pending
        .pick_icon(
            &fs,
            &ImgPicker(Some("C:\\Images\\icon.ico")),
            pending.generation(),
            now,
        )
        .unwrap()
        .unwrap();
    assert!(image.preview.starts_with("data:image/x-icon;base64,"));
    assert_eq!(f.raw(), original);
    assert!(fs.copies.borrow().is_empty());
    let saved = pending
        .create(
            &f.store,
            &fs,
            &selected.token,
            "Paint",
            Some(&image.token),
            now,
        )
        .unwrap();
    assert_eq!(saved.app.icon.as_deref(), Some("icon-1.ico"));
    assert_eq!(fs.copies.borrow()["icon-1.ico"], bytes);
}

#[test]
fn invalid_oversized_or_expired_icons_never_write_anything() {
    let f = Fixture::new();
    let original = f.raw();
    let fs = FakeFs::default();
    let now = Instant::now();
    let mut pending = PendingSelections::default();
    for bytes in [vec![0; 20], vec![0; 512 * 1024 + 1]] {
        *fs.bytes.borrow_mut() = bytes;
        assert_eq!(
            pending
                .pick_icon(
                    &fs,
                    &ImgPicker(Some("C:\\Images\\icon.png")),
                    pending.generation(),
                    now
                )
                .unwrap_err(),
            "nexo.local.invalidIcon"
        );
        assert_eq!(f.raw(), original);
        assert!(fs.copies.borrow().is_empty());
    }
    *fs.bytes.borrow_mut() = PNG.to_vec();
    let image = icon(&mut pending, &fs, now);
    let later = now + Duration::from_secs(600);
    let selected = exe(&mut pending, &fs, later);
    assert_eq!(
        pending.create(
            &f.store,
            &fs,
            &selected.token,
            "Paint",
            Some(&image.token),
            later
        ),
        Err("nexo.local.refused".into())
    );
    assert_eq!(f.raw(), original);
    assert!(fs.copies.borrow().is_empty());
}
