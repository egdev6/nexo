use super::{CloseOutcome, RunningState, WindowCloser, close_windows, running_state};
use crate::update_close::{ProbeError, ProcessProbe};
use std::{
    cell::RefCell,
    collections::VecDeque,
    path::{Path, PathBuf},
    time::Duration,
};

const EXE: &str = "/installed/Example.exe";
const WAIT: Duration = Duration::from_millis(250);

struct FakeProbe {
    answers: RefCell<VecDeque<Result<bool, ProbeError>>>,
    fallback: Result<bool, ProbeError>,
    calls: RefCell<Vec<PathBuf>>,
}
impl FakeProbe {
    fn new(answers: impl IntoIterator<Item = Result<bool, ProbeError>>) -> Self {
        Self {
            answers: RefCell::new(answers.into_iter().collect()),
            fallback: Ok(true),
            calls: RefCell::new(Vec::new()),
        }
    }
}
impl ProcessProbe for FakeProbe {
    fn is_running(&self, executable: &Path) -> Result<bool, ProbeError> {
        self.calls.borrow_mut().push(executable.to_path_buf());
        self.answers
            .borrow_mut()
            .pop_front()
            .unwrap_or(self.fallback)
    }
}
struct FakeCloser {
    result: Result<usize, ProbeError>,
    calls: RefCell<Vec<PathBuf>>,
}
impl FakeCloser {
    fn new(result: Result<usize, ProbeError>) -> Self {
        Self {
            result,
            calls: RefCell::new(Vec::new()),
        }
    }
}
impl WindowCloser for FakeCloser {
    fn request_close(&self, executable: &Path) -> Result<usize, ProbeError> {
        self.calls.borrow_mut().push(executable.to_path_buf());
        self.result
    }
}

#[test]
fn process_evidence_maps_to_running_and_not_running() {
    for (answer, expected) in [
        (true, RunningState::Running),
        (false, RunningState::NotRunning),
    ] {
        let probe = FakeProbe::new([Ok(answer)]);
        assert_eq!(running_state(false, Some(Path::new(EXE)), &probe), expected);
        assert_eq!(*probe.calls.borrow(), [PathBuf::from(EXE)]);
    }
}

#[test]
fn missing_executable_or_probe_error_is_unknown() {
    let probe = FakeProbe::new([Err(ProbeError::Failed)]);
    assert_eq!(running_state(false, None, &probe), RunningState::Unknown);
    assert!(probe.calls.borrow().is_empty());
    assert_eq!(
        running_state(false, Some(Path::new(EXE)), &probe),
        RunningState::Unknown
    );
}

#[test]
fn connected_takes_priority_without_probing() {
    let probe = FakeProbe::new([Ok(false)]);
    assert_eq!(
        running_state(true, Some(Path::new(EXE)), &probe),
        RunningState::Connected
    );
    assert_eq!(running_state(true, None, &probe), RunningState::Connected);
    assert!(probe.calls.borrow().is_empty());
}

#[tokio::test(start_paused = true)]
async fn window_close_is_successful_only_after_the_process_exits() {
    let probe = FakeProbe::new([Ok(true), Ok(true), Ok(false)]);
    let closer = FakeCloser::new(Ok(2));
    let start = tokio::time::Instant::now();
    assert_eq!(
        close_windows(Path::new(EXE), &probe, &closer, WAIT).await,
        Ok(CloseOutcome::Closed)
    );
    assert_eq!(start.elapsed(), Duration::from_millis(200));
    assert_eq!(*closer.calls.borrow(), [PathBuf::from(EXE)]);
    assert_eq!(*probe.calls.borrow(), vec![PathBuf::from(EXE); 3]);
}

#[tokio::test(start_paused = true)]
async fn still_running_at_the_deadline_is_not_reported_closed() {
    let probe = FakeProbe::new([]);
    let closer = FakeCloser::new(Ok(1));
    let start = tokio::time::Instant::now();
    assert_eq!(
        close_windows(Path::new(EXE), &probe, &closer, WAIT).await,
        Ok(CloseOutcome::StillRunning)
    );
    assert_eq!(start.elapsed(), WAIT);
    assert_eq!(*closer.calls.borrow(), [PathBuf::from(EXE)]);
    assert_eq!(probe.calls.borrow().len(), 3);
}

#[tokio::test(start_paused = true)]
async fn no_visible_window_returns_the_same_still_running_notice_without_waiting() {
    let probe = FakeProbe::new([]);
    let closer = FakeCloser::new(Ok(0));
    let start = tokio::time::Instant::now();
    assert_eq!(
        close_windows(Path::new(EXE), &probe, &closer, WAIT).await,
        Ok(CloseOutcome::StillRunning)
    );
    assert_eq!(start.elapsed(), Duration::ZERO);
    assert!(probe.calls.borrow().is_empty());
    assert_eq!(*closer.calls.borrow(), [PathBuf::from(EXE)]);
}

#[tokio::test(start_paused = true)]
async fn zero_wait_does_not_claim_a_running_process_is_closed() {
    let probe = FakeProbe::new([Ok(true)]);
    let closer = FakeCloser::new(Ok(1));
    assert_eq!(
        close_windows(Path::new(EXE), &probe, &closer, Duration::ZERO).await,
        Ok(CloseOutcome::StillRunning)
    );
    assert_eq!(probe.calls.borrow().len(), 1);
}

#[tokio::test]
async fn a_slow_probe_cannot_report_exit_after_the_deadline() {
    struct SlowProbe;
    impl ProcessProbe for SlowProbe {
        fn is_running(&self, _: &Path) -> Result<bool, ProbeError> {
            std::thread::sleep(Duration::from_millis(20));
            Ok(false)
        }
    }
    let closer = FakeCloser::new(Ok(1));
    assert_eq!(
        close_windows(
            Path::new(EXE),
            &SlowProbe,
            &closer,
            Duration::from_millis(1)
        )
        .await,
        Ok(CloseOutcome::StillRunning)
    );
}

#[tokio::test(start_paused = true)]
async fn failures_do_not_claim_process_exit() {
    let closer = FakeCloser::new(Err(ProbeError::Failed));
    let probe = FakeProbe::new([]);
    assert_eq!(
        close_windows(Path::new(EXE), &probe, &closer, WAIT).await,
        Err(ProbeError::Failed)
    );
    assert!(probe.calls.borrow().is_empty());
    let closer = FakeCloser::new(Ok(1));
    let probe = FakeProbe::new([Err(ProbeError::Failed)]);
    assert_eq!(
        close_windows(Path::new(EXE), &probe, &closer, WAIT).await,
        Err(ProbeError::Failed)
    );
}
