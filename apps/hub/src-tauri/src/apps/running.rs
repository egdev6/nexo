use crate::update_close::{ProbeError, ProcessProbe};
use std::{path::Path, time::Duration};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum RunningState {
    Connected,
    Running,
    NotRunning,
    Unknown,
}

pub(super) fn running_state(
    connected: bool,
    executable: Option<&Path>,
    probe: &impl ProcessProbe,
) -> RunningState {
    if connected {
        return RunningState::Connected;
    }
    match executable.map(|path| probe.confirmed_running(path)) {
        Some(Ok(true)) => RunningState::Running,
        Some(Ok(false)) => RunningState::NotRunning,
        Some(Err(_)) | None => RunningState::Unknown,
    }
}

pub(super) trait WindowCloser {
    fn request_close(&self, executable: &Path) -> Result<usize, ProbeError>;
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum CloseOutcome {
    Closed,
    StillRunning,
}

pub(super) async fn close_windows(
    executable: &Path,
    probe: &impl ProcessProbe,
    closer: &impl WindowCloser,
    wait: Duration,
) -> Result<CloseOutcome, ProbeError> {
    let start = tokio::time::Instant::now();
    if closer.request_close(executable)? == 0 {
        return Ok(CloseOutcome::StillRunning);
    }
    loop {
        if !wait.is_zero() && start.elapsed() > wait {
            return Ok(CloseOutcome::StillRunning);
        }
        if !probe.confirmed_running(executable)? {
            return Ok(if wait.is_zero() || start.elapsed() <= wait {
                CloseOutcome::Closed
            } else {
                CloseOutcome::StillRunning
            });
        }
        let remaining = wait.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            return Ok(CloseOutcome::StillRunning);
        }
        tokio::time::sleep(remaining.min(Duration::from_millis(100))).await;
        if start.elapsed() >= wait {
            return Ok(CloseOutcome::StillRunning);
        }
    }
}

#[cfg(test)]
#[path = "running_tests.rs"]
mod tests;
