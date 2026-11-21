use crate::install_approval::{ApprovalDecision, ApprovalRequest, InstallApproval};
use crate::install_download::{Body, Network, NetworkError, Response, ResponseKind};
use crate::install_feed::{CatalogFeed, FeedError, FreshCatalog, NativeFeed};
use crate::install_launcher::LaunchError;
use crate::install_service::{
    CancelResult, CancellableNetwork, Detection, InstallDetector, InstallLauncher, InstallProgress,
    InstallResult, InstallService, InstallWorkspace, Installer, Monitor, Operation,
    ProgressReporter, ProgressSink, UpdateCloser, UpdateDetection,
};
use crate::install_service_tests::document;
use crate::install_workspace::PrepareError;
use crate::update_close::{CloseOutcome, ProbeError};
use nexo_catalog::CatalogApp;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::sync::Semaphore;

fn installed(version: &str) -> UpdateDetection {
    UpdateDetection::Installed {
        version: Some(version.into()),
        executable: PathBuf::from("/installed/Minimal.exe"),
    }
}
struct State {
    events: Mutex<Vec<String>>,
    documents: Mutex<VecDeque<Result<Value, FeedError>>>,
    observations: Mutex<VecDeque<UpdateDetection>>,
    close: Mutex<CloseOutcome>,
    probe: Mutex<Result<bool, ProbeError>>,
    approved: AtomicBool,
    cleanup_fails: AtomicBool,
    active: AtomicUsize,
    hold_close: AtomicBool,
    close_gate: Semaphore,
    wait_gate: Semaphore,
    exit: Mutex<Result<(), LaunchError>>,
}
impl State {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            events: Mutex::new(vec![]),
            documents: Mutex::new(VecDeque::new()),
            observations: Mutex::new(
                [
                    installed("0.9.0"),
                    installed("0.9.0"),
                    installed("0.9.0"),
                    installed("1.0.0"),
                ]
                .into(),
            ),
            close: Mutex::new(CloseOutcome::Closed),
            probe: Mutex::new(Ok(false)),
            approved: AtomicBool::new(true),
            cleanup_fails: AtomicBool::new(false),
            active: AtomicUsize::new(0),
            hold_close: AtomicBool::new(false),
            close_gate: Semaphore::new(0),
            wait_gate: Semaphore::new(1),
            exit: Mutex::new(Ok(())),
        })
    }
    fn log(&self, event: impl Into<String>) {
        self.events.lock().unwrap().push(event.into());
    }
    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }
    fn observe(&self, values: Vec<UpdateDetection>) {
        *self.observations.lock().unwrap() = values.into();
    }
    /// Wall-clock deadline instead of a yield count, which is flaky under load.
    async fn until(&self, event: &str) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if self.events().iter().any(|seen| seen == event) {
                return;
            }
            if std::time::Instant::now() >= deadline {
                panic!("missing {event}: {:?}", self.events());
            }
            tokio::time::sleep(std::time::Duration::from_millis(1)).await;
        }
    }
}
struct BodyBytes(Option<Vec<u8>>);
impl Body for BodyBytes {
    async fn next(&mut self) -> Result<Option<Vec<u8>>, NetworkError> {
        Ok(self.0.take())
    }
}
struct DocumentNetwork(Value);
impl Network for DocumentNetwork {
    type Body = BodyBytes;
    async fn get(&self, url: &str) -> Result<Response<Self::Body>, NetworkError> {
        let bytes = self.0.to_string().into_bytes();
        Ok(Response {
            effective_url: url.into(),
            kind: ResponseKind::Ok {
                length: Some(bytes.len() as u64),
                body: BodyBytes(Some(bytes)),
            },
        })
    }
}
struct Feed(Arc<State>);
impl CatalogFeed for Feed {
    async fn fetch(&self) -> Result<FreshCatalog, FeedError> {
        self.0.log("feed");
        let document = self
            .0
            .documents
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Ok(document()))?;
        NativeFeed::for_platform(DocumentNetwork(document), Some("windows-x86_64"))
            .fetch()
            .await
    }
}
struct NoNetwork;
impl Network for NoNetwork {
    type Body = BodyBytes;
    async fn get(&self, _: &str) -> Result<Response<Self::Body>, NetworkError> {
        panic!("unexpected real network")
    }
}
struct Workspace(Arc<State>);
struct Verified(Arc<State>);
impl Installer for Verified {
    fn cleanup(self) -> Result<(), ()> {
        self.0.log("cleanup");
        if self.0.cleanup_fails.load(Ordering::SeqCst) {
            return Err(());
        }
        self.0.active.fetch_sub(1, Ordering::SeqCst);
        Ok(())
    }
}
impl InstallWorkspace<NoNetwork> for Workspace {
    type Installer = Verified;
    async fn prepare(
        &self,
        _: &CancellableNetwork<'_, NoNetwork>,
        _: &CatalogApp,
        progress: &ProgressReporter,
    ) -> Result<Verified, PrepareError> {
        self.0.log("download");
        progress.phase(crate::install_service::ProgressPhase::Verifying);
        self.0.active.fetch_add(1, Ordering::SeqCst);
        Ok(Verified(self.0.clone()))
    }
}
struct Detector(Arc<State>);
impl InstallDetector for Detector {
    async fn detect(&self, _: &FreshCatalog, _: &CatalogApp) -> Detection {
        Detection::NotInstalled
    }
    async fn detect_update(&self, _: &FreshCatalog, _: &CatalogApp) -> UpdateDetection {
        self.0.log("detect");
        self.0
            .observations
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(UpdateDetection::Unknown)
    }
}
struct Approval(Arc<State>);
impl InstallApproval for Approval {
    fn confirm(&self, _: &ApprovalRequest<'_>) -> ApprovalDecision {
        panic!("install approval used for update")
    }
    fn confirm_update(&self, req: &ApprovalRequest<'_>, current: &str) -> ApprovalDecision {
        self.0.log(format!(
            "approval:{}:{current}:{}:{}:{}",
            req.app_name, req.version, req.publisher_host, req.language
        ));
        if self.0.approved.load(Ordering::SeqCst) {
            ApprovalDecision::Approved
        } else {
            ApprovalDecision::Denied
        }
    }
}
struct Closer(Arc<State>);
impl UpdateCloser for Closer {
    async fn close(&self, id: &str, exe: &Path) -> CloseOutcome {
        self.0.log(format!("close:{id}:{}", exe.display()));
        if self.0.hold_close.load(Ordering::SeqCst) {
            self.0.close_gate.acquire().await.unwrap().forget();
        }
        *self.0.close.lock().unwrap()
    }
    fn is_running(&self, exe: &Path) -> Result<bool, ProbeError> {
        self.0.log(format!("probe:{}", exe.display()));
        *self.0.probe.lock().unwrap()
    }
}
struct Launcher(Arc<State>);
struct Running(Arc<State>);
impl InstallLauncher<Verified> for Launcher {
    type Running = Running;
    async fn launch(
        &self,
        _: &Verified,
        operation: Arc<Operation>,
    ) -> Result<Running, LaunchError> {
        operation
            .spawn(|| {
                self.0.log("launch");
                Ok(Running(self.0.clone()))
            })
            .unwrap_or(Err(LaunchError::Spawn))
    }
}
impl Monitor for Running {
    async fn wait(&mut self) -> Result<(), LaunchError> {
        self.0.log("wait");
        self.0.wait_gate.acquire().await.unwrap().forget();
        *self.0.exit.lock().unwrap()
    }
    async fn wait_until_exit(self) -> Result<(), LaunchError> {
        self.0.log("exited");
        *self.0.exit.lock().unwrap()
    }
}
fn service(
    state: &Arc<State>,
) -> InstallService<Feed, NoNetwork, Workspace, Approval, Launcher, Detector> {
    InstallService::new(
        Feed(state.clone()),
        NoNetwork,
        Workspace(state.clone()),
        Approval(state.clone()),
        Launcher(state.clone()),
        Detector(state.clone()),
    )
}
async fn update(state: &Arc<State>) -> Value {
    serde_json::to_value(
        service(state)
            .update_app("minimal", "es", Arc::new(Closer(state.clone())))
            .await,
    )
    .unwrap()
}
#[derive(Default)]
struct ProgressEvents(Mutex<Vec<InstallProgress>>);
impl ProgressSink for ProgressEvents {
    fn emit(&self, value: InstallProgress) {
        self.0.lock().unwrap().push(value);
    }
}

#[tokio::test]
async fn update_success_obeys_transaction_order_and_reports_progress() {
    let state = State::new();
    let progress = Arc::new(ProgressEvents::default());
    let result = service(&state)
        .update_app_with_progress(
            "minimal",
            "es",
            progress.clone(),
            Arc::new(Closer(state.clone())),
        )
        .await;
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({"status":"updated","version":"1.0.0"})
    );
    assert_eq!(
        state.events(),
        [
            "feed",
            "detect",
            "approval:Minimal:0.9.0:1.0.0:github.com:es",
            "download",
            "feed",
            "detect",
            "close:minimal:/installed/Minimal.exe",
            "feed",
            "detect",
            "probe:/installed/Minimal.exe",
            "launch",
            "wait",
            "exited",
            "detect",
            "cleanup"
        ]
    );
    let phases: Vec<Value> = progress
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|event| serde_json::to_value(event).unwrap()["phase"].clone())
        .collect();
    assert_eq!(
        phases,
        [
            "fetching",
            "awaitingApproval",
            "downloading",
            "verifying",
            "closing",
            "installing",
            "detecting"
        ]
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn strict_installed_semver_and_precedence_gate_updates() {
    for (observation, expected) in [
        (
            UpdateDetection::NotInstalled,
            json!({"status":"detectionUnknown"}),
        ),
        (
            UpdateDetection::Unknown,
            json!({"status":"detectionUnknown"}),
        ),
        (
            UpdateDetection::Installed {
                version: None,
                executable: "/installed/Minimal.exe".into(),
            },
            json!({"status":"detectionUnknown"}),
        ),
        (installed("v0.9.0"), json!({"status":"detectionUnknown"})),
        (installed("01.0.0"), json!({"status":"detectionUnknown"})),
        (
            installed("1.0.0+other"),
            json!({"status":"upToDate","version":"1.0.0+other"}),
        ),
        (
            installed("1.0.1"),
            json!({"status":"upToDate","version":"1.0.1"}),
        ),
    ] {
        let state = State::new();
        state.observe(vec![observation]);
        assert_eq!(update(&state).await, expected);
        assert_eq!(state.events(), ["feed", "detect"]);
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
    let state = State::new();
    state.observe(vec![
        installed("1.0.0-rc.1"),
        installed("1.0.0-rc.1"),
        installed("1.0.0-rc.1"),
        installed("1.0.0+build"),
    ]);
    assert_eq!(
        update(&state).await,
        json!({"status":"updated","version":"1.0.0+build"})
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn update_still_refuses_unknown_installation_before_approval() {
    let state = State::new();
    state.observe(vec![UpdateDetection::Unknown]);
    assert_eq!(update(&state).await, json!({"status":"detectionUnknown"}));
    assert_eq!(state.events(), ["feed", "detect"]);
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn absent_key_bad_feed_and_denied_approval_never_download_or_launch() {
    let state = State::new();
    let mut missing = document();
    missing["apps"][0]["platforms"]["windows-x86_64"]
        .as_object_mut()
        .unwrap()
        .remove("updaterPublicKey");
    state.documents.lock().unwrap().push_back(Ok(missing));
    assert_eq!(update(&state).await, json!({"status":"keyMissing"}));
    assert_eq!(state.events(), ["feed"]);
    let state = State::new();
    state
        .documents
        .lock()
        .unwrap()
        .push_back(Err(FeedError::Network));
    assert_eq!(update(&state).await, json!({"status":"feedFailed"}));
    assert_eq!(state.events(), ["feed"]);
    let state = State::new();
    state.approved.store(false, Ordering::SeqCst);
    assert_eq!(update(&state).await, json!({"status":"cancelled"}));
    assert_eq!(
        state.events(),
        [
            "feed",
            "detect",
            "approval:Minimal:0.9.0:1.0.0:github.com:es"
        ]
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn changed_release_or_observation_aborts_after_download_and_cleans() {
    let mut changed = document();
    changed["apps"][0]["platforms"]["windows-x86_64"]["version"] = json!("1.1.0");
    let state = State::new();
    *state.documents.lock().unwrap() = [Ok(document()), Ok(changed)].into();
    assert_eq!(update(&state).await, json!({"status":"releaseChanged"}));
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
    for (observation, expected) in [
        (installed("0.9.1"), json!({"status":"releaseChanged"})),
        (
            installed("1.1.0"),
            json!({"status":"upToDate","version":"1.1.0"}),
        ),
        (
            UpdateDetection::Unknown,
            json!({"status":"detectionUnknown"}),
        ),
    ] {
        let state = State::new();
        state.observe(vec![installed("0.9.0"), observation]);
        assert_eq!(update(&state).await, expected);
        assert_eq!(state.events().last().unwrap(), "cleanup");
        assert!(!state.events().contains(&"launch".into()));
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn failed_close_or_final_process_probe_never_spawns_and_cleans() {
    for (close, probe) in [
        (CloseOutcome::StillRunning, Ok(false)),
        (CloseOutcome::Closed, Ok(true)),
        (CloseOutcome::Closed, Err(ProbeError::Failed)),
        (CloseOutcome::Closed, Err(ProbeError::Unsupported)),
    ] {
        let state = State::new();
        *state.close.lock().unwrap() = close;
        *state.probe.lock().unwrap() = probe;
        assert_eq!(update(&state).await, json!({"status":"appStillRunning"}));
        assert!(!state.events().contains(&"launch".into()));
        assert_eq!(state.events().last().unwrap(), "cleanup");
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
    let state = State::new();
    *state.close.lock().unwrap() = CloseOutcome::StillRunning;
    state.cleanup_fails.store(true, Ordering::SeqCst);
    assert_eq!(update(&state).await, json!({"status":"cleanupFailed"}));
    assert_eq!(state.active.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn metadata_and_identity_are_rechecked_after_close_before_spawn() {
    let mut changed = document();
    changed["apps"][0]["platforms"]["windows-x86_64"]["version"] = json!("1.1.0");
    let state = State::new();
    *state.documents.lock().unwrap() = [Ok(document()), Ok(document()), Ok(changed)].into();
    assert_eq!(update(&state).await, json!({"status":"releaseChanged"}));
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
    let state = State::new();
    let moved = UpdateDetection::Installed {
        version: Some("0.9.0".into()),
        executable: "/other/Minimal.exe".into(),
    };
    state.observe(vec![installed("0.9.0"), installed("0.9.0"), moved]);
    assert_eq!(update(&state).await, json!({"status":"releaseChanged"}));
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn successful_exit_requires_target_redetection_and_failures_are_reported() {
    for (observation, expected) in [
        (
            installed("0.9.0"),
            json!({"status":"versionMismatch","version":"0.9.0"}),
        ),
        (
            installed("1.1.0"),
            json!({"status":"versionMismatch","version":"1.1.0"}),
        ),
        (UpdateDetection::Unknown, json!({"status":"notDetected"})),
        (
            UpdateDetection::NotInstalled,
            json!({"status":"notDetected"}),
        ),
    ] {
        let state = State::new();
        state.observe(vec![
            installed("0.9.0"),
            installed("0.9.0"),
            installed("0.9.0"),
            observation,
        ]);
        assert_eq!(update(&state).await, expected);
        assert!(state.events().contains(&"launch".into()));
        assert_eq!(state.events().last().unwrap(), "cleanup");
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
    let state = State::new();
    *state.exit.lock().unwrap() = Err(LaunchError::Exit(42));
    assert_eq!(
        update(&state).await,
        json!({"status":"installerFailed","code":42})
    );
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn update_shares_claim_with_install_and_cancel_waits_for_close_cleanup() {
    let state = State::new();
    state.hold_close.store(true, Ordering::SeqCst);
    let service = Arc::new(service(&state));
    let updating = {
        let service = service.clone();
        let state = state.clone();
        tokio::spawn(async move {
            service
                .update_app("minimal", "en", Arc::new(Closer(state)))
                .await
        })
    };
    state.until("close:minimal:/installed/Minimal.exe").await;
    assert_eq!(
        service.install_app("minimal", "en").await,
        InstallResult::Busy
    );
    assert_eq!(
        service
            .update_app("minimal", "en", Arc::new(Closer(state.clone())))
            .await,
        InstallResult::Busy
    );
    let cancel = {
        let service = service.clone();
        tokio::spawn(async move { service.cancel_install("minimal").await })
    };
    tokio::task::yield_now().await;
    assert!(!cancel.is_finished());
    state.close_gate.add_permits(1);
    assert_eq!(cancel.await.unwrap(), CancelResult::Cancelled);
    assert_eq!(updating.await.unwrap(), InstallResult::Cancelled);
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn open_and_update_claims_exclude_each_other_without_blocking_other_ids() {
    let state = State::new();
    let service = Arc::new(service(&state));
    let opening = service.begin_open("minimal").unwrap();
    assert_eq!(
        service
            .update_app("minimal", "en", Arc::new(Closer(state.clone())))
            .await,
        InstallResult::Busy
    );
    assert!(service.begin_open("another").is_some());
    assert_eq!(
        service.cancel_install("minimal").await,
        CancelResult::NotRunning
    );
    drop(opening);
    state.hold_close.store(true, Ordering::SeqCst);
    let updating = {
        let service = service.clone();
        let state = state.clone();
        tokio::spawn(async move {
            service
                .update_app("minimal", "en", Arc::new(Closer(state)))
                .await
        })
    };
    state.until("close:minimal:/installed/Minimal.exe").await;
    assert!(service.begin_open("minimal").is_none());
    assert!(service.begin_open("another").is_some());
    state.close_gate.add_permits(1);
    assert_eq!(
        serde_json::to_value(updating.await.unwrap()).unwrap(),
        json!({"status":"updated","version":"1.0.0"})
    );
    assert!(service.begin_open("minimal").is_some());
}

#[tokio::test]
async fn cancellation_after_update_spawn_is_too_late_and_monitor_retains_claim() {
    let state = State::new();
    state.wait_gate.acquire().await.unwrap().forget();
    let service = Arc::new(service(&state));
    let updating = {
        let service = service.clone();
        let state = state.clone();
        tokio::spawn(async move {
            service
                .update_app("minimal", "en", Arc::new(Closer(state)))
                .await
        })
    };
    state.until("wait").await;
    assert_eq!(
        service.cancel_install("minimal").await,
        CancelResult::TooLate
    );
    assert_eq!(
        service.install_app("minimal", "en").await,
        InstallResult::Busy
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 1);
    state.wait_gate.add_permits(1);
    assert_eq!(
        serde_json::to_value(updating.await.unwrap()).unwrap(),
        json!({"status":"updated","version":"1.0.0"})
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

const PARITY: &[(&str, &str, Option<i8>)] = &[
    ("1.0.0-alpha", "1.0.0-alpha.1", Some(-1)),
    ("1.0.0-alpha.1", "1.0.0-alpha.beta", Some(-1)),
    ("1.0.0-beta.2", "1.0.0-beta.11", Some(-1)),
    ("1.0.0-1", "1.0.0-a", Some(-1)),
    ("1.0.0-A", "1.0.0-a", Some(-1)),
    ("1.0.0-a-b", "1.0.0-a", Some(1)),
    (
        "1.0.0-99999999999999999999",
        "1.0.0-100000000000000000000",
        Some(-1),
    ),
    ("1.0.0-rc.1+x", "1.0.0-rc.1", Some(0)),
    ("1.0.0+001", "1.0.0", Some(0)),
    ("18446744073709551615.0.0", "1.0.0", Some(1)),
    ("1.0.0-0", "1.0.0-00a", Some(-1)),
    ("1.0.0-01", "1.0.0", None),
    ("18446744073709551616.0.0", "1.0.0", None),
    ("1.0.0+", "1.0.0", None),
    ("1.0.0-a..b", "1.0.0", None),
    (" 1.0.0", "1.0.0", None),
    ("1.0.0-ä", "1.0.0", None),
];

/// Same table as `apps/hub/src/catalog/format.semver.test.ts`: UI and native precedence must agree.
#[test]
fn semver_precedence_matches_the_ui_table() {
    for &(a, b, want) in PARITY {
        let got = match (semver::Version::parse(a), semver::Version::parse(b)) {
            (Ok(x), Ok(y)) => Some(x.cmp_precedence(&y) as i8),
            _ => None,
        };
        assert_eq!(got, want, "{a} vs {b}");
    }
}
