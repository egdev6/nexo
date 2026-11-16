use crate::install_approval::{ApprovalDecision, ApprovalRequest, InstallApproval};
use crate::install_download::{
    self, Artifact, Body, Network, NetworkError, Progress, Response, ResponseKind, StorageError,
    WorkspaceFactory,
};
use crate::install_feed::{CatalogFeed, FeedError, FreshCatalog, NativeFeed};
use crate::install_launcher::LaunchError;
use crate::install_service::{
    CancelResult, CancellableNetwork, Detection, InstallDetector, InstallLauncher, InstallProgress,
    InstallResult, InstallService, InstallWorkspace, Installer, Monitor, Operation, ProgressPhase,
    ProgressReporter, ProgressSink,
};
use crate::install_signature::VerifyError;
use crate::install_workspace::{PrepareError, PrepareFailure};
use base64::{Engine, engine::general_purpose::STANDARD};
use nexo_catalog::CatalogApp;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
use tokio::sync::Semaphore;

fn document() -> Value {
    let mut value: Value = serde_json::from_str(include_str!(
        "../../../../crates/nexo-catalog/fixtures/minimal.json"
    ))
    .unwrap();
    value["schemaVersion"] = json!(3);
    value["apps"][0]["installerUrl"] =
        json!("https://github.com/egdev6/example/releases/download/v1/example_x64-setup.exe");
    value["apps"][0]["latestJsonUrl"] =
        json!("https://github.com/egdev6/example/releases/download/v1/latest.json");
    value["apps"][0]["updaterPublicKey"] =
        json!(STANDARD.encode(include_str!("../tests/fixtures/tauri-test.pub")));
    value["apps"][0]["version"] = json!("1.0.0");
    value["apps"][0]["detection"] = json!({"windows": {"displayName": "Minimal", "publisher": "Example", "executableRelativePath": "Minimal.exe"}});
    value
}

struct FakeBody(Option<Vec<u8>>);
impl Body for FakeBody {
    async fn next(&mut self) -> Result<Option<Vec<u8>>, NetworkError> {
        Ok(self.0.take())
    }
}
struct DocumentNetwork(Value);
impl Network for DocumentNetwork {
    type Body = FakeBody;
    async fn get(&self, url: &str) -> Result<Response<Self::Body>, NetworkError> {
        let bytes = self.0.to_string().into_bytes();
        Ok(Response {
            effective_url: url.into(),
            kind: ResponseKind::Ok {
                length: Some(bytes.len() as u64),
                body: FakeBody(Some(bytes)),
            },
        })
    }
}
struct State {
    events: Mutex<Vec<String>>,
    approval_bodies: Mutex<Vec<String>>,
    approval_decisions: Mutex<VecDeque<bool>>,
    documents: Mutex<VecDeque<Result<Value, FeedError>>>,
    observations: Mutex<VecDeque<Detection>>,
    approved: AtomicBool,
    hold_approval: AtomicBool,
    approval_gate: (Mutex<bool>, Condvar),
    streaming: AtomicBool,
    complete_stream: AtomicBool,
    hold_launch: AtomicBool,
    launch_gate: Semaphore,
    prepare_error: Mutex<Option<PrepareError>>,
    cleanup_failure: AtomicBool,
    launch_error: Mutex<Option<LaunchError>>,
    outcome: Mutex<Result<(), LaunchError>>,
    active: AtomicUsize,
    first: Semaphore,
    exited: Semaphore,
}
impl State {
    fn new(first: usize, exited: usize) -> Arc<Self> {
        Arc::new(Self {
            events: Mutex::new(vec![]),
            approval_bodies: Mutex::new(vec![]),
            approval_decisions: Mutex::new(VecDeque::new()),
            documents: Mutex::new(VecDeque::new()),
            observations: Mutex::new(
                [
                    Detection::NotInstalled,
                    Detection::NotInstalled,
                    Detection::Installed {
                        version: Some("9.2.1".into()),
                    },
                ]
                .into(),
            ),
            approved: AtomicBool::new(true),
            hold_approval: AtomicBool::new(false),
            approval_gate: (Mutex::new(false), Condvar::new()),
            streaming: AtomicBool::new(false),
            complete_stream: AtomicBool::new(false),
            hold_launch: AtomicBool::new(false),
            launch_gate: Semaphore::new(0),
            prepare_error: Mutex::new(None),
            cleanup_failure: AtomicBool::new(false),
            launch_error: Mutex::new(None),
            outcome: Mutex::new(Ok(())),
            active: AtomicUsize::new(0),
            first: Semaphore::new(first),
            exited: Semaphore::new(exited),
        })
    }
    fn log(&self, event: impl Into<String>) {
        self.events.lock().unwrap().push(event.into());
    }
    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }
    fn observe(&self, observations: Vec<Detection>) {
        *self.observations.lock().unwrap() = observations.into();
    }
    /// Waits for a boundary event with a wall-clock deadline. A fixed number of
    /// yields is not enough under load: spawned work may not have been polled yet.
    async fn until(&self, event: &str) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            if self.events().iter().any(|seen| seen == event) {
                return;
            }
            if std::time::Instant::now() >= deadline {
                panic!("missing event {event}: {:?}", self.events());
            }
            tokio::time::sleep(std::time::Duration::from_millis(1)).await;
        }
    }
}
struct Feed(Arc<State>);
impl CatalogFeed for Feed {
    async fn fetch(&self) -> Result<FreshCatalog, FeedError> {
        self.0.log("feed");
        let doc = self
            .0
            .documents
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| Ok(document()))?;
        NativeFeed::new(DocumentNetwork(doc)).fetch().await
    }
}
struct FakeNetwork(Arc<State>);
struct StreamBody {
    state: Arc<State>,
    first: bool,
}
impl Body for StreamBody {
    async fn next(&mut self) -> Result<Option<Vec<u8>>, NetworkError> {
        if self.first {
            self.first = false;
            Ok(Some(vec![1]))
        } else if self.state.complete_stream.load(Ordering::SeqCst) {
            Ok(None)
        } else {
            self.state.log("body-pending");
            std::future::pending().await
        }
    }
}
impl Network for FakeNetwork {
    type Body = StreamBody;
    async fn get(&self, url: &str) -> Result<Response<Self::Body>, NetworkError> {
        self.0.log("network");
        Ok(Response {
            effective_url: url.into(),
            kind: if self.0.streaming.load(Ordering::SeqCst) {
                ResponseKind::Ok {
                    length: if self.0.complete_stream.load(Ordering::SeqCst) {
                        None
                    } else {
                        Some(2)
                    },
                    body: StreamBody {
                        state: self.0.clone(),
                        first: true,
                    },
                }
            } else {
                ResponseKind::Failed
            },
        })
    }
}
struct MemoryFactory(Arc<State>);
struct MemoryWorkspace(Arc<State>);
impl WorkspaceFactory for MemoryFactory {
    type Workspace = MemoryWorkspace;
    fn create(&self) -> Result<Self::Workspace, StorageError> {
        self.0.active.fetch_add(1, Ordering::SeqCst);
        Ok(MemoryWorkspace(self.0.clone()))
    }
}
impl install_download::Workspace for MemoryWorkspace {
    async fn write(&mut self, _: Artifact, _: &[u8]) -> Result<(), StorageError> {
        Ok(())
    }
    fn cleanup(&mut self) -> Result<(), StorageError> {
        self.0.log("cleanup");
        if self.0.cleanup_failure.load(Ordering::SeqCst) {
            return Err(StorageError);
        }
        self.0.active.fetch_sub(1, Ordering::SeqCst);
        Ok(())
    }
}
struct Workspace(Arc<State>);
struct Verified(Arc<State>);
impl Installer for Verified {
    fn cleanup(self) -> Result<(), ()> {
        self.0.log("cleanup");
        if self.0.cleanup_failure.load(Ordering::SeqCst) {
            return Err(());
        }
        self.0.active.fetch_sub(1, Ordering::SeqCst);
        Ok(())
    }
}
impl InstallWorkspace<FakeNetwork> for Workspace {
    type Installer = Verified;
    async fn prepare(
        &self,
        network: &CancellableNetwork<'_, FakeNetwork>,
        app: &CatalogApp,
        progress: &ProgressReporter,
    ) -> Result<Verified, PrepareError> {
        self.0.log("download");
        if self.0.streaming.load(Ordering::SeqCst) {
            let result = install_download::download_pair(
                network,
                &MemoryFactory(self.0.clone()),
                &app.installer_url,
                install_download::Limits::default(),
                |item| progress.download(item),
            )
            .await;
            return match result {
                Ok(prepared) => {
                    prepared.cleanup().unwrap();
                    self.0.active.fetch_add(1, Ordering::SeqCst);
                    Ok(Verified(self.0.clone()))
                }
                Err(error) => Err(PrepareError {
                    cause: PrepareFailure::Download(error.cause),
                    cleanup_failed: error.cleanup_failed,
                }),
            };
        }
        let _ = network.get(&app.installer_url).await;
        for bytes in 1..=50 {
            progress.download(Progress {
                artifact: Artifact::Installer,
                bytes,
                total: Some(50),
            });
        }
        progress.phase(ProgressPhase::Verifying);
        if let Some(error) = *self.0.prepare_error.lock().unwrap() {
            return Err(error);
        }
        self.0.active.fetch_add(1, Ordering::SeqCst);
        Ok(Verified(self.0.clone()))
    }
}
struct Detector(Arc<State>);
impl InstallDetector for Detector {
    async fn detect(&self, catalog: &FreshCatalog, app: &CatalogApp) -> Detection {
        assert_eq!(catalog.select(&app.id).unwrap().app(), app);
        assert!(catalog.catalog().apps.contains(app));
        self.0.log(format!(
            "detect:{}",
            app.version.as_deref().unwrap_or("none")
        ));
        self.0
            .observations
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(Detection::NotInstalled)
    }
}
struct Approval(Arc<State>);
impl InstallApproval for Approval {
    fn confirm(&self, request: &ApprovalRequest<'_>) -> ApprovalDecision {
        self.0.approval_bodies.lock().unwrap().push(
            crate::install_approval::approval_text(request)
                .unwrap()
                .body,
        );
        self.0.log(format!(
            "approval:{}:{}:{}:{}",
            request.app_name, request.version, request.publisher_host, request.language
        ));
        if self.0.hold_approval.load(Ordering::SeqCst) {
            let (lock, ready) = &self.0.approval_gate;
            let mut released = lock.lock().unwrap();
            while !*released {
                released = ready.wait(released).unwrap();
            }
        }
        if self
            .0
            .approval_decisions
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| self.0.approved.load(Ordering::SeqCst))
        {
            ApprovalDecision::Approved
        } else {
            ApprovalDecision::Denied
        }
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
        if self.0.hold_launch.load(Ordering::SeqCst) {
            self.0.log("before-spawn");
            self.0.launch_gate.acquire().await.unwrap().forget();
        }
        operation
            .spawn(|| {
                self.0.log("launch");
                if let Some(error) = *self.0.launch_error.lock().unwrap() {
                    Err(error)
                } else {
                    Ok(Running(self.0.clone()))
                }
            })
            .unwrap_or(Err(LaunchError::Spawn))
    }
}
impl Monitor for Running {
    async fn wait(&mut self) -> Result<(), LaunchError> {
        self.0.log("wait");
        self.0.first.acquire().await.unwrap().forget();
        *self.0.outcome.lock().unwrap()
    }
    async fn wait_until_exit(self) -> Result<(), LaunchError> {
        self.0.log("monitor");
        self.0.exited.acquire().await.unwrap().forget();
        self.0.log("exited");
        *self.0.outcome.lock().unwrap()
    }
}
fn service(
    state: &Arc<State>,
) -> InstallService<Feed, FakeNetwork, Workspace, Approval, Launcher, Detector> {
    InstallService::new(
        Feed(state.clone()),
        FakeNetwork(state.clone()),
        Workspace(state.clone()),
        Approval(state.clone()),
        Launcher(state.clone()),
        Detector(state.clone()),
    )
}

#[derive(Default)]
struct Events(Mutex<Vec<InstallProgress>>);
impl ProgressSink for Events {
    fn emit(&self, progress: InstallProgress) {
        self.0.lock().unwrap().push(progress);
    }
}

#[tokio::test]
async fn progress_reaches_the_sink_with_phases_byte_counts_and_throttling() {
    let state = State::new(1, 1);
    let sink = Arc::new(Events::default());
    assert!(matches!(
        service(&state)
            .install_app_with_progress("minimal", "en", sink.clone())
            .await,
        InstallResult::Installed { .. }
    ));
    let events = sink.0.lock().unwrap();
    let mut phases: Vec<_> = events.iter().map(|event| event.phase).collect();
    phases.dedup();
    assert_eq!(
        phases,
        [
            ProgressPhase::Fetching,
            ProgressPhase::AwaitingApproval,
            ProgressPhase::Downloading,
            ProgressPhase::Verifying,
            ProgressPhase::Installing,
            ProgressPhase::Detecting
        ]
    );
    assert!(events.iter().all(|event| event.id == "minimal"));
    let bytes: Vec<_> = events
        .iter()
        .filter(|event| event.received.is_some())
        .collect();
    assert_eq!(bytes.len(), 1, "rapid byte updates must be throttled");
    assert_eq!(
        serde_json::to_value(bytes[0]).unwrap(),
        json!({"id":"minimal","phase":"downloading","received":1,"total":50})
    );
    assert_eq!(
        serde_json::to_value(&events[0]).unwrap(),
        json!({"id":"minimal","phase":"fetching"})
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn real_download_adapter_reports_unknown_total_then_verification() {
    let state = State::new(1, 1);
    state.streaming.store(true, Ordering::SeqCst);
    state.complete_stream.store(true, Ordering::SeqCst);
    let sink = Arc::new(Events::default());
    assert!(matches!(
        service(&state)
            .install_app_with_progress("minimal", "en", sink.clone())
            .await,
        InstallResult::Installed { .. }
    ));
    let events = sink.0.lock().unwrap();
    let bytes = events
        .iter()
        .find(|event| event.received.is_some())
        .unwrap();
    assert_eq!(
        serde_json::to_value(bytes).unwrap(),
        json!({"id":"minimal","phase":"downloading","received":1})
    );
    let verifying = events
        .iter()
        .position(|event| event.phase == ProgressPhase::Verifying)
        .unwrap();
    let installing = events
        .iter()
        .position(|event| event.phase == ProgressPhase::Installing)
        .unwrap();
    assert!(verifying < installing);
    assert_eq!(
        state
            .events()
            .iter()
            .filter(|event| *event == "network")
            .count(),
        2
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cancelling_approval_keeps_the_claim_until_the_native_dialog_returns() {
    let state = State::new(1, 1);
    state.hold_approval.store(true, Ordering::SeqCst);
    let service = Arc::new(service(&state));
    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.install_app("minimal", "en").await })
    };
    state.until("approval:Minimal:1.0.0:github.com:en").await;
    let cancelling = {
        let service = service.clone();
        tokio::spawn(async move { service.cancel_install("minimal").await })
    };
    for _ in 0..100 {
        tokio::task::yield_now().await;
    }
    let premature = cancelling.is_finished();
    if !premature {
        assert_eq!(
            service.install_app("minimal", "en").await,
            InstallResult::Busy
        );
    }
    *state.approval_gate.0.lock().unwrap() = true;
    state.approval_gate.1.notify_all();
    assert_eq!(cancelling.await.unwrap(), CancelResult::Cancelled);
    assert_eq!(first.await.unwrap(), InstallResult::Cancelled);
    assert!(
        !premature,
        "cancellation returned while the native approval was still open"
    );
    assert!(!state.events().contains(&"download".into()));
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn cancellation_wins_if_requested_before_the_actual_spawn() {
    let state = State::new(1, 1);
    state.hold_launch.store(true, Ordering::SeqCst);
    let service = Arc::new(service(&state));
    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.install_app("minimal", "en").await })
    };
    state.until("before-spawn").await;
    let cancel = service.cancel_install("minimal");
    tokio::pin!(cancel);
    tokio::select! {
        biased;
        result = &mut cancel => panic!("returned before launch boundary was released: {result:?}"),
        _ = tokio::task::yield_now() => {}
    }
    state.launch_gate.add_permits(1);
    assert_eq!(cancel.await, CancelResult::Cancelled);
    assert_eq!(first.await.unwrap(), InstallResult::Cancelled);
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

async fn cancel_during_stream(cleanup_failure: bool) {
    let state = State::new(1, 1);
    state.streaming.store(true, Ordering::SeqCst);
    state
        .cleanup_failure
        .store(cleanup_failure, Ordering::SeqCst);
    let service = Arc::new(service(&state));
    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.install_app("minimal", "en").await })
    };
    state.until("body-pending").await;
    let cancel = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        service.cancel_install("minimal"),
    )
    .await
    .expect("cancellation must interrupt a pending chunk");
    assert_eq!(
        cancel,
        if cleanup_failure {
            CancelResult::CleanupFailed
        } else {
            CancelResult::Cancelled
        }
    );
    assert_eq!(
        first.await.unwrap(),
        if cleanup_failure {
            InstallResult::CleanupFailed
        } else {
            InstallResult::Cancelled
        }
    );
    assert_eq!(
        state
            .events()
            .iter()
            .filter(|event| *event == "cleanup")
            .count(),
        1
    );
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(
        state.active.load(Ordering::SeqCst),
        usize::from(cleanup_failure)
    );
}

#[tokio::test]
async fn cancel_interrupts_a_pending_chunk_and_cleans_before_returning() {
    cancel_during_stream(false).await;
}

#[tokio::test]
async fn cancellation_never_reports_clean_when_workspace_cleanup_fails() {
    cancel_during_stream(true).await;
}

#[tokio::test]
async fn cancellation_after_spawn_is_too_late_and_keeps_tracking() {
    let state = State::new(0, 1);
    let service = Arc::new(service(&state));
    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.install_app("minimal", "en").await })
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
    assert!(!state.events().contains(&"cleanup".into()));
    state.first.add_permits(1);
    assert!(matches!(
        first.await.unwrap(),
        InstallResult::Installed { .. }
    ));
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unknown_cancellation_is_not_running_and_serializes_as_a_string() {
    let state = State::new(1, 1);
    let result = service(&state).cancel_install("other").await;
    assert_eq!(result, CancelResult::NotRunning);
    assert_eq!(serde_json::to_value(result).unwrap(), json!("notRunning"));
    assert!(state.events().is_empty());
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn success_orders_all_boundaries_and_reports_only_the_observed_version() {
    let state = State::new(1, 1);
    let result = service(&state).install_app("minimal", "es").await;
    assert_eq!(
        result,
        InstallResult::Installed {
            version: Some("9.2.1".into())
        }
    );
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({"status":"installed", "version":"9.2.1"})
    );
    assert_eq!(
        state.events(),
        [
            "feed",
            "detect:1.0.0",
            "approval:Minimal:1.0.0:github.com:es",
            "download",
            "network",
            "feed",
            "detect:1.0.0",
            "launch",
            "wait",
            "monitor",
            "exited",
            "detect:1.0.0",
            "cleanup"
        ]
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unknown_id_and_failed_fresh_feed_refuse_without_download_or_spawn() {
    for (id, error, expected) in [
        ("other", false, InstallResult::NotAvailable),
        ("minimal", true, InstallResult::FeedFailed),
    ] {
        let state = State::new(1, 1);
        if error {
            state
                .documents
                .lock()
                .unwrap()
                .push_back(Err(FeedError::Network));
        }
        assert_eq!(service(&state).install_app(id, "en").await, expected);
        assert_eq!(state.events(), ["feed"]);
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn initial_installed_detection_still_blocks_before_approval() {
    let state = State::new(1, 1);
    state.observe(vec![Detection::Installed { version: None }]);
    assert_eq!(
        service(&state).install_app("minimal", "en").await,
        InstallResult::AlreadyInstalled
    );
    assert_eq!(state.events(), ["feed", "detect:1.0.0"]);
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

fn without_detection_hint(state: &State) {
    let mut doc = document();
    doc["apps"][0].as_object_mut().unwrap().remove("detection");
    *state.documents.lock().unwrap() = [Ok(doc.clone()), Ok(doc)].into();
}

#[tokio::test]
async fn unknown_install_runs_the_full_transaction_and_serializes_unverified_success() {
    let state = State::new(1, 1);
    without_detection_hint(&state);
    state.observe(vec![
        Detection::Unknown,
        Detection::Unknown,
        Detection::Unknown,
    ]);
    let sink = Arc::new(Events::default());
    let result = service(&state)
        .install_app_with_progress("minimal", "es", sink.clone())
        .await;
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({"status":"installedUnverified"})
    );
    assert_eq!(
        state.events(),
        [
            "feed",
            "detect:1.0.0",
            "approval:Minimal:1.0.0:github.com:es",
            "download",
            "network",
            "feed",
            "detect:1.0.0",
            "launch",
            "wait",
            "monitor",
            "exited",
            "detect:1.0.0",
            "cleanup"
        ]
    );
    let mut phases: Vec<_> = sink
        .0
        .lock()
        .unwrap()
        .iter()
        .map(|event| event.phase)
        .collect();
    phases.dedup();
    assert_eq!(
        phases,
        [
            ProgressPhase::Fetching,
            ProgressPhase::AwaitingApproval,
            ProgressPhase::Downloading,
            ProgressPhase::Verifying,
            ProgressPhase::Installing,
            ProgressPhase::Detecting
        ]
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unknown_install_native_approval_warns_in_both_languages() {
    for (language, body) in [
        (
            "es",
            "¿Descargar e instalar Minimal, versión 1.0.0, desde github.com?\nNexo no puede comprobar si la app ya está instalada.",
        ),
        (
            "en",
            "Download and install Minimal version 1.0.0 from github.com?\nNexo cannot check whether the app is already installed.",
        ),
        (
            "fr",
            "Download and install Minimal version 1.0.0 from github.com?\nNexo cannot check whether the app is already installed.",
        ),
    ] {
        let state = State::new(1, 1);
        without_detection_hint(&state);
        state.observe(vec![
            Detection::Unknown,
            Detection::Unknown,
            Detection::Unknown,
        ]);
        let _ = service(&state).install_app("minimal", language).await;
        assert_eq!(*state.approval_bodies.lock().unwrap(), [body], "{language}");
    }
}

#[tokio::test]
async fn unknown_during_prespawn_recheck_continues_and_reports_the_fresh_observation() {
    let state = State::new(1, 1);
    state.observe(vec![
        Detection::NotInstalled,
        Detection::Unknown,
        Detection::Unknown,
        Detection::Installed {
            version: Some("9.2.1".into()),
        },
    ]);
    let result = service(&state).install_app("minimal", "en").await;
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({"status":"installed", "version":"9.2.1"})
    );
    assert_eq!(
        *state.approval_bodies.lock().unwrap(),
        [
            "Download and install Minimal version 1.0.0 from github.com?",
            "Download and install Minimal version 1.0.0 from github.com?\nNexo cannot check whether the app is already installed."
        ]
    );
    assert_eq!(
        state
            .events()
            .iter()
            .filter(|event| *event == "feed")
            .count(),
        3
    );
    assert!(state.events().contains(&"launch".into()));
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unknown_prespawn_requires_warning_approval_and_revalidates_before_launch() {
    let state = State::new(1, 1);
    state.observe(vec![Detection::NotInstalled, Detection::Unknown]);
    *state.approval_decisions.lock().unwrap() = [true, false].into();
    assert_eq!(
        service(&state).install_app("minimal", "en").await,
        InstallResult::Cancelled
    );
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert_eq!(state.active.load(Ordering::SeqCst), 0);

    let state = State::new(1, 1);
    let mut changed = document();
    changed["apps"][0]["version"] = json!("2.0.0");
    *state.documents.lock().unwrap() = [Ok(document()), Ok(document()), Ok(changed)].into();
    state.observe(vec![Detection::NotInstalled, Detection::Unknown]);
    assert_eq!(
        service(&state).install_app("minimal", "en").await,
        InstallResult::ReleaseChanged
    );
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert_eq!(state.active.load(Ordering::SeqCst), 0);

    let state = State::new(1, 1);
    state.observe(vec![
        Detection::NotInstalled,
        Detection::Unknown,
        Detection::Installed { version: None },
    ]);
    assert_eq!(
        service(&state).install_app("minimal", "en").await,
        InstallResult::AlreadyInstalled
    );
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unknown_after_exit_is_unverified_even_if_initial_detection_was_known() {
    let state = State::new(1, 1);
    state.observe(vec![
        Detection::NotInstalled,
        Detection::NotInstalled,
        Detection::Unknown,
    ]);
    let result = service(&state).install_app("minimal", "en").await;
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({"status":"installedUnverified"})
    );
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unknown_initial_detection_defers_to_known_post_exit_observations() {
    for (last, expected) in [
        (Detection::NotInstalled, json!({"status":"notDetected"})),
        (
            Detection::Installed {
                version: Some("9.2.1".into()),
            },
            json!({"status":"installed", "version":"9.2.1"}),
        ),
    ] {
        let state = State::new(1, 1);
        without_detection_hint(&state);
        state.observe(vec![Detection::Unknown, Detection::Unknown, last]);
        assert_eq!(
            serde_json::to_value(service(&state).install_app("minimal", "en").await).unwrap(),
            expected
        );
        assert!(state.events().contains(&"launch".into()));
        assert_eq!(state.events().last().unwrap(), "cleanup");
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn unknown_install_keeps_approval_signature_and_revalidation_gates() {
    let state = State::new(1, 1);
    without_detection_hint(&state);
    state.observe(vec![Detection::Unknown]);
    state.approved.store(false, Ordering::SeqCst);
    assert_eq!(
        service(&state).install_app("minimal", "en").await,
        InstallResult::Cancelled
    );
    assert!(!state.events().contains(&"download".into()));
    assert_eq!(state.active.load(Ordering::SeqCst), 0);

    let state = State::new(1, 1);
    without_detection_hint(&state);
    state.observe(vec![Detection::Unknown]);
    *state.prepare_error.lock().unwrap() = Some(PrepareError {
        cause: PrepareFailure::Verify(VerifyError::VerificationFailed),
        cleanup_failed: false,
    });
    assert_eq!(
        serde_json::to_value(service(&state).install_app("minimal", "en").await).unwrap(),
        json!({"status":"signatureInvalid"})
    );
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.active.load(Ordering::SeqCst), 0);

    let state = State::new(1, 1);
    without_detection_hint(&state);
    state.observe(vec![
        Detection::Unknown,
        Detection::Installed { version: None },
    ]);
    assert_eq!(
        service(&state).install_app("minimal", "en").await,
        InstallResult::AlreadyInstalled
    );
    assert!(!state.events().contains(&"launch".into()));
    assert_eq!(state.events().last().unwrap(), "cleanup");
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn unknown_install_preserves_single_flight_and_post_spawn_cancellation() {
    let state = State::new(0, 1);
    without_detection_hint(&state);
    state.observe(vec![
        Detection::Unknown,
        Detection::Unknown,
        Detection::Unknown,
    ]);
    let service = Arc::new(service(&state));
    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.install_app("minimal", "en").await })
    };
    state.until("wait").await;
    assert_eq!(
        service.install_app("minimal", "en").await,
        InstallResult::Busy
    );
    assert_eq!(
        service.cancel_install("minimal").await,
        CancelResult::TooLate
    );
    state.first.add_permits(1);
    assert_eq!(
        serde_json::to_value(first.await.unwrap()).unwrap(),
        json!({"status":"installedUnverified"})
    );
    assert_eq!(
        state
            .events()
            .iter()
            .filter(|event| *event == "launch")
            .count(),
        1
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn denied_or_dismissed_native_approval_never_downloads() {
    let state = State::new(1, 1);
    state.approved.store(false, Ordering::SeqCst);
    assert_eq!(
        service(&state).install_app("minimal", "en").await,
        InstallResult::Cancelled
    );
    assert_eq!(
        state.events(),
        [
            "feed",
            "detect:1.0.0",
            "approval:Minimal:1.0.0:github.com:en"
        ]
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
    assert_eq!(
        serde_json::to_value(InstallResult::Cancelled).unwrap(),
        json!({"status":"cancelled"})
    );
}

#[tokio::test]
async fn changed_release_key_detection_or_removed_entry_aborts_and_cleans() {
    let mut changed_url = document();
    changed_url["apps"][0]["installerUrl"] =
        json!("https://github.com/egdev6/example/releases/download/v2/example_x64-setup.exe");
    let mut changed_version = document();
    changed_version["apps"][0]["version"] = json!("2.0.0");
    let mut changed_key = document();
    changed_key["apps"][0]["updaterPublicKey"] =
        json!(STANDARD.encode(include_str!("../tests/fixtures/minisign-test.pub")));
    let mut changed_detection = document();
    changed_detection["apps"][0]["detection"]["windows"]["publisher"] = json!("Other");
    let mut removed = document();
    removed["apps"] = json!([]);
    for changed in [
        changed_url,
        changed_version,
        changed_key,
        changed_detection,
        removed,
    ] {
        let state = State::new(1, 1);
        *state.documents.lock().unwrap() = [Ok(document()), Ok(changed)].into();
        assert_eq!(
            service(&state).install_app("minimal", "en").await,
            InstallResult::ReleaseChanged
        );
        assert_eq!(
            state.events(),
            [
                "feed",
                "detect:1.0.0",
                "approval:Minimal:1.0.0:github.com:en",
                "download",
                "network",
                "feed",
                "cleanup"
            ]
        );
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
    let state = State::new(1, 1);
    *state.documents.lock().unwrap() = [Ok(document()), Err(FeedError::Network)].into();
    assert_eq!(
        service(&state).install_app("minimal", "en").await,
        InstallResult::FeedFailed
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
    assert!(!state.events().contains(&"launch".into()));
}

#[tokio::test]
async fn second_installed_detection_refuses_and_reports_cleanup_failure() {
    for (detection, expected, cleanup_failure) in [
        (
            Detection::Installed { version: None },
            InstallResult::AlreadyInstalled,
            false,
        ),
        (
            Detection::Installed { version: None },
            InstallResult::CleanupFailed,
            true,
        ),
    ] {
        let state = State::new(1, 1);
        state
            .cleanup_failure
            .store(cleanup_failure, Ordering::SeqCst);
        state.observe(vec![Detection::NotInstalled, detection]);
        assert_eq!(service(&state).install_app("minimal", "en").await, expected);
        assert!(!state.events().contains(&"launch".into()));
        assert_eq!(state.events().last().unwrap(), "cleanup");
        assert_eq!(
            state.active.load(Ordering::SeqCst),
            usize::from(cleanup_failure)
        );
    }
}

#[tokio::test]
async fn prepare_and_spawn_errors_preserve_explicit_cleanup_failure() {
    for cleanup_failed in [false, true] {
        let state = State::new(1, 1);
        *state.prepare_error.lock().unwrap() = Some(PrepareError {
            cause: PrepareFailure::Storage,
            cleanup_failed,
        });
        assert_eq!(
            serde_json::to_value(service(&state).install_app("minimal", "en").await).unwrap(),
            json!({"status": if cleanup_failed { "cleanupFailed" } else { "storageFailed" }})
        );
        assert!(!state.events().contains(&"launch".into()));
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
    for cleanup_failure in [false, true] {
        let state = State::new(1, 1);
        state
            .cleanup_failure
            .store(cleanup_failure, Ordering::SeqCst);
        *state.launch_error.lock().unwrap() = Some(LaunchError::Spawn);
        assert_eq!(
            service(&state).install_app("minimal", "en").await,
            if cleanup_failure {
                InstallResult::CleanupFailed
            } else {
                InstallResult::SpawnFailed
            }
        );
        assert_eq!(state.events().last().unwrap(), "cleanup");
        assert_eq!(
            state.active.load(Ordering::SeqCst),
            usize::from(cleanup_failure)
        );
    }
}

#[tokio::test]
async fn prepare_failures_return_stable_specific_statuses_and_never_spawn() {
    use install_download::Failure;
    let cases = [
        (
            PrepareFailure::Download(Failure::InitialUrl),
            "urlNotAllowed",
        ),
        (
            PrepareFailure::Download(Failure::RedirectUrl),
            "hostNotAllowed",
        ),
        (
            PrepareFailure::Download(Failure::RedirectLimit),
            "redirectLimit",
        ),
        (PrepareFailure::Download(Failure::Network), "networkFailed"),
        (
            PrepareFailure::Download(Failure::ConnectTimeout),
            "connectTimedOut",
        ),
        (
            PrepareFailure::Download(Failure::DownloadTimeout),
            "downloadTimedOut",
        ),
        (PrepareFailure::Download(Failure::SizeLimit), "tooLarge"),
        (
            PrepareFailure::Download(Failure::LengthMismatch),
            "lengthMismatch",
        ),
        (PrepareFailure::Download(Failure::Storage), "storageFailed"),
        (
            PrepareFailure::Verify(VerifyError::MissingKey),
            "keyMissing",
        ),
        (
            PrepareFailure::Verify(VerifyError::MalformedKey),
            "keyInvalid",
        ),
        (
            PrepareFailure::Verify(VerifyError::MalformedSignature),
            "signatureMalformed",
        ),
        (
            PrepareFailure::Verify(VerifyError::LegacySignature),
            "signatureUnsupported",
        ),
        (
            PrepareFailure::Verify(VerifyError::VerificationFailed),
            "signatureInvalid",
        ),
        (
            PrepareFailure::Verify(VerifyError::ReadFailed),
            "storageFailed",
        ),
        (PrepareFailure::UnsupportedInstaller, "assetNotAllowed"),
        (PrepareFailure::Storage, "storageFailed"),
    ];
    for (cause, status) in cases {
        for cleanup_failed in [false, true] {
            let state = State::new(1, 1);
            *state.prepare_error.lock().unwrap() = Some(PrepareError {
                cause,
                cleanup_failed,
            });
            let result = service(&state).install_app("minimal", "en").await;
            assert_eq!(
                serde_json::to_value(result).unwrap(),
                json!({"status": if cleanup_failed { "cleanupFailed" } else { status }}),
                "{cause:?}"
            );
            assert!(!state.events().contains(&"launch".into()));
            assert_eq!(state.active.load(Ordering::SeqCst), 0);
        }
    }
}

#[tokio::test]
async fn cleanup_failure_after_process_exit_is_returned_even_after_success() {
    for outcome in [Ok(()), Err(LaunchError::Exit(42))] {
        let state = State::new(1, 1);
        state.cleanup_failure.store(true, Ordering::SeqCst);
        *state.outcome.lock().unwrap() = outcome;
        let result = service(&state).install_app("minimal", "en").await;
        assert_eq!(
            serde_json::to_value(result).unwrap(),
            json!({"status":"cleanupFailed"})
        );
        let events = state.events();
        assert!(
            events.iter().position(|event| event == "exited")
                < events.iter().position(|event| event == "cleanup")
        );
        assert_eq!(state.active.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn late_cleanup_failure_after_timeout_or_wait_error_is_emitted() {
    for (outcome, expected) in [
        (LaunchError::Timeout, InstallResult::Timeout),
        (LaunchError::Wait, InstallResult::MonitorFailed),
    ] {
        for cleanup_failure in [false, true] {
            let state = State::new(1, 0);
            state
                .cleanup_failure
                .store(cleanup_failure, Ordering::SeqCst);
            *state.outcome.lock().unwrap() = Err(outcome);
            let sink = Arc::new(Events::default());
            let service = service(&state);
            assert_eq!(
                service
                    .install_app_with_progress("minimal", "en", sink.clone())
                    .await,
                expected
            );
            state.until("monitor").await;
            assert_eq!(state.active.load(Ordering::SeqCst), 1);
            assert!(!state.events().contains(&"cleanup".into()));
            state.exited.add_permits(1);
            state.until("cleanup").await;
            // Wait for the post-exit flow to finish: the warning when cleanup fails,
            // otherwise the release of the per-app claim. Bounded by wall-clock time.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while std::time::Instant::now() < deadline {
                let warned = sink.0.lock().unwrap().iter().any(|event| {
                    serde_json::to_value(event).unwrap().get("cleanupFailed") == Some(&json!(true))
                });
                let released = state.active.load(Ordering::SeqCst) == 0;
                if (cleanup_failure && warned) || (!cleanup_failure && released) {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(1)).await;
            }
            let warnings: Vec<_> = sink
                .0
                .lock()
                .unwrap()
                .iter()
                .map(|event| serde_json::to_value(event).unwrap())
                .filter(|event| event.get("cleanupFailed") == Some(&json!(true)))
                .collect();
            if cleanup_failure {
                assert_eq!(
                    warnings,
                    [json!({"id":"minimal", "phase":"installing", "cleanupFailed":true})]
                );
            } else {
                assert!(warnings.is_empty());
            }
            assert_eq!(
                state.active.load(Ordering::SeqCst),
                usize::from(cleanup_failure)
            );
        }
    }
}

#[tokio::test]
async fn exit_zero_reports_known_absence_and_nonzero_is_reported() {
    let state = State::new(1, 1);
    state.observe(vec![
        Detection::NotInstalled,
        Detection::NotInstalled,
        Detection::NotInstalled,
    ]);
    assert_eq!(
        service(&state).install_app("minimal", "en").await,
        InstallResult::NotDetected
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
    let state = State::new(1, 1);
    *state.outcome.lock().unwrap() = Err(LaunchError::Exit(42));
    let result = service(&state).install_app("minimal", "en").await;
    assert_eq!(result, InstallResult::InstallerFailed { code: 42 });
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({"status":"installerFailed", "code":42})
    );
    assert_eq!(
        state
            .events()
            .iter()
            .filter(|event| event.starts_with("detect:"))
            .count(),
        2
    );
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn concurrent_calls_are_busy_until_the_installer_exits() {
    let state = State::new(0, 1);
    let service = Arc::new(service(&state));
    let first = {
        let service = service.clone();
        tokio::spawn(async move { service.install_app("minimal", "en").await })
    };
    state.until("wait").await;
    assert_eq!(
        service.install_app("minimal", "en").await,
        InstallResult::Busy
    );
    assert_eq!(
        state
            .events()
            .iter()
            .filter(|event| *event == "launch")
            .count(),
        1
    );
    state.first.add_permits(1);
    assert!(matches!(
        first.await.unwrap(),
        InstallResult::Installed { .. }
    ));
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn timeout_never_kills_and_retains_the_claim_until_monitor_exit() {
    let state = State::new(1, 0);
    *state.outcome.lock().unwrap() = Err(LaunchError::Timeout);
    let service = service(&state);
    assert_eq!(
        service.install_app("minimal", "en").await,
        InstallResult::Timeout
    );
    state.until("monitor").await;
    assert_eq!(state.active.load(Ordering::SeqCst), 1);
    assert_eq!(
        service.install_app("minimal", "en").await,
        InstallResult::Busy
    );
    assert!(!state.events().contains(&"cleanup".into()));
    state.exited.add_permits(1);
    state.until("cleanup").await;
    assert_eq!(state.active.load(Ordering::SeqCst), 0);
    state.observe(vec![Detection::Installed { version: None }]);
    assert_eq!(
        service.install_app("minimal", "en").await,
        InstallResult::AlreadyInstalled
    );
    assert_eq!(
        state
            .events()
            .iter()
            .filter(|event| *event == "launch")
            .count(),
        1
    );
}
