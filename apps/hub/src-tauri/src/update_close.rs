use std::{path::Path, time::Duration};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProbeError {
    Unsupported,
    Failed,
}

pub trait ProcessProbe {
    fn is_running(&self, exe: &Path) -> Result<bool, ProbeError>;

    /// Unlike the update safety check, unknown candidates are not proof of running.
    fn confirmed_running(&self, exe: &Path) -> Result<bool, ProbeError> {
        self.is_running(exe)
    }
}

#[cfg(any(windows, test))]
struct ProcessEntry {
    id: u32,
    name: Vec<u16>,
}

#[cfg(any(windows, test))]
trait ProcessSnapshot {
    fn next(&mut self) -> Result<Option<ProcessEntry>, ProbeError>;
    fn image_path(&self, id: u32) -> Result<Vec<u16>, ProbeError>;
}

// #6 resolves installed paths with canonicalize, which yields verbatim paths.
// QueryFullProcessImageNameW normally returns the equivalent non-verbatim form.
#[cfg(any(windows, test))]
fn comparable_path(path: &[u16]) -> Vec<u16> {
    const VERBATIM: [u16; 4] = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    const UNC: [u16; 4] = [b'U' as u16, b'N' as u16, b'C' as u16, b'\\' as u16];
    if let Some(rest) = path.strip_prefix(&VERBATIM) {
        if rest.len() >= UNC.len()
            && rest[..UNC.len()]
                .iter()
                .zip(UNC)
                .all(|(&actual, expected)| {
                    actual == expected
                        || ((b'A' as u16..=b'Z' as u16).contains(&expected)
                            && actual == expected + 32)
                })
        {
            let mut result = vec![b'\\' as u16, b'\\' as u16];
            result.extend_from_slice(&rest[UNC.len()..]);
            result
        } else {
            rest.to_vec()
        }
    } else {
        path.to_vec()
    }
}

#[cfg(any(windows, test))]
fn scan_processes(
    snapshot: &mut impl ProcessSnapshot,
    name: &[u16],
    exe: &[u16],
    equal: impl Fn(&[u16], &[u16]) -> Result<bool, ProbeError>,
) -> Result<bool, ProbeError> {
    Ok(!scan_process_ids(snapshot, name, exe, equal, true, true)?.is_empty())
}

#[cfg(any(windows, test))]
fn scan_process_ids(
    snapshot: &mut impl ProcessSnapshot,
    name: &[u16],
    exe: &[u16],
    equal: impl Fn(&[u16], &[u16]) -> Result<bool, ProbeError>,
    conservative: bool,
    stop_after_first: bool,
) -> Result<Vec<u32>, ProbeError> {
    let exe = comparable_path(exe);
    let mut ids = Vec::new();
    while let Some(entry) = snapshot.next()? {
        if equal(&entry.name, name)? {
            let image = match snapshot.image_path(entry.id) {
                Ok(image) => image,
                // Updating must fail closed; UI and close targeting require proof.
                Err(_) if conservative => return Ok(vec![entry.id]),
                Err(error) => return Err(error),
            };
            if equal(&comparable_path(&image), &exe)? {
                ids.push(entry.id);
                if stop_after_first {
                    break;
                }
            }
        }
    }
    Ok(ids)
}

pub struct SystemProcessProbe;

#[cfg(windows)]
impl SystemProcessProbe {
    pub(crate) fn matching_ids(&self, exe: &Path) -> Result<Vec<u32>, ProbeError> {
        windows::matching_ids(exe)
    }
}

#[cfg(not(windows))]
impl ProcessProbe for SystemProcessProbe {
    fn is_running(&self, _: &Path) -> Result<bool, ProbeError> {
        Err(ProbeError::Unsupported)
    }
}

#[cfg(windows)]
impl ProcessProbe for SystemProcessProbe {
    fn is_running(&self, exe: &Path) -> Result<bool, ProbeError> {
        windows::is_running(exe)
    }

    fn confirmed_running(&self, exe: &Path) -> Result<bool, ProbeError> {
        Ok(!self.matching_ids(exe)?.is_empty())
    }
}

#[cfg(windows)]
mod windows {
    use super::{ProbeError, ProcessEntry, ProcessSnapshot, scan_process_ids, scan_processes};
    use std::{
        mem::size_of,
        os::windows::ffi::{OsStrExt, OsStringExt},
        path::Path,
    };
    use windows_sys::Win32::{
        Foundation::{
            CloseHandle, ERROR_NO_MORE_FILES, GetLastError, HANDLE, INVALID_HANDLE_VALUE,
        },
        Globalization::{CSTR_EQUAL, CompareStringOrdinal},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
                TH32CS_SNAPPROCESS,
            },
            Threading::{
                OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
            },
        },
    };

    struct OwnedHandle(HANDLE);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            // SAFETY: each instance owns a valid, successfully opened handle.
            unsafe { CloseHandle(self.0) };
        }
    }

    struct ToolhelpSnapshot {
        handle: OwnedHandle,
        first: bool,
        entry: PROCESSENTRY32W,
    }
    impl ToolhelpSnapshot {
        fn new() -> Result<Self, ProbeError> {
            // SAFETY: TH32CS_SNAPPROCESS ignores the process ID argument.
            let raw = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
            if raw == INVALID_HANDLE_VALUE {
                return Err(ProbeError::Failed);
            }
            let entry = PROCESSENTRY32W {
                dwSize: size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            Ok(Self {
                handle: OwnedHandle(raw),
                first: true,
                entry,
            })
        }
    }
    impl ProcessSnapshot for ToolhelpSnapshot {
        fn next(&mut self) -> Result<Option<ProcessEntry>, ProbeError> {
            // SAFETY: the owned snapshot is valid and entry has the required dwSize.
            let result = unsafe {
                if self.first {
                    self.first = false;
                    Process32FirstW(self.handle.0, &mut self.entry)
                } else {
                    Process32NextW(self.handle.0, &mut self.entry)
                }
            };
            if result == 0 {
                // SAFETY: GetLastError reads the current thread's immediately preceding error.
                return if unsafe { GetLastError() } == ERROR_NO_MORE_FILES {
                    Ok(None)
                } else {
                    Err(ProbeError::Failed)
                };
            }
            let end = self
                .entry
                .szExeFile
                .iter()
                .position(|&unit| unit == 0)
                .filter(|&end| end > 0)
                .ok_or(ProbeError::Failed)?;
            Ok(Some(ProcessEntry {
                id: self.entry.th32ProcessID,
                name: self.entry.szExeFile[..end].to_vec(),
            }))
        }

        fn image_path(&self, id: u32) -> Result<Vec<u16>, ProbeError> {
            // SAFETY: only query access is requested; the returned handle is owned below.
            let raw = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id) };
            if raw.is_null() {
                return Err(ProbeError::Failed);
            }
            let process = OwnedHandle(raw);
            let mut path = vec![0_u16; 32768];
            let mut length = path.len() as u32;
            // SAFETY: process is a valid owned handle, and path and length are writable.
            if unsafe { QueryFullProcessImageNameW(process.0, 0, path.as_mut_ptr(), &mut length) }
                == 0
                || length == 0
                || length as usize > path.len()
            {
                return Err(ProbeError::Failed);
            }
            path.truncate(length as usize);
            if path.contains(&0) {
                return Err(ProbeError::Failed);
            }
            // Resolve aliases in the image path before comparing it to #6's canonical path.
            // If the image can no longer be resolved, it may still be the installed app.
            let image = std::ffi::OsString::from_wide(&path);
            let resolved = std::fs::canonicalize(image).map_err(|_| ProbeError::Failed)?;
            Ok(resolved.as_os_str().encode_wide().collect())
        }
    }

    fn equal(left: &[u16], right: &[u16]) -> Result<bool, ProbeError> {
        let left_len = i32::try_from(left.len()).map_err(|_| ProbeError::Failed)?;
        let right_len = i32::try_from(right.len()).map_err(|_| ProbeError::Failed)?;
        // SAFETY: both pointers refer to valid UTF-16 slices of the given lengths.
        let result =
            unsafe { CompareStringOrdinal(left.as_ptr(), left_len, right.as_ptr(), right_len, 1) };
        if result == 0 {
            Err(ProbeError::Failed)
        } else {
            Ok(result == CSTR_EQUAL)
        }
    }

    fn target(exe: &Path) -> Result<(Vec<u16>, Vec<u16>), ProbeError> {
        if !exe.is_absolute()
            || exe
                .components()
                .any(|part| matches!(part, std::path::Component::ParentDir))
        {
            return Err(ProbeError::Failed);
        }
        let resolved = match std::fs::canonicalize(exe) {
            Ok(path) => path,
            // A nonexistent path can still be compared to a candidate's image path.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => exe.to_owned(),
            Err(_) => return Err(ProbeError::Failed),
        };
        let name: Vec<u16> = resolved
            .file_name()
            .ok_or(ProbeError::Failed)?
            .encode_wide()
            .collect();
        let path: Vec<u16> = resolved.as_os_str().encode_wide().collect();
        if name.is_empty() || path.contains(&0) {
            return Err(ProbeError::Failed);
        }
        Ok((name, path))
    }

    pub(super) fn is_running(exe: &Path) -> Result<bool, ProbeError> {
        let (name, path) = target(exe)?;
        scan_processes(&mut ToolhelpSnapshot::new()?, &name, &path, equal)
    }

    pub(super) fn matching_ids(exe: &Path) -> Result<Vec<u32>, ProbeError> {
        let (name, path) = target(exe)?;
        scan_process_ids(
            &mut ToolhelpSnapshot::new()?,
            &name,
            &path,
            equal,
            false,
            false,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuitAnswer {
    Accepted,
    Refused,
    /// The app was not connected when the attempt started. A disconnect during a
    /// quit, a missing capability, or an unresponsive plugin must not use this variant.
    NotConnected,
    Timeout,
}

/// Implementations must use the current generation-fenced, correlated quit request
/// and return `Timeout` for an unresponsive app within the IPC request's own deadline.
/// Do not cancel that request early: it owns pending-request and queued-message cleanup.
#[allow(async_fn_in_trait)]
pub trait PluginQuit {
    async fn quit(&self, id: &str) -> QuitAnswer;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloseOutcome {
    Closed,
    StillRunning,
}

/// Ask once, then confirm OS exit. This does not lock out a later independent launch.
pub async fn close_for_update(
    id: &str,
    exe: &Path,
    quit: &impl PluginQuit,
    probe: &impl ProcessProbe,
    wait: Duration,
) -> CloseOutcome {
    match quit.quit(id).await {
        QuitAnswer::Accepted => {}
        QuitAnswer::NotConnected => {
            return if probe.is_running(exe) == Ok(false) {
                CloseOutcome::Closed
            } else {
                CloseOutcome::StillRunning
            };
        }
        QuitAnswer::Refused | QuitAnswer::Timeout => {
            return CloseOutcome::StillRunning;
        }
    }

    let start = tokio::time::Instant::now();
    loop {
        match probe.is_running(exe) {
            Ok(false) if wait.is_zero() || start.elapsed() <= wait => return CloseOutcome::Closed,
            Ok(true) => {}
            Ok(false) | Err(_) => return CloseOutcome::StillRunning,
        }
        let remaining = wait.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            return CloseOutcome::StillRunning;
        }
        tokio::time::sleep(remaining.min(Duration::from_millis(100))).await;
        if start.elapsed() >= wait {
            return CloseOutcome::StillRunning;
        }
    }
}

#[cfg(test)]
#[path = "update_close_tests.rs"]
mod tests;
