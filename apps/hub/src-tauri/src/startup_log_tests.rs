use super::{
    MAX_LOG_BYTES, append_file, exit_with_error, failure_text, format_line, handoff_notice, log_to,
    path_for, should_rotate,
};
use crate::i18n::Locale;
use std::{
    ffi::OsStr,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, UNIX_EPOCH},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nexo-startup-log-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&dir).unwrap();
        Self(dir)
    }
    fn path(&self) -> PathBuf {
        self.0.join("es.egdev.nexo/logs/startup.log")
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn path_follows_localappdata_or_fallback() {
    let fixture = Scratch::new();
    let fallback = fixture.0.join("fallback");
    let local = fixture.0.join("local");
    assert_eq!(
        path_for(Some(local.as_os_str()), &fallback),
        local.join("es.egdev.nexo/logs/startup.log")
    );
    assert_eq!(
        path_for(None, &fallback),
        fallback.join("es.egdev.nexo/logs/startup.log")
    );
    assert_eq!(
        path_for(Some(OsStr::new("")), &fallback),
        fallback.join("es.egdev.nexo/logs/startup.log")
    );
}

#[test]
fn lines_have_timestamps_and_append_to_file_and_stderr() {
    let fixture = Scratch::new();
    let path = fixture.path();
    let at = UNIX_EPOCH + Duration::from_millis(42_123);
    assert_eq!(
        format_line(at, "starting\nsecond\rline"),
        "[42.123 UTC] starting\\nsecond\\rline\n"
    );
    let mut stderr = Vec::new();
    log_to(&path, at, "first", &mut stderr).unwrap();
    log_to(&path, at + Duration::from_millis(2), "second", &mut stderr).unwrap();
    let expected = "[42.123 UTC] first\n[42.125 UTC] second\n";
    assert_eq!(fs::read_to_string(path).unwrap(), expected);
    assert_eq!(String::from_utf8(stderr).unwrap(), expected);
}

struct Broken;
impl Write for Broken {
    fn write(&mut self, _: &[u8]) -> io::Result<usize> {
        Err(io::ErrorKind::BrokenPipe.into())
    }
    fn flush(&mut self) -> io::Result<()> {
        Err(io::ErrorKind::BrokenPipe.into())
    }
}

#[test]
fn write_failures_do_not_panic_and_the_other_sink_is_still_attempted() {
    let fixture = Scratch::new();
    let blocker = fixture.0.join("not-a-directory");
    fs::write(&blocker, b"unchanged").unwrap();
    let mut stderr = Vec::new();
    assert!(
        log_to(
            &blocker.join("startup.log"),
            UNIX_EPOCH,
            "cannot write",
            &mut stderr,
        )
        .is_err()
    );
    assert_eq!(stderr, b"[0.000 UTC] cannot write\n");
    assert_eq!(fs::read(&blocker).unwrap(), b"unchanged");
    let path = fixture.path();
    log_to(&path, UNIX_EPOCH, "stderr failed", &mut Broken).unwrap();
    assert_eq!(
        fs::read_to_string(path).unwrap(),
        "[0.000 UTC] stderr failed\n"
    );
}

#[test]
fn append_file_reports_success_through_rotation() {
    let fixture = Scratch::new();
    let path = fixture.path();
    for index in 0..100 {
        let line = format_line(
            UNIX_EPOCH,
            &format!("entry-{index:03} {}", "x".repeat(4096)),
        );
        append_file(&path, &line).unwrap_or_else(|error| panic!("entry-{index:03}: {error:?}"));
    }
    let text = fs::read_to_string(path).unwrap();
    assert!(text.len() as u64 <= MAX_LOG_BYTES);
    assert!(!text.contains("entry-000"));
    assert!(text.contains("entry-099"));
}

#[cfg(windows)]
#[test]
fn windows_startup_lock_can_be_acquired() {
    let _guard = super::FILE_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    assert!(
        super::WindowsFileLock::acquire().is_some(),
        "failed to acquire the startup log process mutex"
    );
}

#[test]
fn rotation_keeps_recent_complete_lines_and_bounds_oversized_entries() {
    assert!(!should_rotate(MAX_LOG_BYTES - 1, 1));
    assert!(should_rotate(MAX_LOG_BYTES - 1, 2));
    assert!(should_rotate(u64::MAX, 1));
    let fixture = Scratch::new();
    let path = fixture.path();
    let mut stderr = Vec::new();
    for index in 0..100 {
        log_to(
            &path,
            UNIX_EPOCH,
            &format!("entry-{index:03} {}", "x".repeat(4096)),
            &mut stderr,
        )
        .unwrap_or_else(|error| panic!("entry-{index:03}: {error:?}"));
    }
    let text = fs::read_to_string(&path).unwrap();
    assert!(text.len() as u64 <= MAX_LOG_BYTES);
    assert!(!text.contains("entry-000"));
    assert!(text.contains("entry-099"));
    assert!(
        text.lines()
            .all(|line| line.starts_with("[0.000 UTC] entry-"))
    );
    log_to(
        &path,
        UNIX_EPOCH,
        &"🦀".repeat(MAX_LOG_BYTES as usize),
        &mut stderr,
    )
    .unwrap();
    let text = fs::read_to_string(path).unwrap();
    assert!(text.len() as u64 <= MAX_LOG_BYTES);
    assert!(text.ends_with('\n'));
}

#[test]
fn handoff_is_reported_only_for_an_existing_mutex_with_pid_when_known() {
    assert_eq!(handoff_notice(false, Some(42)), None);
    assert_eq!(
        handoff_notice(true, Some(42)).as_deref(),
        Some("handing off to the running instance (pid 42)")
    );
    assert_eq!(
        handoff_notice(true, None).as_deref(),
        Some("handing off to the running instance (pid unavailable)")
    );
}

#[cfg(windows)]
#[test]
fn windows_mutex_probe_opens_and_closes_only_the_supplied_name() {
    use super::mutex_exists;
    use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::CreateMutexW};
    let name: Vec<u16> = format!(
        "nexo-startup-log-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
    .encode_utf16()
    .chain(Some(0))
    .collect();
    assert!(!mutex_exists(&name));
    // SAFETY: the name is NUL-terminated and the returned handle is checked and closed.
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    assert!(!handle.is_null());
    assert!(mutex_exists(&name));
    // SAFETY: handle is valid and owned by this test.
    unsafe { CloseHandle(handle) };
    assert!(!mutex_exists(&name));
}

#[test]
fn failure_messages_are_localized_and_include_the_log_path() {
    let path = Path::new("test-path/startup.log");
    assert_eq!(
        failure_text(Locale::En, path),
        format!(
            "Nexo could not start. See the startup log:\n{}",
            path.display()
        )
    );
    assert_eq!(
        failure_text(Locale::Es, path),
        format!(
            "No se pudo iniciar Nexo. Consulta el registro de arranque:\n{}",
            path.display()
        )
    );
}

#[test]
fn failure_exits_nonzero_after_logging_and_notifying() {
    if let Some(path) = std::env::var_os("NEXO_TEST_FAILURE_CHILD") {
        let mut stderr = io::stderr();
        exit_with_error(
            Path::new(&path),
            UNIX_EPOCH + Duration::from_millis(42_123),
            "disk failed",
            Locale::En,
            &mut stderr,
            |message| {
                let _ = writeln!(io::stderr(), "DIALOG {message}");
            },
        );
    }
    let fixture = Scratch::new();
    let path = fixture.path();
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "startup_log::tests::failure_exits_nonzero_after_logging_and_notifying",
            "--nocapture",
        ])
        .env("NEXO_TEST_FAILURE_CHILD", &path)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let expected_line = "[42.123 UTC] startup failure: disk failed\n";
    assert_eq!(fs::read_to_string(&path).unwrap(), expected_line);
    assert_eq!(
        String::from_utf8(output.stderr).unwrap(),
        format!(
            "{expected_line}DIALOG Nexo could not start. See the startup log:\n{}\n",
            path.display()
        )
    );
}
