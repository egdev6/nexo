//! Composition of the native installation boundaries.
use crate::install_approval::{ApprovalDecision, ApprovalRequest, InstallApproval};
use crate::install_download::{
    Artifact, Body, Failure, Network, NetworkError, Progress, Response, ResponseKind,
};
use crate::install_feed::{CatalogFeed, FreshCatalog};
use crate::install_launcher::LaunchError;
use crate::install_signature::VerifyError;
use crate::install_workspace::{PrepareError, PrepareFailure};
use nexo_catalog::CatalogApp;
use std::{
    collections::HashMap,
    future::Future,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::{oneshot, watch};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Detection {
    Installed { version: Option<String> },
    NotInstalled,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum UpdateDetection {
    Installed {
        version: Option<String>,
        executable: std::path::PathBuf,
    },
    NotInstalled,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum InstallResult {
    Installed { version: Option<String> },
    Updated { version: String },
    UpToDate { version: String },
    VersionMismatch { version: String },
    AppStillRunning,
    AlreadyInstalled,
    Busy,
    Cancelled,
    FeedFailed,
    NotAvailable,
    DetectionUnknown,
    ReleaseChanged,
    UrlNotAllowed,
    HostNotAllowed,
    RedirectLimit,
    NetworkFailed,
    ConnectTimedOut,
    DownloadTimedOut,
    TooLarge,
    LengthMismatch,
    StorageFailed,
    KeyMissing,
    KeyInvalid,
    SignatureMalformed,
    SignatureUnsupported,
    SignatureInvalid,
    AssetNotAllowed,
    CleanupFailed,
    SpawnFailed,
    MonitorFailed,
    InstallerFailed { code: i32 },
    Timeout,
    NotDetected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProgressPhase {
    Fetching,
    AwaitingApproval,
    Downloading,
    Verifying,
    Closing,
    Installing,
    Detecting,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct InstallProgress {
    pub id: String,
    pub phase: ProgressPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(rename = "cleanupFailed", skip_serializing_if = "Option::is_none")]
    pub cleanup_failed: Option<bool>,
}

pub(crate) trait ProgressSink: Send + Sync {
    fn emit(&self, progress: InstallProgress);
}

struct ProgressState {
    phase: Option<ProgressPhase>,
    last_bytes: Option<Instant>,
}
pub(crate) struct ProgressReporter {
    id: String,
    sink: Arc<dyn ProgressSink>,
    state: Mutex<ProgressState>,
}
impl ProgressReporter {
    fn new(id: &str, sink: Arc<dyn ProgressSink>) -> Self {
        Self {
            id: id.into(),
            sink,
            state: Mutex::new(ProgressState {
                phase: None,
                last_bytes: None,
            }),
        }
    }
    pub fn phase(&self, phase: ProgressPhase) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if state.phase == Some(phase) {
            return;
        }
        state.phase = Some(phase);
        drop(state);
        self.sink.emit(InstallProgress {
            id: self.id.clone(),
            phase,
            received: None,
            total: None,
            cleanup_failed: None,
        });
    }
    fn cleanup_failed(&self) {
        self.sink.emit(InstallProgress {
            id: self.id.clone(),
            phase: ProgressPhase::Installing,
            received: None,
            total: None,
            cleanup_failed: Some(true),
        });
    }
    pub fn download(&self, progress: Progress) {
        // Signature bytes are a different artifact, not a continuation of installer bytes.
        if progress.artifact != Artifact::Installer {
            return;
        }
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = Instant::now();
        if state.phase != Some(ProgressPhase::Downloading)
            || state
                .last_bytes
                .is_some_and(|last| now.duration_since(last) < Duration::from_millis(100))
        {
            return;
        }
        state.last_bytes = Some(now);
        drop(state);
        self.sink.emit(InstallProgress {
            id: self.id.clone(),
            phase: ProgressPhase::Downloading,
            received: Some(progress.bytes),
            total: progress.total,
            cleanup_failed: None,
        });
    }
}

#[cfg(test)]
struct NoProgress;
#[cfg(test)]
impl ProgressSink for NoProgress {
    fn emit(&self, _: InstallProgress) {}
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CancelResult {
    Cancelled,
    TooLate,
    NotRunning,
    CleanupFailed,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum OperationState {
    Pending,
    Cancelling,
    Spawned,
    Finished,
}

pub(crate) struct Operation {
    state: Mutex<OperationState>,
    cancelled: watch::Sender<bool>,
    finished: watch::Sender<Option<InstallResult>>,
    update: bool,
    spawn_check: Mutex<Option<Box<dyn Fn() -> bool + Send + Sync>>>,
    spawn_rejected: AtomicBool,
}
impl Operation {
    fn new(update: bool) -> Self {
        Self {
            state: Mutex::new(OperationState::Pending),
            cancelled: watch::channel(false).0,
            finished: watch::channel(None).0,
            update,
            spawn_check: Mutex::new(None),
            spawn_rejected: AtomicBool::new(false),
        }
    }
    fn set_spawn_check(&self, check: impl Fn() -> bool + Send + Sync + 'static) {
        *self
            .spawn_check
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(Box::new(check));
    }
    fn is_cancelled(&self) -> bool {
        *self.cancelled.borrow()
    }
    async fn cancelled(&self) {
        let mut receiver = self.cancelled.subscribe();
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                break;
            }
        }
    }
    // The lock spans the actual OS spawn, so cancellation and successful process creation
    // have one ordering even when the launcher's monitor thread races the command.
    pub fn spawn<T, E>(&self, run: impl FnOnce() -> Result<T, E>) -> Option<Result<T, E>> {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *state != OperationState::Pending {
            return None;
        }
        if self
            .spawn_check
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .is_some_and(|check| !check())
        {
            self.spawn_rejected.store(true, Ordering::SeqCst);
            return None;
        }
        let result = run();
        if result.is_ok() {
            *state = OperationState::Spawned;
        }
        Some(result)
    }
    fn finish(&self, mut result: InstallResult) -> InstallResult {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *state == OperationState::Cancelling && result != InstallResult::CleanupFailed {
            result = InstallResult::Cancelled;
        }
        *state = OperationState::Finished;
        self.finished.send_replace(Some(result.clone()));
        result
    }
    async fn cancel(&self) -> CancelResult {
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match *state {
                OperationState::Pending => {
                    *state = OperationState::Cancelling;
                    self.cancelled.send_replace(true);
                }
                OperationState::Cancelling => {}
                OperationState::Spawned => return CancelResult::TooLate,
                OperationState::Finished => return CancelResult::NotRunning,
            }
        }
        let mut finished = self.finished.subscribe();
        loop {
            if let Some(result) = finished.borrow_and_update().clone() {
                return if result == InstallResult::CleanupFailed {
                    CancelResult::CleanupFailed
                } else {
                    CancelResult::Cancelled
                };
            }
            if finished.changed().await.is_err() {
                return CancelResult::CleanupFailed;
            }
        }
    }
}

/// Interrupt network waits without dropping the download future: its explicit error path
/// must run so a failed cleanup can be reported to both callers.
pub(crate) struct CancellableNetwork<'a, N> {
    network: &'a N,
    operation: Arc<Operation>,
    progress: Arc<ProgressReporter>,
    signature: AtomicBool,
}
pub(crate) struct CancellableBody<B> {
    body: B,
    operation: Arc<Operation>,
    progress: Arc<ProgressReporter>,
    signature: bool,
    received: u64,
    total: Option<u64>,
}
impl<B: Body> Body for CancellableBody<B> {
    async fn next(&mut self) -> Result<Option<Vec<u8>>, NetworkError> {
        let chunk = tokio::select! {
            biased;
            _ = self.operation.cancelled() => return Err(NetworkError),
            result = self.body.next() => result?,
        };
        if let Some(bytes) = &chunk {
            self.received = self.received.saturating_add(bytes.len() as u64);
        } else if self.signature
            && self.received > 0
            && self.received <= crate::install_download::SIGNATURE_LIMIT
            && self.total.is_none_or(|total| total == self.received)
        {
            self.progress.phase(ProgressPhase::Verifying);
        }
        Ok(chunk)
    }
}
impl<N: Network> Network for CancellableNetwork<'_, N> {
    type Body = CancellableBody<N::Body>;
    async fn get(&self, url: &str) -> Result<Response<Self::Body>, NetworkError> {
        if url.ends_with(".sig") {
            self.signature.store(true, Ordering::SeqCst);
        }
        let response = tokio::select! {
            biased;
            _ = self.operation.cancelled() => return Err(NetworkError),
            result = self.network.get(url) => result?,
        };
        let kind = match response.kind {
            ResponseKind::Ok { length, body } => ResponseKind::Ok {
                length,
                body: CancellableBody {
                    body,
                    operation: self.operation.clone(),
                    progress: self.progress.clone(),
                    signature: self.signature.load(Ordering::SeqCst),
                    received: 0,
                    total: length,
                },
            },
            ResponseKind::Redirect(location) => ResponseKind::Redirect(location),
            ResponseKind::Failed => ResponseKind::Failed,
        };
        Ok(Response {
            effective_url: response.effective_url,
            kind,
        })
    }
}

pub(crate) trait Installer: Send {
    fn cleanup(self) -> Result<(), ()>;
}
pub(crate) trait InstallWorkspace<N: Network>: Send + Sync {
    type Installer: Installer + 'static;
    fn prepare(
        &self,
        network: &CancellableNetwork<'_, N>,
        app: &CatalogApp,
        progress: &ProgressReporter,
    ) -> impl Future<Output = Result<Self::Installer, PrepareError>> + Send;
}
pub(crate) trait InstallDetector: Send + Sync {
    fn detect(
        &self,
        catalog: &FreshCatalog,
        app: &CatalogApp,
    ) -> impl Future<Output = Detection> + Send;

    fn detect_update(
        &self,
        _catalog: &FreshCatalog,
        _app: &CatalogApp,
    ) -> impl Future<Output = UpdateDetection> + Send {
        async { UpdateDetection::Unknown }
    }
}

pub(crate) trait UpdateCloser: Send + Sync {
    fn close(
        &self,
        id: &str,
        executable: &std::path::Path,
    ) -> impl Future<Output = crate::update_close::CloseOutcome> + Send;
    fn is_running(
        &self,
        executable: &std::path::Path,
    ) -> Result<bool, crate::update_close::ProbeError>;
}
pub(crate) trait Monitor: Send {
    fn wait(&mut self) -> impl Future<Output = Result<(), LaunchError>> + Send;
    fn wait_until_exit(self) -> impl Future<Output = Result<(), LaunchError>> + Send;
}
pub(crate) trait InstallLauncher<I: Installer>: Send + Sync {
    type Running: Monitor + 'static;
    fn launch(
        &self,
        installer: &I,
        operation: Arc<Operation>,
    ) -> impl Future<Output = Result<Self::Running, LaunchError>> + Send;
}

#[derive(Default)]
struct ClaimState {
    operations: HashMap<String, Arc<Operation>>,
    openings: HashMap<String, usize>,
}
type Claims = Arc<Mutex<ClaimState>>;
struct Boundaries<F, N, W, A, L, D> {
    feed: F,
    network: N,
    workspace: W,
    approval: A,
    launcher: L,
    detector: D,
    claims: Claims,
}

struct Claim {
    id: String,
    claims: Claims,
}
impl Drop for Claim {
    fn drop(&mut self) {
        self.claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .operations
            .remove(&self.id);
    }
}

pub(crate) struct OpenClaim {
    id: String,
    claims: Claims,
}
impl Drop for OpenClaim {
    fn drop(&mut self) {
        let mut state = self
            .claims
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some(count) = state.openings.get_mut(&self.id) {
            *count -= 1;
            if *count == 0 {
                state.openings.remove(&self.id);
            }
        }
    }
}

struct NoUpdateCloser;
impl UpdateCloser for NoUpdateCloser {
    async fn close(&self, _: &str, _: &std::path::Path) -> crate::update_close::CloseOutcome {
        crate::update_close::CloseOutcome::StillRunning
    }
    fn is_running(&self, _: &std::path::Path) -> Result<bool, crate::update_close::ProbeError> {
        Err(crate::update_close::ProbeError::Unsupported)
    }
}

pub(crate) struct InstallService<F, N, W, A, L, D> {
    boundaries: Arc<Boundaries<F, N, W, A, L, D>>,
}

impl<F, N, W, A, L, D> InstallService<F, N, W, A, L, D>
where
    F: CatalogFeed + Send + 'static,
    N: Network + Send + 'static,
    W: InstallWorkspace<N> + 'static,
    A: InstallApproval + Send + Sync + 'static,
    L: InstallLauncher<W::Installer> + 'static,
    D: InstallDetector + 'static,
{
    pub(crate) fn new(
        feed: F,
        network: N,
        workspace: W,
        approval: A,
        launcher: L,
        detector: D,
    ) -> Self {
        Self {
            boundaries: Arc::new(Boundaries {
                feed,
                network,
                workspace,
                approval,
                launcher,
                detector,
                claims: Arc::new(Mutex::new(ClaimState::default())),
            }),
        }
    }

    #[cfg(test)]
    pub(crate) async fn install_app(&self, id: &str, language: &str) -> InstallResult {
        self.install_app_with_progress(id, language, Arc::new(NoProgress))
            .await
    }

    pub(crate) async fn cancel_install(&self, id: &str) -> CancelResult {
        let operation = self
            .boundaries
            .claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .operations
            .get(id)
            .cloned();
        match operation {
            Some(operation) => operation.cancel().await,
            None => CancelResult::NotRunning,
        }
    }

    pub(crate) fn begin_open(&self, id: &str) -> Option<OpenClaim> {
        let claims = self.boundaries.claims.clone();
        {
            let mut state = claims.lock().ok()?;
            if state
                .operations
                .get(id)
                .is_some_and(|operation| operation.update)
            {
                return None;
            }
            *state.openings.entry(id.to_owned()).or_default() += 1;
        }
        Some(OpenClaim {
            id: id.into(),
            claims,
        })
    }

    #[cfg(test)]
    pub(crate) async fn update_app<C: UpdateCloser + 'static>(
        &self,
        id: &str,
        language: &str,
        closer: Arc<C>,
    ) -> InstallResult {
        self.update_app_with_progress(id, language, Arc::new(NoProgress), closer)
            .await
    }

    pub(crate) async fn update_app_with_progress<C: UpdateCloser + 'static>(
        &self,
        id: &str,
        language: &str,
        sink: Arc<dyn ProgressSink>,
        closer: Arc<C>,
    ) -> InstallResult {
        self.run_with_progress(id, language, sink, Some(closer))
            .await
    }

    pub(crate) async fn install_app_with_progress(
        &self,
        id: &str,
        language: &str,
        sink: Arc<dyn ProgressSink>,
    ) -> InstallResult {
        self.run_with_progress(id, language, sink, None::<Arc<NoUpdateCloser>>)
            .await
    }

    async fn run_with_progress<C: UpdateCloser + 'static>(
        &self,
        id: &str,
        language: &str,
        sink: Arc<dyn ProgressSink>,
        closer: Option<Arc<C>>,
    ) -> InstallResult {
        let claims = self.boundaries.claims.clone();
        let operation = Arc::new(Operation::new(closer.is_some()));
        {
            let Ok(mut active) = claims.lock() else {
                return InstallResult::Busy;
            };
            if active.operations.contains_key(id)
                || (closer.is_some() && active.openings.contains_key(id))
            {
                return InstallResult::Busy;
            }
            active.operations.insert(id.to_owned(), operation.clone());
        }
        let claim = Claim {
            id: id.into(),
            claims,
        };
        let progress = Arc::new(ProgressReporter::new(id, sink));
        let boundaries = self.boundaries.clone();
        let id = id.to_owned();
        let language = language.to_owned();
        let (sender, receiver) = oneshot::channel();
        tokio::spawn(async move {
            let mut sender = Some(sender);
            let result = transaction(
                boundaries,
                &id,
                &language,
                &mut sender,
                &operation,
                progress,
                closer,
            )
            .await;
            let result = operation.finish(result);
            drop(claim);
            if let Some(sender) = sender {
                let _ = sender.send(result);
            } else if result == InstallResult::CleanupFailed {
                eprintln!("Could not clean the temporary installer workspace");
            }
        });
        receiver.await.unwrap_or(InstallResult::MonitorFailed)
    }
}

fn prepare_failure(error: PrepareError) -> InstallResult {
    if error.cleanup_failed {
        return InstallResult::CleanupFailed;
    }
    match error.cause {
        PrepareFailure::Download(Failure::InitialUrl) => InstallResult::UrlNotAllowed,
        PrepareFailure::Download(Failure::RedirectUrl) => InstallResult::HostNotAllowed,
        PrepareFailure::Download(Failure::RedirectLimit) => InstallResult::RedirectLimit,
        PrepareFailure::Download(Failure::Network) => InstallResult::NetworkFailed,
        PrepareFailure::Download(Failure::ConnectTimeout) => InstallResult::ConnectTimedOut,
        PrepareFailure::Download(Failure::DownloadTimeout) => InstallResult::DownloadTimedOut,
        PrepareFailure::Download(Failure::SizeLimit) => InstallResult::TooLarge,
        PrepareFailure::Download(Failure::LengthMismatch) => InstallResult::LengthMismatch,
        PrepareFailure::Download(Failure::Storage)
        | PrepareFailure::Verify(VerifyError::ReadFailed)
        | PrepareFailure::Storage => InstallResult::StorageFailed,
        PrepareFailure::Verify(VerifyError::MissingKey) => InstallResult::KeyMissing,
        PrepareFailure::Verify(VerifyError::MalformedKey) => InstallResult::KeyInvalid,
        PrepareFailure::Verify(VerifyError::MalformedSignature) => {
            InstallResult::SignatureMalformed
        }
        PrepareFailure::Verify(VerifyError::LegacySignature) => InstallResult::SignatureUnsupported,
        PrepareFailure::Verify(VerifyError::VerificationFailed) => InstallResult::SignatureInvalid,
        PrepareFailure::UnsupportedInstaller => InstallResult::AssetNotAllowed,
    }
}

fn cleanup<I: Installer>(installer: I, result: InstallResult) -> InstallResult {
    if installer.cleanup().is_err() {
        InstallResult::CleanupFailed
    } else {
        result
    }
}

fn cancelled(sender: &Option<oneshot::Sender<InstallResult>>, operation: &Operation) -> bool {
    operation.is_cancelled() || sender.as_ref().is_none_or(oneshot::Sender::is_closed)
}

#[derive(Clone)]
struct UpdateInfo {
    version: String,
    executable: std::path::PathBuf,
}

fn check_update(
    detection: UpdateDetection,
    target: &semver::Version,
    previous: Option<&UpdateInfo>,
) -> Result<UpdateInfo, InstallResult> {
    let UpdateDetection::Installed {
        version: Some(version),
        executable,
    } = detection
    else {
        return Err(InstallResult::DetectionUnknown);
    };
    let parsed = semver::Version::parse(&version).map_err(|_| InstallResult::DetectionUnknown)?;
    if parsed.cmp_precedence(target) != std::cmp::Ordering::Less {
        return Err(InstallResult::UpToDate { version });
    }
    let info = UpdateInfo {
        version,
        executable,
    };
    if previous.is_some_and(|old| old.version != info.version || old.executable != info.executable)
    {
        return Err(InstallResult::ReleaseChanged);
    }
    Ok(info)
}

async fn transaction<F, N, W, A, L, D, C>(
    boundaries: Arc<Boundaries<F, N, W, A, L, D>>,
    id: &str,
    language: &str,
    sender: &mut Option<oneshot::Sender<InstallResult>>,
    operation: &Arc<Operation>,
    progress: Arc<ProgressReporter>,
    closer: Option<Arc<C>>,
) -> InstallResult
where
    F: CatalogFeed + Send + 'static,
    N: Network + Send + 'static,
    W: InstallWorkspace<N> + 'static,
    A: InstallApproval + Send + Sync + 'static,
    L: InstallLauncher<W::Installer> + 'static,
    D: InstallDetector + 'static,
    C: UpdateCloser + 'static,
{
    progress.phase(ProgressPhase::Fetching);
    let catalog = tokio::select! {
        biased;
        _ = operation.cancelled() => return InstallResult::Cancelled,
        result = boundaries.feed.fetch() => match result {
            Ok(catalog) => catalog,
            Err(_) => return InstallResult::FeedFailed,
        },
    };
    let selection = match catalog.select(id) {
        Ok(selection) => selection,
        Err(crate::install_feed::SelectionError::MissingKey) if closer.is_some() => {
            return InstallResult::KeyMissing;
        }
        Err(_) => return InstallResult::NotAvailable,
    };
    let mut update_info = None;
    let target = if closer.is_some() {
        let Some(target) = selection
            .app()
            .version
            .as_deref()
            .and_then(|version| semver::Version::parse(version).ok())
        else {
            return InstallResult::NotAvailable;
        };
        let detection = tokio::select! {
            biased;
            _ = operation.cancelled() => return InstallResult::Cancelled,
            result = boundaries.detector.detect_update(&catalog, selection.app()) => result,
        };
        update_info = match check_update(detection, &target, None) {
            Ok(info) => Some(info),
            Err(result) => return result,
        };
        Some(target)
    } else {
        let detection = tokio::select! {
            biased;
            _ = operation.cancelled() => return InstallResult::Cancelled,
            result = boundaries.detector.detect(&catalog, selection.app()) => result,
        };
        match detection {
            Detection::Installed { .. } => return InstallResult::AlreadyInstalled,
            Detection::Unknown => return InstallResult::DetectionUnknown,
            Detection::NotInstalled => {}
        }
        None
    };
    if cancelled(sender, operation) {
        return InstallResult::Cancelled;
    }
    let Some(version) = selection.app().version.clone() else {
        return InstallResult::NotAvailable;
    };
    let app_name = selection.app().name.clone();
    let language = language.to_owned();
    let approval_boundaries = boundaries.clone();
    let approval_operation = operation.clone();
    let current_version = update_info.as_ref().map(|info| info.version.clone());
    progress.phase(ProgressPhase::AwaitingApproval);
    // A native modal cannot be cancelled by dropping its blocking task. Keep the claim
    // until it closes so a retry cannot leave behind or overlap an approval dialog.
    let approved = tokio::task::spawn_blocking(move || {
        if approval_operation.is_cancelled() {
            return ApprovalDecision::Denied;
        }
        let request = ApprovalRequest {
            app_name: &app_name,
            version: &version,
            publisher_host: "github.com",
            language: &language,
        };
        match current_version {
            Some(current) => approval_boundaries
                .approval
                .confirm_update(&request, &current),
            None => approval_boundaries.approval.confirm(&request),
        }
    })
    .await;
    if !matches!(approved, Ok(ApprovalDecision::Approved)) || cancelled(sender, operation) {
        return InstallResult::Cancelled;
    }
    progress.phase(ProgressPhase::Downloading);
    let network = CancellableNetwork {
        network: &boundaries.network,
        operation: operation.clone(),
        progress: progress.clone(),
        signature: AtomicBool::new(false),
    };
    let installer = match boundaries
        .workspace
        .prepare(&network, selection.app(), &progress)
        .await
    {
        Ok(installer) => installer,
        Err(error) => return prepare_failure(error),
    };
    if cancelled(sender, operation) {
        return cleanup(installer, InstallResult::Cancelled);
    }
    let current = tokio::select! {
        biased;
        _ = operation.cancelled() => return cleanup(installer, InstallResult::Cancelled),
        result = boundaries.feed.fetch() => match result {
            Ok(current) => current,
            Err(_) => return cleanup(installer, InstallResult::FeedFailed),
        },
    };
    let selection = match selection.revalidate(&current) {
        Ok(selection) => selection,
        Err(_) => return cleanup(installer, InstallResult::ReleaseChanged),
    };
    if let (Some(info), Some(target)) = (&update_info, &target) {
        let detection = tokio::select! {
            biased;
            _ = operation.cancelled() => return cleanup(installer, InstallResult::Cancelled),
            result = boundaries.detector.detect_update(&current, selection.app()) => result,
        };
        if let Err(result) = check_update(detection, target, Some(info)) {
            return cleanup(installer, result);
        }
    } else {
        let detection = tokio::select! {
            biased;
            _ = operation.cancelled() => return cleanup(installer, InstallResult::Cancelled),
            result = boundaries.detector.detect(&current, selection.app()) => result,
        };
        match detection {
            Detection::Installed { .. } => {
                return cleanup(installer, InstallResult::AlreadyInstalled);
            }
            Detection::Unknown => return cleanup(installer, InstallResult::DetectionUnknown),
            Detection::NotInstalled => {}
        }
    }
    if cancelled(sender, operation) {
        return cleanup(installer, InstallResult::Cancelled);
    }
    let (current, selection) =
        if let (Some(closer), Some(info), Some(target)) = (&closer, &update_info, &target) {
            progress.phase(ProgressPhase::Closing);
            // Do not drop an in-flight IPC quit: it owns correlated request cleanup.
            let outcome = closer.close(id, &info.executable).await;
            if cancelled(sender, operation) {
                return cleanup(installer, InstallResult::Cancelled);
            }
            if outcome != crate::update_close::CloseOutcome::Closed {
                return cleanup(installer, InstallResult::AppStillRunning);
            }
            let latest = tokio::select! {
                biased;
                _ = operation.cancelled() => return cleanup(installer, InstallResult::Cancelled),
                result = boundaries.feed.fetch() => match result {
                    Ok(catalog) => catalog,
                    Err(_) => return cleanup(installer, InstallResult::FeedFailed),
                },
            };
            let selected = match selection.revalidate(&latest) {
                Ok(selection) => selection,
                Err(_) => return cleanup(installer, InstallResult::ReleaseChanged),
            };
            let detection = tokio::select! {
                biased;
                _ = operation.cancelled() => return cleanup(installer, InstallResult::Cancelled),
                result = boundaries.detector.detect_update(&latest, selected.app()) => result,
            };
            if let Err(result) = check_update(detection, target, Some(info)) {
                return cleanup(installer, result);
            }
            if cancelled(sender, operation) {
                return cleanup(installer, InstallResult::Cancelled);
            }
            let closer = closer.clone();
            let executable = info.executable.clone();
            operation.set_spawn_check(move || closer.is_running(&executable) == Ok(false));
            (latest, selected)
        } else {
            (current, selection)
        };
    let mut running = match boundaries
        .launcher
        .launch(&installer, operation.clone())
        .await
    {
        Ok(running) => running,
        Err(_) if operation.spawn_rejected.load(Ordering::SeqCst) => {
            return cleanup(installer, InstallResult::AppStillRunning);
        }
        Err(_) => return cleanup(installer, InstallResult::SpawnFailed),
    };
    progress.phase(ProgressPhase::Installing);
    let first = running.wait().await;
    let early = match first {
        Err(LaunchError::Timeout) => Some(InstallResult::Timeout),
        Err(LaunchError::Wait | LaunchError::Monitor) => Some(InstallResult::MonitorFailed),
        _ => None,
    };
    if let Some(result) = early {
        if let Some(sender) = sender.take() {
            let _ = sender.send(result.clone());
        }
        let _ = running.wait_until_exit().await;
        let result = cleanup(installer, result);
        // The command already returned; use the existing progress channel for the late warning.
        if result == InstallResult::CleanupFailed {
            progress.cleanup_failed();
        }
        return result;
    }
    let exit = running.wait_until_exit().await;
    let result = match (first, exit) {
        (Ok(()), Ok(())) => {
            progress.phase(ProgressPhase::Detecting);
            if let Some(target) = &target {
                match boundaries
                    .detector
                    .detect_update(&current, selection.app())
                    .await
                {
                    UpdateDetection::Installed {
                        version: Some(version),
                        ..
                    } => match semver::Version::parse(&version) {
                        Ok(actual)
                            if actual.cmp_precedence(target) == std::cmp::Ordering::Equal =>
                        {
                            InstallResult::Updated { version }
                        }
                        Ok(_) => InstallResult::VersionMismatch { version },
                        Err(_) => InstallResult::NotDetected,
                    },
                    _ => InstallResult::NotDetected,
                }
            } else {
                match boundaries.detector.detect(&current, selection.app()).await {
                    Detection::Installed { version } => InstallResult::Installed { version },
                    Detection::NotInstalled | Detection::Unknown => InstallResult::NotDetected,
                }
            }
        }
        (Err(LaunchError::Exit(code)), _) => InstallResult::InstallerFailed { code },
        _ => InstallResult::MonitorFailed,
    };
    cleanup(installer, result)
}

#[cfg(windows)]
impl Installer for crate::install_workspace::VerifiedInstaller {
    fn cleanup(self) -> Result<(), ()> {
        self.cleanup().map_err(|_| ())
    }
}

#[cfg(windows)]
impl<N: Network + Send> InstallWorkspace<N> for crate::install_workspace::PrivateFactory {
    type Installer = crate::install_workspace::VerifiedInstaller;
    async fn prepare(
        &self,
        network: &CancellableNetwork<'_, N>,
        app: &CatalogApp,
        progress: &ProgressReporter,
    ) -> Result<Self::Installer, PrepareError> {
        crate::install_workspace::download_verified(
            network,
            self,
            app,
            crate::install_download::Limits::default(),
            |item| progress.download(item),
        )
        .await
    }
}

#[cfg(windows)]
pub(crate) struct NativeDetector(crate::ipc::Hub);
#[cfg(windows)]
impl InstallDetector for NativeDetector {
    async fn detect(&self, catalog: &FreshCatalog, app: &CatalogApp) -> Detection {
        let catalog = catalog.catalog().clone();
        let app = app.clone();
        tokio::task::spawn_blocking(move || crate::apps::detect_catalog_app(&catalog, &app))
            .await
            .unwrap_or(Detection::Unknown)
    }
    async fn detect_update(&self, catalog: &FreshCatalog, app: &CatalogApp) -> UpdateDetection {
        let catalog = catalog.catalog().clone();
        let app = app.clone();
        let hub = self.0.clone();
        tokio::task::spawn_blocking(move || {
            crate::apps::detect_catalog_update(&catalog, &app, &hub)
        })
        .await
        .unwrap_or(UpdateDetection::Unknown)
    }
}

#[cfg(windows)]
pub(crate) struct NativeUpdateCloser(crate::ipc::Hub);
#[cfg(windows)]
impl NativeUpdateCloser {
    pub(crate) fn new(hub: crate::ipc::Hub) -> Self {
        Self(hub)
    }
}
#[cfg(windows)]
impl UpdateCloser for NativeUpdateCloser {
    async fn close(
        &self,
        id: &str,
        executable: &std::path::Path,
    ) -> crate::update_close::CloseOutcome {
        let id = id.to_owned();
        let executable = executable.to_owned();
        let hub = self.0.clone();
        tokio::task::spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(crate::update_close::close_for_update(
                &id,
                &executable,
                &hub,
                &crate::update_close::SystemProcessProbe,
                Duration::from_secs(5),
            ))
        })
        .await
        .unwrap_or(crate::update_close::CloseOutcome::StillRunning)
    }
    fn is_running(
        &self,
        executable: &std::path::Path,
    ) -> Result<bool, crate::update_close::ProbeError> {
        crate::update_close::ProcessProbe::is_running(
            &crate::update_close::SystemProcessProbe,
            executable,
        )
    }
}

#[cfg(windows)]
struct CancellableLauncher(Arc<Operation>);
#[cfg(windows)]
impl crate::install_launcher::ProcessLauncher for CancellableLauncher {
    type Child = std::process::Child;
    fn elevated(&self) -> Result<bool, ()> {
        crate::install_launcher::ProcessLauncher::elevated(&crate::install_launcher::SystemLauncher)
    }
    fn spawn(
        &self,
        installer: &crate::install_workspace::VerifiedInstaller,
    ) -> Result<Self::Child, ()> {
        self.0
            .spawn(|| {
                crate::install_launcher::ProcessLauncher::spawn(
                    &crate::install_launcher::SystemLauncher,
                    installer,
                )
            })
            .unwrap_or(Err(()))
    }
}

#[cfg(windows)]
pub(crate) struct NativeLauncher;
#[cfg(windows)]
impl InstallLauncher<crate::install_workspace::VerifiedInstaller> for NativeLauncher {
    type Running = crate::install_launcher::RunningInstaller;
    async fn launch(
        &self,
        installer: &crate::install_workspace::VerifiedInstaller,
        operation: Arc<Operation>,
    ) -> Result<Self::Running, LaunchError> {
        let retained = installer.retain_for_process();
        tokio::task::spawn_blocking(move || {
            crate::install_launcher::start(&retained, CancellableLauncher(operation))
        })
        .await
        .unwrap_or(Err(LaunchError::Monitor))
    }
}

#[cfg(windows)]
impl Monitor for crate::install_launcher::RunningInstaller {
    async fn wait(&mut self) -> Result<(), LaunchError> {
        self.wait().await
    }
    async fn wait_until_exit(self) -> Result<(), LaunchError> {
        self.wait_until_exit().await
    }
}

#[cfg(windows)]
pub(crate) type NativeService = InstallService<
    crate::install_feed::NativeFeed<crate::install_http::HttpTransport>,
    crate::install_http::HttpTransport,
    crate::install_workspace::PrivateFactory,
    crate::install_approval::NativeInstallApproval,
    NativeLauncher,
    NativeDetector,
>;

#[cfg(windows)]
pub(crate) fn native(hub: crate::ipc::Hub) -> Result<NativeService, reqwest::Error> {
    Ok(InstallService::new(
        crate::install_feed::NativeFeed::new(crate::install_http::HttpTransport::new()?),
        crate::install_http::HttpTransport::new()?,
        crate::install_workspace::PrivateFactory::system(),
        crate::install_approval::NativeInstallApproval,
        NativeLauncher,
        NativeDetector(hub),
    ))
}
