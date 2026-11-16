use super::{
    CloseOutcome, PluginQuit, ProbeError, ProcessEntry, ProcessProbe, ProcessSnapshot, QuitAnswer,
    SystemProcessProbe, close_for_update, scan_process_ids, scan_processes,
};
use std::{
    cell::RefCell,
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    rc::Rc,
    time::Duration,
};

const ID: &str = "example-app";
const EXE: &str = "/installed/Example.exe";
const WAIT: Duration = Duration::from_millis(250);

#[derive(Debug, PartialEq, Eq)]
enum Event {
    Quit(String),
    Probe(PathBuf),
}
type Events = Rc<RefCell<Vec<Event>>>;

struct FakeQuit {
    answer: Option<QuitAnswer>,
    events: Events,
}
impl PluginQuit for FakeQuit {
    async fn quit(&self, id: &str) -> QuitAnswer {
        self.events.borrow_mut().push(Event::Quit(id.into()));
        match self.answer {
            Some(answer) => answer,
            None => {
                tokio::time::sleep(WAIT).await;
                QuitAnswer::Timeout
            }
        }
    }
}
struct FakeProbe {
    answers: RefCell<VecDeque<Result<bool, ProbeError>>>,
    fallback: Option<Result<bool, ProbeError>>,
    events: Events,
}
impl ProcessProbe for FakeProbe {
    fn is_running(&self, exe: &Path) -> Result<bool, ProbeError> {
        self.events
            .borrow_mut()
            .push(Event::Probe(exe.to_path_buf()));
        self.answers
            .borrow_mut()
            .pop_front()
            .or(self.fallback)
            .expect("unexpected probe")
    }
}
fn fakes(
    answer: Option<QuitAnswer>,
    probes: impl IntoIterator<Item = Result<bool, ProbeError>>,
    fallback: Option<Result<bool, ProbeError>>,
) -> (FakeQuit, FakeProbe, Events) {
    let events = Events::default();
    (
        FakeQuit {
            answer,
            events: events.clone(),
        },
        FakeProbe {
            answers: RefCell::new(probes.into_iter().collect()),
            fallback,
            events: events.clone(),
        },
        events,
    )
}
fn quit_event() -> Event {
    Event::Quit(ID.into())
}
fn probe_event() -> Event {
    Event::Probe(PathBuf::from(EXE))
}

#[tokio::test(start_paused = true)]
async fn acceptance_requires_a_probe_and_immediate_os_exit() {
    let (quit, probe, events) = fakes(Some(QuitAnswer::Accepted), [Ok(false)], None);
    assert_eq!(
        close_for_update(ID, Path::new(EXE), &quit, &probe, WAIT).await,
        CloseOutcome::Closed
    );
    assert_eq!(*events.borrow(), [quit_event(), probe_event()]);
}

#[tokio::test(start_paused = true)]
async fn acceptance_polls_until_the_executable_really_exits() {
    let (quit, probe, events) = fakes(
        Some(QuitAnswer::Accepted),
        [Ok(true), Ok(true), Ok(false)],
        None,
    );
    let start = tokio::time::Instant::now();
    assert_eq!(
        close_for_update(ID, Path::new(EXE), &quit, &probe, WAIT).await,
        CloseOutcome::Closed
    );
    assert!(start.elapsed() > Duration::ZERO && start.elapsed() < WAIT);
    assert_eq!(
        *events.borrow(),
        [quit_event(), probe_event(), probe_event(), probe_event()]
    );
}

#[tokio::test(start_paused = true)]
async fn acceptance_does_not_treat_a_running_process_as_closed_at_the_deadline() {
    let (quit, probe, events) = fakes(Some(QuitAnswer::Accepted), [], Some(Ok(true)));
    let start = tokio::time::Instant::now();
    assert_eq!(
        close_for_update(ID, Path::new(EXE), &quit, &probe, WAIT).await,
        CloseOutcome::StillRunning
    );
    assert_eq!(start.elapsed(), WAIT);
    let events = events.borrow();
    assert_eq!(events.first(), Some(&quit_event()));
    assert!(events.len() >= 3);
    assert!(events[1..].iter().all(|event| *event == probe_event()));
}

#[tokio::test(start_paused = true)]
async fn zero_wait_still_requires_one_immediate_probe() {
    for (running, expected) in [
        (false, CloseOutcome::Closed),
        (true, CloseOutcome::StillRunning),
    ] {
        let (quit, probe, events) = fakes(Some(QuitAnswer::Accepted), [Ok(running)], None);
        assert_eq!(
            close_for_update(ID, Path::new(EXE), &quit, &probe, Duration::ZERO).await,
            expected
        );
        assert_eq!(*events.borrow(), [quit_event(), probe_event()]);
    }
}

#[tokio::test(start_paused = true)]
async fn refusal_and_timeout_never_probe_or_authorize_closure() {
    for answer in [QuitAnswer::Refused, QuitAnswer::Timeout] {
        let (quit, probe, events) = fakes(Some(answer), [], None);
        assert_eq!(
            close_for_update(ID, Path::new(EXE), &quit, &probe, WAIT).await,
            CloseOutcome::StillRunning
        );
        assert_eq!(*events.borrow(), [quit_event()]);
    }
}

#[tokio::test(start_paused = true)]
async fn an_unresponsive_plugin_reports_its_own_timeout_and_fails_closed() {
    let (quit, probe, events) = fakes(None, [], None);
    let start = tokio::time::Instant::now();
    assert_eq!(
        close_for_update(ID, Path::new(EXE), &quit, &probe, WAIT).await,
        CloseOutcome::StillRunning
    );
    assert_eq!(start.elapsed(), WAIT);
    assert_eq!(*events.borrow(), [quit_event()]);
}

#[tokio::test(start_paused = true)]
async fn never_connected_checks_once_and_fails_closed_on_running_or_unknown() {
    for (answer, expected) in [
        (Ok(false), CloseOutcome::Closed),
        (Ok(true), CloseOutcome::StillRunning),
        (Err(ProbeError::Failed), CloseOutcome::StillRunning),
        (Err(ProbeError::Unsupported), CloseOutcome::StillRunning),
    ] {
        let (quit, probe, events) = fakes(Some(QuitAnswer::NotConnected), [answer], None);
        assert_eq!(
            close_for_update(ID, Path::new(EXE), &quit, &probe, WAIT).await,
            expected
        );
        assert_eq!(*events.borrow(), [quit_event(), probe_event()]);
    }
}

#[tokio::test(start_paused = true)]
async fn probe_failure_after_acceptance_fails_closed_even_after_a_successful_poll() {
    for answers in [
        vec![Err(ProbeError::Failed)],
        vec![Ok(true), Err(ProbeError::Failed)],
        vec![Err(ProbeError::Unsupported)],
    ] {
        let expected_calls = answers.len();
        let (quit, probe, events) = fakes(Some(QuitAnswer::Accepted), answers, None);
        assert_eq!(
            close_for_update(ID, Path::new(EXE), &quit, &probe, WAIT).await,
            CloseOutcome::StillRunning
        );
        let events = events.borrow();
        assert_eq!(events.len(), expected_calls + 1);
        assert_eq!(events[0], quit_event());
        assert!(events[1..].iter().all(|event| *event == probe_event()));
    }
}

struct FakeSnapshot {
    entries: VecDeque<Result<ProcessEntry, ProbeError>>,
    images: HashMap<u32, Result<Vec<u16>, ProbeError>>,
    opened: Rc<RefCell<Vec<u32>>>,
}
impl ProcessSnapshot for FakeSnapshot {
    fn next(&mut self) -> Result<Option<ProcessEntry>, ProbeError> {
        self.entries.pop_front().transpose()
    }

    fn image_path(&self, id: u32) -> Result<Vec<u16>, ProbeError> {
        self.opened.borrow_mut().push(id);
        self.images.get(&id).unwrap().clone()
    }
}
struct SnapshotProbe {
    snapshot: RefCell<FakeSnapshot>,
    compare_error: bool,
}
impl ProcessProbe for SnapshotProbe {
    fn is_running(&self, exe: &Path) -> Result<bool, ProbeError> {
        let name: Vec<u16> = "example.exe".encode_utf16().collect();
        let full: Vec<u16> = exe.to_str().unwrap().encode_utf16().collect();
        scan_processes(&mut *self.snapshot.borrow_mut(), &name, &full, |a, b| {
            if self.compare_error {
                Err(ProbeError::Failed)
            } else {
                Ok(String::from_utf16_lossy(a).eq_ignore_ascii_case(&String::from_utf16_lossy(b)))
            }
        })
    }
}
fn entry(id: u32, name: &str) -> Result<ProcessEntry, ProbeError> {
    Ok(ProcessEntry {
        id,
        name: name.encode_utf16().collect(),
    })
}
fn image(path: &str) -> Result<Vec<u16>, ProbeError> {
    Ok(path.encode_utf16().collect())
}
fn snapshot_probe(
    entries: Vec<Result<ProcessEntry, ProbeError>>,
    images: impl IntoIterator<Item = (u32, Result<Vec<u16>, ProbeError>)>,
) -> (SnapshotProbe, Rc<RefCell<Vec<u32>>>) {
    let opened: Rc<RefCell<Vec<u32>>> = Rc::default();
    (
        SnapshotProbe {
            snapshot: RefCell::new(FakeSnapshot {
                entries: entries.into(),
                images: images.into_iter().collect(),
                opened: opened.clone(),
            }),
            compare_error: false,
        },
        opened,
    )
}

#[test]
fn process_probe_filters_names_and_compares_complete_paths_case_insensitively() {
    for (wanted, running) in [
        (r"C:\Apps\Example.exe", r"c:\apps\EXAMPLE.exe"),
        (r"\\?\C:\Apps\Example.exe", r"c:\apps\EXAMPLE.exe"),
        (
            r"\\?\UNC\server\share\Example.exe",
            r"\\SERVER\share\EXAMPLE.exe",
        ),
    ] {
        let (probe, opened) = snapshot_probe(
            vec![
                entry(1, "other.exe"),
                entry(2, "EXAMPLE.exe"),
                entry(3, "example.EXE"),
            ],
            [(2, image(r"C:\Different\Example.exe")), (3, image(running))],
        );
        assert_eq!(probe.is_running(Path::new(wanted)), Ok(true));
        assert_eq!(*opened.borrow(), [2, 3]);
    }
    let (probe, opened) = snapshot_probe(
        vec![entry(1, "other.exe"), entry(2, "example.exe")],
        [(2, image(r"C:\Different\Example.exe"))],
    );
    assert_eq!(
        probe.is_running(Path::new(r"C:\Apps\Example.exe")),
        Ok(false)
    );
    assert_eq!(*opened.borrow(), [2]);
}

#[test]
fn process_probe_fails_closed_on_inaccessible_candidates_and_snapshot_errors() {
    let (probe, opened) = snapshot_probe(
        vec![entry(1, "other.exe"), entry(2, "EXAMPLE.exe")],
        [(2, Err(ProbeError::Failed))],
    );
    assert_eq!(
        probe.is_running(Path::new(r"C:\Apps\Example.exe")),
        Ok(true)
    );
    assert_eq!(*opened.borrow(), [2]);

    let (probe, opened) = snapshot_probe(vec![entry(1, "other.exe"), Err(ProbeError::Failed)], []);
    assert_eq!(
        probe.is_running(Path::new(r"C:\Apps\Example.exe")),
        Err(ProbeError::Failed)
    );
    assert!(opened.borrow().is_empty());

    let (mut probe, opened) = snapshot_probe(vec![entry(1, "example.exe")], []);
    probe.compare_error = true;
    assert_eq!(
        probe.is_running(Path::new(r"C:\Apps\Example.exe")),
        Err(ProbeError::Failed)
    );
    assert!(opened.borrow().is_empty());
}

#[test]
fn strict_process_ids_include_only_verified_full_paths_and_reject_inaccessible_candidates() {
    let (probe, _) = snapshot_probe(
        vec![
            entry(1, "example.exe"),
            entry(2, "example.exe"),
            entry(3, "example.exe"),
        ],
        [
            (1, image(r"C:\Apps\Example.exe")),
            (2, image(r"C:\Other\Example.exe")),
            (3, image(r"c:\apps\EXAMPLE.exe")),
        ],
    );
    let name: Vec<u16> = "example.exe".encode_utf16().collect();
    let exe: Vec<u16> = r"C:\Apps\Example.exe".encode_utf16().collect();
    let equal = |a: &[u16], b: &[u16]| {
        Ok(String::from_utf16_lossy(a).eq_ignore_ascii_case(&String::from_utf16_lossy(b)))
    };
    assert_eq!(
        scan_process_ids(
            &mut *probe.snapshot.borrow_mut(),
            &name,
            &exe,
            equal,
            false,
            false
        ),
        Ok(vec![1, 3])
    );
    let (probe, _) = snapshot_probe(
        vec![entry(4, "example.exe")],
        [(4, Err(ProbeError::Failed))],
    );
    assert_eq!(
        scan_process_ids(
            &mut *probe.snapshot.borrow_mut(),
            &name,
            &exe,
            equal,
            false,
            false
        ),
        Err(ProbeError::Failed)
    );
}

#[cfg(not(windows))]
#[test]
fn system_probe_is_explicitly_unsupported_off_windows() {
    assert_eq!(
        SystemProcessProbe.is_running(Path::new(EXE)),
        Err(ProbeError::Unsupported)
    );
}

#[cfg(windows)]
#[test]
fn system_probe_matches_current_executable_and_not_other_paths() {
    let exe = std::env::current_exe().unwrap();
    assert_eq!(SystemProcessProbe.is_running(&exe), Ok(true));
    assert_eq!(
        SystemProcessProbe.is_running(&std::fs::canonicalize(&exe).unwrap()),
        Ok(true)
    );
    let upper = PathBuf::from(exe.to_str().unwrap().to_ascii_uppercase());
    assert_eq!(SystemProcessProbe.is_running(&upper), Ok(true));
    let other_directory = exe
        .parent()
        .unwrap()
        .join("nexo-no-such-directory")
        .join(exe.file_name().unwrap());
    assert_eq!(SystemProcessProbe.is_running(&other_directory), Ok(false));
    let missing = exe.with_file_name(format!("nexo-no-such-{}-process.exe", std::process::id()));
    assert_eq!(SystemProcessProbe.is_running(&missing), Ok(false));
    assert_eq!(
        SystemProcessProbe.is_running(Path::new("relative.exe")),
        Err(ProbeError::Failed)
    );
}
