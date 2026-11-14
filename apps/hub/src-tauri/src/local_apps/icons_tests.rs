use super::*;
use crate::local_apps::{FileKind, FsError};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\0\0\0\0\x3a\x7e\x9b\x55\0\0\0\rIDAT\x78\x01\x01\x02\0\xfd\xff\0\0\0\x02\0\x01\x7e\x05\x0d\xd2\0\0\0\0IEND\xae\x42\x60\x82";

// Build valid uncompressed grayscale PNGs with independent CRCs and zlib checksums.
fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut result = Vec::new();
    result.extend_from_slice(&(data.len() as u32).to_be_bytes());
    result.extend_from_slice(kind);
    result.extend_from_slice(data);
    let mut crc = !0_u32;
    for byte in kind.iter().chain(data) {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & 0_u32.wrapping_sub(crc & 1));
        }
    }
    result.extend_from_slice(&(!crc).to_be_bytes());
    result
}

fn valid_png(width: u32, height: u32) -> Vec<u8> {
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.extend_from_slice(&[8, 0, 0, 0, 0]);
    let raw = vec![0_u8; (width as usize + 1) * height as usize];
    let mut zlib = vec![0x78, 0x01];
    let blocks = raw.chunks(65535);
    let count = blocks.len();
    if count == 0 {
        zlib.extend_from_slice(&[1, 0, 0, 255, 255]);
    }
    for (index, block) in blocks.enumerate() {
        zlib.push(u8::from(index + 1 == count));
        let len = block.len() as u16;
        zlib.extend_from_slice(&len.to_le_bytes());
        zlib.extend_from_slice(&(!len).to_le_bytes());
        zlib.extend_from_slice(block);
    }
    let mut a = 1_u32;
    let mut b = 0_u32;
    for byte in raw {
        a = (a + u32::from(byte)) % 65521;
        b = (b + a) % 65521;
    }
    zlib.extend_from_slice(&((b << 16) | a).to_be_bytes());
    [
        b"\x89PNG\r\n\x1a\n".to_vec(),
        chunk(b"IHDR", &ihdr),
        chunk(b"IDAT", &zlib),
        chunk(b"IEND", &[]),
    ]
    .concat()
}

fn sized_png(size: usize) -> Vec<u8> {
    let image = valid_png(1, 1);
    let padding = chunk(b"npAg", &vec![0; size - image.len() - 12]);
    [
        image[..image.len() - 12].to_vec(),
        padding,
        image[image.len() - 12..].to_vec(),
    ]
    .concat()
}

fn valid_ico() -> Vec<u8> {
    let image = valid_png(1, 1);
    let mut result = vec![0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0];
    result.extend_from_slice(&(image.len() as u32).to_le_bytes());
    result.extend_from_slice(&22_u32.to_le_bytes());
    result.extend_from_slice(&image);
    result
}

#[test]
fn selected_png_requires_bounded_ihdr_complete_chunks_and_correct_crcs() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    fs.selected("C:\\Images\\original.png", &valid_png(1, 1));
    pick_icon(&f.store, &fs, &pick("C:\\Images\\original.png"), "manual-1").unwrap();
    let original = f.raw();
    let copies = fs.copies.borrow().clone();
    let mut bad_crc = valid_png(1, 1);
    bad_crc[29] ^= 1;
    let mut bad_length = valid_png(1, 1);
    bad_length[8..12].copy_from_slice(&u32::MAX.to_be_bytes());
    let complete = valid_png(1, 1);
    let mut bad_data_crc = complete.clone();
    bad_data_crc[complete.len() - 13] ^= 1;
    let mut bad_end_crc = complete.clone();
    *bad_end_crc.last_mut().unwrap() ^= 1;
    let mut trailing = complete.clone();
    trailing.push(0);
    let no_idat = [complete[..33].to_vec(), chunk(b"IEND", &[])].concat();
    for (label, bytes) in [
        ("signature only", b"\x89PNG\r\n\x1a\n".to_vec()),
        ("zero width", valid_png(0, 1)),
        ("zero height", valid_png(1, 0)),
        ("wide", valid_png(513, 1)),
        ("tall", valid_png(1, 513)),
        ("bad IHDR CRC", bad_crc),
        ("bad IDAT CRC", bad_data_crc),
        ("bad IEND CRC", bad_end_crc),
        ("bad chunk length", bad_length),
        ("missing IEND", complete[..complete.len() - 12].to_vec()),
        ("missing IDAT", no_idat),
        ("trailing data", trailing),
    ] {
        fs.selected("C:\\Images\\bad.png", &bytes);
        assert_eq!(
            pick_icon(&f.store, &fs, &pick("C:\\Images\\bad.png"), "manual-1"),
            Err("nexo.local.invalidIcon".into()),
            "{label}"
        );
        assert_eq!(f.raw(), original, "{label}");
        assert_eq!(*fs.copies.borrow(), copies, "{label}");
        assert!(fs.deleted.borrow().is_empty(), "{label}");
    }
    fs.selected("C:\\Images\\boundary.png", &valid_png(512, 512));
    assert!(
        pick_icon(&f.store, &fs, &pick("C:\\Images\\boundary.png"), "manual-1")
            .unwrap()
            .is_some()
    );
}

#[test]
fn selected_ico_requires_a_bounded_complete_directory_and_in_bounds_images() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    fs.selected("C:\\Images\\original.ico", &valid_ico());
    pick_icon(&f.store, &fs, &pick("C:\\Images\\original.ico"), "manual-1").unwrap();
    let original = f.raw();
    let copies = fs.copies.borrow().clone();
    let complete = valid_ico();
    let mut reserved = complete.clone();
    reserved[0] = 1;
    let mut wrong_type = complete.clone();
    wrong_type[2] = 2;
    let mut zero_count = complete.clone();
    zero_count[4..6].copy_from_slice(&0_u16.to_le_bytes());
    let mut too_many = complete.clone();
    too_many[4..6].copy_from_slice(&65_u16.to_le_bytes());
    let mut empty = complete.clone();
    empty[14..18].copy_from_slice(&0_u32.to_le_bytes());
    let mut inside_directory = complete.clone();
    inside_directory[18..22].copy_from_slice(&6_u32.to_le_bytes());
    let mut out_of_bounds = complete.clone();
    out_of_bounds[18..22].copy_from_slice(&u32::MAX.to_le_bytes());
    let mut large_entry = complete.clone();
    large_entry[14..18].copy_from_slice(&u32::MAX.to_le_bytes());
    for (label, bytes) in [
        ("header only", complete[..6].to_vec()),
        ("reserved", reserved),
        ("type", wrong_type),
        ("zero count", zero_count),
        ("too many", too_many),
        ("truncated directory", complete[..21].to_vec()),
        ("empty entry", empty),
        ("inside directory", inside_directory),
        ("outside file", out_of_bounds),
        ("oversized entry", large_entry),
    ] {
        fs.selected("C:\\Images\\bad.ico", &bytes);
        assert_eq!(
            pick_icon(&f.store, &fs, &pick("C:\\Images\\bad.ico"), "manual-1"),
            Err("nexo.local.invalidIcon".into()),
            "{label}"
        );
        assert_eq!(f.raw(), original, "{label}");
        assert_eq!(*fs.copies.borrow(), copies, "{label}");
        assert!(fs.deleted.borrow().is_empty(), "{label}");
    }
    let image = valid_png(1, 1);
    let mut boundary = vec![0, 0, 1, 0, 64, 0];
    for _ in 0..64 {
        boundary.extend_from_slice(&[1, 1, 0, 0, 1, 0, 32, 0]);
        boundary.extend_from_slice(&(image.len() as u32).to_le_bytes());
        boundary.extend_from_slice(&1030_u32.to_le_bytes());
    }
    boundary.extend_from_slice(&image);
    fs.selected("C:\\Images\\boundary.ico", &boundary);
    assert!(
        pick_icon(&f.store, &fs, &pick("C:\\Images\\boundary.ico"), "manual-1")
            .unwrap()
            .is_some()
    );
}

fn expected_url(mime: &str, bytes: &[u8]) -> String {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = format!("data:{mime};base64,");
    let prefix_len = output.len();
    let mut bits = 0_u32;
    let mut available = 0;
    for byte in bytes {
        bits = (bits << 8) | u32::from(*byte);
        available += 8;
        while available >= 6 {
            available -= 6;
            output.push(alphabet[((bits >> available) & 63) as usize] as char);
        }
    }
    if available > 0 {
        output.push(alphabet[((bits << (6 - available)) & 63) as usize] as char);
    }
    while !(output.len() - prefix_len).is_multiple_of(4) {
        output.push('=');
    }
    output
}

#[test]
fn icon_data_is_id_scoped_and_returns_revalidated_owned_png_and_ico() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    assert_eq!(icon_data(&f.store, &fs, "manual-1"), None);
    assert_eq!(icon_data(&f.store, &fs, "missing"), None);
    fs.selected("C:\\Images\\one.png", &valid_png(1, 1));
    let png_name = pick_icon(&f.store, &fs, &pick("C:\\Images\\one.png"), "manual-1")
        .unwrap()
        .unwrap()
        .app
        .icon
        .unwrap();
    let mut document = f.json();
    let mut other = document["localApps"][0].clone();
    other["id"] = json!("manual-2");
    other["icon"] = Value::Null;
    document["localApps"].as_array_mut().unwrap().push(other);
    std::fs::write(f.dir.join("config.json"), document.to_string()).unwrap();
    fs.selected("C:\\Images\\two.ico", &valid_ico());
    let ico_name = pick_icon(&f.store, &fs, &pick("C:\\Images\\two.ico"), "manual-2")
        .unwrap()
        .unwrap()
        .app
        .icon
        .unwrap();
    let original = f.raw();
    assert_eq!(
        icon_data(&f.store, &fs, "manual-1"),
        Some("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAADUlEQVR4AQECAP3/AAAAAgABfgUN0gAAAABJRU5ErkJggg==".into())
    );
    assert_eq!(
        icon_data(&f.store, &fs, "manual-2"),
        Some(expected_url("image/x-icon", &valid_ico()))
    );
    assert_eq!(icon_data(&f.store, &fs, "C:\\Images\\one.png"), None);
    assert_eq!(icon_data(&f.store, &fs, &png_name), None);
    assert_eq!(f.raw(), original);
    let mut invalid = valid_png(1, 1);
    invalid[29] ^= 1;
    fs.copies.borrow_mut().insert(png_name.clone(), invalid);
    assert_eq!(icon_data(&f.store, &fs, "manual-1"), None);
    fs.copies.borrow_mut().insert(png_name.clone(), valid_ico());
    assert_eq!(icon_data(&f.store, &fs, "manual-1"), None);
    fs.copies
        .borrow_mut()
        .insert(png_name, sized_png(MAX_ICON_BYTES + 1));
    assert_eq!(icon_data(&f.store, &fs, "manual-1"), None);
    fs.fail_read.set(true);
    assert_eq!(icon_data(&f.store, &fs, "manual-2"), None);
    fs.fail_read.set(false);
    let mut invalid_ico = valid_ico();
    invalid_ico[18..22].copy_from_slice(&u32::MAX.to_le_bytes());
    fs.copies.borrow_mut().insert(ico_name.clone(), invalid_ico);
    assert_eq!(icon_data(&f.store, &fs, "manual-2"), None);
    fs.copies.borrow_mut().remove(&ico_name);
    assert_eq!(icon_data(&f.store, &fs, "manual-2"), None);
    assert_eq!(f.raw(), original);
}

#[test]
fn icon_data_never_reads_a_stored_path_or_unmanaged_name() {
    let f = Fixture::new();
    let fs = FakeFs::default();
    for icon in [
        "C:\\Images\\one.png",
        "../icon-1.png",
        "icon-1.png/../../secret",
        "icon-1.gif",
    ] {
        let mut document = f.json();
        document["localApps"][0]["icon"] = json!(icon);
        std::fs::write(f.dir.join("config.json"), document.to_string()).unwrap();
        let original = f.raw();
        assert_eq!(icon_data(&f.store, &fs, "manual-1"), None, "{icon}");
        assert!(fs.reads.borrow().is_empty(), "{icon}");
        assert_eq!(f.raw(), original);
    }
}

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
    fn read_owned_icon(&self, name: &str) -> Result<Vec<u8>, String> {
        self.reads.borrow_mut().push(name.into());
        if self.fail_read.get() {
            return Err("nexo.local.iconReadFailed".into());
        }
        self.copies
            .borrow()
            .get(name)
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
    fs.selected("C:\\Images\\two.ICO", &valid_ico());
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
    assert_eq!(fs.copies.borrow().get(&newer).unwrap(), &valid_ico());
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
    let bytes = sized_png(MAX_ICON_BYTES);
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
