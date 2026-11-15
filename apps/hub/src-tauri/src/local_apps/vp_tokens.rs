// vp_ probes (T10): native selection tokens are single-use, expiring,
// generation-bound and never accept a renderer path; rejects keep config bytes.
use super::icons::{IconFs, IconPicker};
use super::selection_tokens::PendingSelections;
use super::*;
use std::cell::RefCell;
use std::time::{Duration, Instant};

const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\0\0\0\0\x3a\x7e\x9b\x55\0\0\0\rIDAT\x78\x01\x01\x02\0\xfd\xff\0\0\0\x02\0\x01\x7e\x05\x0d\xd2\0\0\0\0IEND\xae\x42\x60\x82";
#[derive(Default)]
struct Fs {
    saved: RefCell<Vec<String>>,
    gone: RefCell<bool>,
}
impl ExecutableFs for Fs {
    fn fixed_disk(&self, r: &str) -> bool {
        r == "C:\\"
    }
    fn inspect(&self, p: &str) -> Result<FileKind, FsError> {
        match p {
            "C:\\" | "C:\\Apps" | "C:\\Img" => Ok(FileKind::Directory),
            "C:\\Apps\\Tool.exe" if !*self.gone.borrow() => Ok(FileKind::File),
            "C:\\Img\\i.png" => Ok(FileKind::File),
            _ => Err(FsError::Missing),
        }
    }
}
impl IconFs for Fs {
    fn read_icon(&self, _: &str) -> Result<Vec<u8>, String> {
        Ok(PNG.to_vec())
    }
    fn read_owned_icon(&self, _: &str) -> Result<Vec<u8>, String> {
        Ok(PNG.to_vec())
    }
    fn save_icon(&self, _: &[u8], e: &str) -> Result<String, String> {
        let n = format!("icon-{:x}.{e}", self.saved.borrow().len() + 1);
        self.saved.borrow_mut().push(n.clone());
        Ok(n)
    }
    fn delete_icon(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}
struct P(&'static str);
impl Picker for P {
    fn pick_executable(&self) -> Result<Option<String>, String> {
        Ok(Some(self.0.into()))
    }
}
impl IconPicker for P {
    fn pick_icon(&self) -> Result<Option<String>, String> {
        Ok(Some(self.0.into()))
    }
}

fn store() -> (std::path::PathBuf, Store) {
    let d = std::env::temp_dir().join(format!(
        "vpt-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    std::fs::create_dir_all(&d).unwrap();
    let p = d.join("config.json");
    std::fs::write(&p, r#"{"version":4,"localApps":[],"zzz":1}"#).unwrap();
    (p.clone(), Store::new(p))
}

#[test]
fn vp_token_is_single_use_and_rejects_keep_bytes() {
    let (path, store) = store();
    let fs = Fs::default();
    let now = Instant::now();
    let mut s = PendingSelections::default();
    let g = s.generation();
    let exe = s
        .pick_executable(&fs, &P("C:\\Apps\\Tool.exe"), g, now)
        .unwrap()
        .unwrap();
    assert_eq!(
        (exe.path.as_str(), exe.suggested_name.as_str()),
        ("C:\\Apps\\Tool.exe", "Tool")
    );
    let before = std::fs::read(&path).unwrap();
    for (token, name) in [
        ("C:\\Apps\\Tool.exe", "X"),
        ("", "X"),
        (exe.token.as_str(), "  "),
        (exe.token.as_str(), "a\u{0}"),
    ] {
        assert!(
            s.create(&store, &fs, token, name, None, now).is_err(),
            "{token:?} {name:?}"
        );
        assert_eq!(std::fs::read(&path).unwrap(), before);
    }
    assert!(
        s.create(&store, &fs, &exe.token, "Tool", Some("forged"), now)
            .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let saved = s
        .create(&store, &fs, &exe.token, "  My Tool ", None, now)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&saved).unwrap()["app"]["name"],
        "My Tool"
    );
    let after = std::fs::read(&path).unwrap();
    assert_eq!(
        s.create(&store, &fs, &exe.token, "Again", None, now),
        Err("nexo.local.refused".into())
    );
    assert_eq!(std::fs::read(&path).unwrap(), after);
    assert!(String::from_utf8(after).unwrap().contains("\"zzz\": 1"));
}

#[test]
fn vp_token_expires_and_cancel_beats_an_open_dialog() {
    let (path, store) = store();
    let fs = Fs::default();
    let now = Instant::now();
    let mut s = PendingSelections::default();
    let exe = s
        .pick_executable(&fs, &P("C:\\Apps\\Tool.exe"), s.generation(), now)
        .unwrap()
        .unwrap();
    let before = std::fs::read(&path).unwrap();
    assert!(
        s.create(
            &store,
            &fs,
            &exe.token,
            "T",
            None,
            now + Duration::from_secs(600)
        )
        .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let g = s.generation();
    s.cancel();
    assert_eq!(
        s.pick_executable(&fs, &P("C:\\Apps\\Tool.exe"), g, now)
            .map(|_| ()),
        Err("nexo.local.refused".into())
    );
    assert!(s.create(&store, &fs, &exe.token, "T", None, now).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn vp_icon_is_copied_only_on_create_and_exe_is_rechecked() {
    let (path, store) = store();
    let fs = Fs::default();
    let now = Instant::now();
    let mut s = PendingSelections::default();
    let g = s.generation();
    let exe = s
        .pick_executable(&fs, &P("C:\\Apps\\Tool.exe"), g, now)
        .unwrap()
        .unwrap();
    let icon = s
        .pick_icon(&fs, &P("C:\\Img\\i.png"), g, now)
        .unwrap()
        .unwrap();
    assert!(icon.preview.starts_with("data:image/png;base64,"));
    assert!(
        fs.saved.borrow().is_empty(),
        "picking must not copy the icon"
    );
    *fs.gone.borrow_mut() = true;
    let before = std::fs::read(&path).unwrap();
    assert_eq!(
        s.create(&store, &fs, &exe.token, "T", Some(&icon.token), now)
            .map(|_| ()),
        Err("nexo.local.missing".into())
    );
    assert!(fs.saved.borrow().is_empty());
    assert_eq!(std::fs::read(&path).unwrap(), before);
    *fs.gone.borrow_mut() = false;
    let saved = s
        .create(&store, &fs, &exe.token, "T", Some(&icon.token), now)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&saved).unwrap()["app"]["icon"],
        "icon-1.png"
    );
    assert_eq!(fs.saved.borrow().len(), 1);
}
