//! Direct, unelevated process launching for an already-verified installer.
//!
//! This is not an authorization boundary: a caller must first obtain native approval and
//! revalidate the catalog selection and installation state. A monitor owns a second reference
//! to the verified handle until the process actually exits, including after a timeout or a
//! dropped async waiter. The caller must retain its per-app claim until `wait_until_exit`.
use crate::install_workspace::VerifiedInstaller;
use std::{mem::ManuallyDrop, time::Duration};
use tokio::sync::oneshot;

pub(crate) const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LaunchError {
    Elevated,
    ElevationCheck,
    Spawn,
    Monitor,
    Wait,
    Timeout,
    Exit(i32),
    NoExitCode,
}

pub(crate) trait Process: Send + 'static {
    fn wait(&mut self) -> Result<Option<i32>, ()>;
}
pub(crate) trait ProcessLauncher: Send + 'static {
    type Child: Process;
    fn elevated(&self) -> Result<bool, ()>;
    fn spawn(&self, installer: &VerifiedInstaller) -> Result<Self::Child, ()>;
}

pub(crate) struct RunningInstaller {
    first: oneshot::Receiver<Result<(), LaunchError>>,
    exited: oneshot::Receiver<Result<(), LaunchError>>,
    deadline: tokio::time::Instant,
}

pub(crate) fn installer_command(installer: &VerifiedInstaller) -> std::process::Command {
    let mut command = std::process::Command::new(installer.executable_path());
    command
        .arg("/S")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    command
}

/// Create the monitor before spawning so monitor creation failure cannot orphan a process.
/// Spawn is synchronous; an async command should call this on a blocking thread.
pub(crate) fn start<L: ProcessLauncher>(
    installer: &VerifiedInstaller,
    launcher: L,
) -> Result<RunningInstaller, LaunchError> {
    let installer = installer.retain_for_process();
    let deadline = tokio::time::Instant::now() + INSTALL_TIMEOUT;
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel(1);
    let (first_tx, first) = oneshot::channel();
    let (exited_tx, exited) = oneshot::channel();
    std::thread::Builder::new()
        .name("nexo-installer-monitor".into())
        .spawn(move || {
            match launcher.elevated() {
                Ok(false) => {}
                Ok(true) => {
                    drop(installer);
                    let _ = started_tx.send(Err(LaunchError::Elevated));
                    return;
                }
                Err(()) => {
                    drop(installer);
                    let _ = started_tx.send(Err(LaunchError::ElevationCheck));
                    return;
                }
            }
            // If a backend or wait panics after process creation, leak the verified guard
            // rather than releasing protection while an untracked process could still run.
            let mut installer = ManuallyDrop::new(installer);
            let mut child = match launcher.spawn(&installer) {
                Ok(child) => child,
                Err(()) => {
                    // SAFETY: spawn failed and no process can use this retained guard.
                    unsafe { ManuallyDrop::drop(&mut installer) };
                    let _ = started_tx.send(Err(LaunchError::Spawn));
                    return;
                }
            };
            let _ = started_tx.send(Ok(()));
            let mut first_tx = Some(first_tx);
            loop {
                match child.wait() {
                    Ok(code) => {
                        let outcome = match code {
                            Some(0) => Ok(()),
                            Some(code) => Err(LaunchError::Exit(code)),
                            None => Err(LaunchError::NoExitCode),
                        };
                        // SAFETY: wait confirmed that the child exited; drop once here.
                        unsafe { ManuallyDrop::drop(&mut installer) };
                        if let Some(sender) = first_tx.take() {
                            let _ = sender.send(outcome);
                        }
                        let _ = exited_tx.send(outcome);
                        return;
                    }
                    Err(()) => {
                        if let Some(sender) = first_tx.take() {
                            let _ = sender.send(Err(LaunchError::Wait));
                        }
                        // Wait errors do not prove exit. Retain protection and retry without
                        // busy-spinning; never kill or release the still-unknown child.
                        std::thread::sleep(Duration::from_secs(1));
                    }
                }
            }
        })
        .map_err(|_| LaunchError::Monitor)?;
    started_rx.recv().map_err(|_| LaunchError::Monitor)??;
    Ok(RunningInstaller {
        first,
        exited,
        deadline,
    })
}

impl RunningInstaller {
    pub(crate) async fn wait(&mut self) -> Result<(), LaunchError> {
        match tokio::time::timeout_at(self.deadline, &mut self.first).await {
            Err(_) => Err(LaunchError::Timeout),
            Ok(Err(_)) => Err(LaunchError::Monitor),
            Ok(Ok(outcome)) => outcome,
        }
    }

    /// Continue tracking after a timeout or wait error, without another deadline or a kill.
    pub(crate) async fn wait_until_exit(self) -> Result<(), LaunchError> {
        self.exited.await.unwrap_or(Err(LaunchError::Monitor))
    }
}

#[cfg(windows)]
pub(crate) struct SystemLauncher;

#[cfg(windows)]
impl ProcessLauncher for SystemLauncher {
    type Child = std::process::Child;

    fn elevated(&self) -> Result<bool, ()> {
        use std::{mem::size_of, ptr};
        use windows_sys::Win32::{
            Foundation::{CloseHandle, HANDLE},
            Security::{GetTokenInformation, TOKEN_ELEVATION, TOKEN_QUERY, TokenElevation},
            System::Threading::{GetCurrentProcess, OpenProcessToken},
        };
        struct Token(HANDLE);
        impl Drop for Token {
            fn drop(&mut self) {
                // SAFETY: the token is an owned handle returned by OpenProcessToken.
                unsafe { CloseHandle(self.0) };
            }
        }
        let mut raw: HANDLE = ptr::null_mut();
        // SAFETY: the current pseudo-handle is valid and raw is a writable output handle.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 {
            return Err(());
        }
        let token = Token(raw);
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned = 0;
        // SAFETY: the output points to an appropriately sized TOKEN_ELEVATION and length.
        if unsafe {
            GetTokenInformation(
                token.0,
                TokenElevation,
                (&mut elevation as *mut TOKEN_ELEVATION).cast(),
                size_of::<TOKEN_ELEVATION>() as u32,
                &mut returned,
            )
        } == 0
            || returned != size_of::<TOKEN_ELEVATION>() as u32
        {
            return Err(());
        }
        Ok(elevation.TokenIsElevated != 0)
    }

    fn spawn(&self, installer: &VerifiedInstaller) -> Result<Self::Child, ()> {
        // Command uses CreateProcess directly, not a shell or runas; elevation-required
        // executables fail instead of prompting or retrying with elevated rights.
        installer_command(installer).spawn().map_err(|_| ())
    }
}

#[cfg(windows)]
impl Process for std::process::Child {
    fn wait(&mut self) -> Result<Option<i32>, ()> {
        std::process::Child::wait(self)
            .map(|status| status.code())
            .map_err(|_| ())
    }
}
