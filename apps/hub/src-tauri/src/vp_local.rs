use super::{ExecutableFs, FileKind, FsError, Launcher, open, validate_executable};
use crate::config::Store;
use std::{cell::RefCell, collections::HashMap};
#[derive(Default)]
struct Fs {
    kinds: RefCell<HashMap<String, FileKind>>,
    remote: bool,
}
impl ExecutableFs for Fs {
    fn fixed_disk(&self, _: &str) -> bool {
        !self.remote
    }
    fn inspect(&self, p: &str) -> Result<FileKind, FsError> {
        self.kinds.borrow().get(p).copied().ok_or(FsError::Missing)
    }
}
#[derive(Default)]
struct Spy(RefCell<Vec<String>>);
impl Launcher for Spy {
    fn spawn(&self, e: &str) -> Result<(), String> {
        self.0.borrow_mut().push(e.into());
        Ok(())
    }
}
fn tree() -> Fs {
    use FileKind::*;
    let fs = Fs::default();
    for (p, k) in [
        ("C:\\", Directory),
        ("C:\\Apps", Directory),
        ("C:\\Apps\\App.EXE", File),
        ("C:\\Apps\\tool.com", File),
        ("C:\\Link", Reparse),
        ("C:\\Link\\App.exe", File),
        ("C:\\Apps\\Dir.exe", Directory),
    ] {
        fs.kinds.borrow_mut().insert(p.into(), k);
    }
    fs
}
#[test]
fn vp_validation_rejects_unsafe_shapes() {
    let fs = tree();
    assert_eq!(
        validate_executable(&fs, "C:/Apps/App.EXE"),
        Ok("C:\\Apps\\App.EXE".into())
    );
    for bad in [
        "\\\\server\\share\\App.exe",
        "\\\\?\\C:\\Apps\\App.EXE",
        "\\\\.\\C:\\Apps\\App.EXE",
        "C:Apps\\App.exe",
        "App.exe",
        "C:\\Apps\\..\\Apps\\App.EXE",
        "C:\\Apps\\App.EXE:stream",
        "C:\\Apps\\App.EXE.",
        "C:\\Apps\\App.EXE ",
        "C:\\Apps\\\\App.EXE",
        "",
    ] {
        assert!(validate_executable(&fs, bad).is_err(), "accepted {bad:?}");
    }
    assert_eq!(
        validate_executable(&fs, "C:\\Link\\App.exe"),
        Err("nexo.local.refused".into())
    );
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\tool.com"),
        Err("nexo.local.notExecutable".into())
    );
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\Dir.exe"),
        Err("nexo.local.notExecutable".into())
    );
    assert_eq!(
        validate_executable(&fs, "C:\\Apps\\Gone.exe"),
        Err("nexo.local.missing".into())
    );
    assert_eq!(
        validate_executable(
            &Fs {
                remote: true,
                ..tree()
            },
            "C:\\Apps\\App.EXE"
        ),
        Err("nexo.local.refused".into())
    );
}
#[test]
fn vp_open_revalidates_stored_path_and_never_spawns_on_failure() {
    let dir = std::env::temp_dir().join(format!("vp-local-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("config.json");
    std::fs::write(&path, r#"{"version":3,"localApps":[{"id":"m1","name":"A","executable":"C:\\Apps\\App.EXE"},{"id":"m2","name":"B","executable":"\\\\srv\\s\\B.exe"}]}"#).unwrap();
    let (store, before, fs, spy) = (
        Store::new(path.clone()),
        std::fs::read(&path).unwrap(),
        tree(),
        Spy::default(),
    );
    assert_eq!(
        open(&store, &fs, &spy, "m2"),
        Err("nexo.local.refused".into())
    );
    assert_eq!(
        open(&store, &fs, &spy, "C:\\Apps\\App.EXE"),
        Err("nexo.local.notFound".into())
    );
    fs.kinds
        .borrow_mut()
        .insert("C:\\Apps".into(), FileKind::Reparse);
    assert_eq!(
        open(&store, &fs, &spy, "m1"),
        Err("nexo.local.refused".into())
    );
    assert!(spy.0.borrow().is_empty());
    fs.kinds
        .borrow_mut()
        .insert("C:\\Apps".into(), FileKind::Directory);
    assert_eq!(open(&store, &fs, &spy, "m1"), Ok(()));
    assert_eq!(*spy.0.borrow(), vec!["C:\\Apps\\App.EXE".to_string()]);
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let _ = std::fs::remove_dir_all(&dir);
}
