//! Best-effort diagnostics available before Tauri has built an app handle.
use std::{
    ffi::OsStr,
    fs::{self, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::i18n::{self, Locale};

const APP_ID: &str = "es.egdev.nexo";
const MAX_LOG_BYTES: u64 = 256 * 1024;
const MAX_MESSAGE_BYTES: usize = 16 * 1024;
static FILE_LOCK: Mutex<()> = Mutex::new(());

fn path_for(local: Option<&OsStr>, fallback: &Path) -> PathBuf {
    local
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| fallback.to_path_buf())
        .join(APP_ID)
        .join("logs")
        .join("startup.log")
}

fn path() -> PathBuf {
    path_for(
        std::env::var_os("LOCALAPPDATA").as_deref(),
        &std::env::temp_dir(),
    )
}

fn format_line(time: SystemTime, message: &str) -> String {
    let elapsed = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let mut body = String::new();
    for character in message.chars() {
        let mut encoded = [0; 4];
        let part = match character {
            '\n' => "\\n",
            '\r' => "\\r",
            _ => character.encode_utf8(&mut encoded),
        };
        if body.len() + part.len() > MAX_MESSAGE_BYTES {
            body.push_str("... [truncated]");
            break;
        }
        body.push_str(part);
    }
    format!(
        "[{}.{:03} UTC] {body}\n",
        elapsed.as_secs(),
        elapsed.subsec_millis()
    )
}

fn should_rotate(current: u64, incoming: u64) -> bool {
    current.saturating_add(incoming) > MAX_LOG_BYTES
}

fn append_file(path: &Path, line: &str) -> io::Result<()> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    fs::create_dir_all(parent)?;
    let mut options = OpenOptions::new();
    options.create(true).read(true);
    // Windows needs write access, not append-only access, to truncate the file.
    #[cfg(windows)]
    options.write(true).truncate(false);
    #[cfg(not(windows))]
    options.append(true);
    let mut file = options.open(path)?;
    let current = file.metadata()?.len();
    if should_rotate(current, line.len() as u64) {
        // Read only the newest half and discard any incomplete first line.
        let offset = current.saturating_sub(MAX_LOG_BYTES / 2);
        file.seek(SeekFrom::Start(offset))?;
        let mut tail = Vec::new();
        (&mut file).take(MAX_LOG_BYTES / 2).read_to_end(&mut tail)?;
        let start = if offset == 0 {
            0
        } else {
            tail.iter()
                .position(|byte| *byte == b'\n')
                .map_or(tail.len(), |i| i + 1)
        };
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        file.write_all(&tail[start..])?;
    }
    file.seek(SeekFrom::End(0))?;
    file.write_all(line.as_bytes())
}

fn log_to(path: &Path, time: SystemTime, message: &str, stderr: &mut dyn Write) -> io::Result<()> {
    let line = format_line(time, message);
    let _ = stderr.write_all(line.as_bytes());
    let _guard = FILE_LOCK.lock().unwrap_or_else(|error| error.into_inner());
    #[cfg(windows)]
    let _process_guard = WindowsFileLock::acquire()
        .ok_or_else(|| io::Error::other("failed to acquire startup log process mutex"))?;
    append_file(path, &line)
}

pub(crate) fn log(message: &str) {
    let _ = log_to(&path(), SystemTime::now(), message, &mut io::stderr());
}

#[cfg(windows)]
struct WindowsFileLock(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
impl WindowsFileLock {
    fn acquire() -> Option<Self> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, WAIT_ABANDONED, WAIT_OBJECT_0},
            System::Threading::{CreateMutexW, WaitForSingleObject},
        };
        let name: Vec<u16> = "es.egdev.nexo-startup-log"
            .encode_utf16()
            .chain(Some(0))
            .collect();
        // SAFETY: the name is NUL-terminated; a successful handle is closed below or by Drop.
        let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
        if handle.is_null() {
            return None;
        }
        // SAFETY: handle is a valid mutex handle; the bounded wait avoids hanging startup.
        let result = unsafe { WaitForSingleObject(handle, 1000) };
        if result == WAIT_OBJECT_0 || result == WAIT_ABANDONED {
            Some(Self(handle))
        } else {
            // SAFETY: ownership was not acquired and the handle is no longer used.
            unsafe { CloseHandle(handle) };
            None
        }
    }
}

#[cfg(windows)]
impl Drop for WindowsFileLock {
    fn drop(&mut self) {
        use windows_sys::Win32::{Foundation::CloseHandle, System::Threading::ReleaseMutex};
        // SAFETY: this guard owns the mutex and its handle until drop.
        unsafe {
            ReleaseMutex(self.0);
            CloseHandle(self.0);
        }
    }
}

#[cfg(any(windows, test))]
fn handoff_notice(exists: bool, pid: Option<u32>) -> Option<String> {
    exists.then(|| match pid {
        Some(pid) => format!("handing off to the running instance (pid {pid})"),
        None => "handing off to the running instance (pid unavailable)".to_owned(),
    })
}

#[cfg(windows)]
fn mutex_exists(name: &[u16]) -> bool {
    use windows_sys::Win32::{
        Foundation::CloseHandle,
        System::Threading::{OpenMutexW, SYNCHRONIZATION_SYNCHRONIZE},
    };
    // SAFETY: callers provide a NUL-terminated name; successful handles are closed.
    let handle = unsafe { OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, 0, name.as_ptr()) };
    if handle.is_null() {
        return false;
    }
    // SAFETY: handle is valid and no longer used after closing it.
    unsafe { CloseHandle(handle) };
    true
}

#[cfg(windows)]
pub(crate) fn log_handoff() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowThreadProcessId};
    // Names match tauri-plugin-single-instance 2.5.5 and the configured identifier.
    let mutex: Vec<u16> = "es.egdev.nexo-sim".encode_utf16().chain(Some(0)).collect();
    if !mutex_exists(&mutex) {
        return;
    }
    let class: Vec<u16> = "es.egdev.nexo-sic".encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "es.egdev.nexo-siw".encode_utf16().chain(Some(0)).collect();
    // SAFETY: both names are NUL-terminated and remain valid during the call.
    let window = unsafe { FindWindowW(class.as_ptr(), title.as_ptr()) };
    let mut pid = 0;
    if !window.is_null() {
        // SAFETY: the HWND came from FindWindowW and pid points to writable storage.
        unsafe { GetWindowThreadProcessId(window, &mut pid) };
    }
    if let Some(notice) = handoff_notice(true, (pid != 0).then_some(pid)) {
        log(&notice);
    }
}

fn failure_text(locale: Locale, path: &Path) -> String {
    i18n::text(locale, "startupLogError").replace("{path}", &path.display().to_string())
}

fn exit_with_error(
    path: &Path,
    time: SystemTime,
    error: &str,
    locale: Locale,
    stderr: &mut dyn Write,
    dialog: impl FnOnce(&str),
) -> ! {
    let _ = log_to(path, time, &format!("startup failure: {error}"), stderr);
    dialog(&failure_text(locale, path));
    std::process::exit(1)
}

#[cfg(windows)]
fn saved_locale() -> Locale {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::{
        Foundation::MAX_PATH,
        UI::Shell::{CSIDL_APPDATA, SHGFP_TYPE_CURRENT, SHGetFolderPathW},
    };
    let mut path = [0u16; MAX_PATH as usize];
    // SAFETY: path has MAX_PATH writable UTF-16 elements as required by the API.
    let result = unsafe {
        SHGetFolderPathW(
            std::ptr::null_mut(),
            CSIDL_APPDATA as i32,
            std::ptr::null_mut(),
            SHGFP_TYPE_CURRENT as u32,
            path.as_mut_ptr(),
        )
    };
    if result < 0 {
        return Locale::Es;
    }
    let Some(end) = path.iter().position(|unit| *unit == 0) else {
        return Locale::Es;
    };
    let directory = PathBuf::from(std::ffi::OsString::from_wide(&path[..end])).join(APP_ID);
    crate::config::store_locale(&crate::config::Store::new(directory.join("config.json")))
}

#[cfg(not(windows))]
fn saved_locale() -> Locale {
    Locale::Es
}

#[cfg(windows)]
fn show_error(message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
    let body: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "Nexo".encode_utf16().chain(Some(0)).collect();
    // SAFETY: both UTF-16 buffers are NUL-terminated and live until the dialog returns.
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            body.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

#[cfg(not(windows))]
fn show_error(_message: &str) {}

pub(crate) fn fail(error: &str) -> ! {
    exit_with_error(
        &path(),
        SystemTime::now(),
        error,
        saved_locale(),
        &mut io::stderr(),
        show_error,
    )
}

#[cfg(test)]
#[path = "startup_log_tests.rs"]
mod tests;
