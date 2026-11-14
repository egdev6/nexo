use crate::install_approval::{ApprovalDecision, ApprovalRequest, InstallApproval};
use crate::install_download::{Body, Network, NetworkError, Response, ResponseKind};
use crate::install_feed::{CatalogFeed, FeedError, FreshCatalog, NativeFeed};
use crate::install_launcher::LaunchError;
use crate::install_service::{
    Detection, InstallDetector, InstallLauncher, InstallResult, InstallService, InstallWorkspace,
    Installer, Monitor,
};
use crate::install_workspace::{PrepareError, PrepareFailure};
use base64::{Engine, engine::general_purpose::STANDARD};
use nexo_catalog::CatalogApp;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
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
    documents: Mutex<VecDeque<Result<Value, FeedError>>>,
    observations: Mutex<VecDeque<Detection>>,
    approved: AtomicBool,
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
    async fn until(&self, event: &str) {
        for _ in 0..10_000 {
            if self.events().iter().any(|seen| seen == event) {
                return;
            }
            tokio::task::yield_now().await;
        }
        panic!("missing event {event}: {:?}", self.events());
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
impl Network for FakeNetwork {
    type Body = FakeBody;
    async fn get(&self, url: &str) -> Result<Response<Self::Body>, NetworkError> {
        self.0.log("network");
        Ok(Response {
            effective_url: url.into(),
            kind: ResponseKind::Failed,
        })
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
        network: &FakeNetwork,
        app: &CatalogApp,
    ) -> Result<Verified, PrepareError> {
        self.0.log("download");
        let _ = network.get(&app.installer_url).await;
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
        self.0.log(format!(
            "approval:{}:{}:{}:{}",
            request.app_name, request.version, request.publisher_host, request.language
        ));
        if self.0.approved.load(Ordering::SeqCst) {
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
    async fn launch(&self, _: &Verified) -> Result<Running, LaunchError> {
        self.0.log("launch");
        if let Some(error) = *self.0.launch_error.lock().unwrap() {
            Err(error)
        } else {
            Ok(Running(self.0.clone()))
        }
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
async fn initial_detection_blocks_installed_and_unknown_before_approval() {
    for (detection, expected) in [
        (
            Detection::Installed { version: None },
            InstallResult::AlreadyInstalled,
        ),
        (Detection::Unknown, InstallResult::DetectionUnknown),
    ] {
        let state = State::new(1, 1);
        state.observe(vec![detection]);
        assert_eq!(service(&state).install_app("minimal", "en").await, expected);
        assert_eq!(state.events(), ["feed", "detect:1.0.0"]);
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
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
async fn second_detection_refuses_installed_or_unknown_and_reports_cleanup_failure() {
    for (detection, expected, cleanup_failure) in [
        (
            Detection::Installed { version: None },
            InstallResult::AlreadyInstalled,
            false,
        ),
        (Detection::Unknown, InstallResult::DetectionUnknown, false),
        (Detection::Unknown, InstallResult::CleanupFailed, true),
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
            service(&state).install_app("minimal", "en").await,
            if cleanup_failed {
                InstallResult::CleanupFailed
            } else {
                InstallResult::DownloadFailed
            }
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
async fn exit_zero_requires_fresh_installed_observation_and_nonzero_is_reported() {
    for detection in [Detection::NotInstalled, Detection::Unknown] {
        let state = State::new(1, 1);
        state.observe(vec![
            Detection::NotInstalled,
            Detection::NotInstalled,
            detection,
        ]);
        assert_eq!(
            service(&state).install_app("minimal", "en").await,
            InstallResult::NotDetected
        );
        assert_eq!(state.active.load(Ordering::SeqCst), 0);
    }
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
