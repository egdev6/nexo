//! Composition of the native installation boundaries.
use crate::install_approval::{ApprovalDecision, ApprovalRequest, InstallApproval};
use crate::install_download::Network;
use crate::install_feed::{CatalogFeed, FreshCatalog};
use crate::install_launcher::LaunchError;
use crate::install_workspace::PrepareError;
use nexo_catalog::CatalogApp;
use std::{
    collections::HashSet,
    future::Future,
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Detection {
    Installed { version: Option<String> },
    NotInstalled,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum InstallResult {
    Installed { version: Option<String> },
    AlreadyInstalled,
    Busy,
    Cancelled,
    FeedFailed,
    NotAvailable,
    DetectionUnknown,
    ReleaseChanged,
    DownloadFailed,
    CleanupFailed,
    SpawnFailed,
    MonitorFailed,
    InstallerFailed { code: i32 },
    Timeout,
    NotDetected,
}

pub(crate) trait Installer: Send {
    fn cleanup(self) -> Result<(), ()>;
}
pub(crate) trait InstallWorkspace<N: Network>: Send + Sync {
    type Installer: Installer + 'static;
    fn prepare(
        &self,
        network: &N,
        app: &CatalogApp,
    ) -> impl Future<Output = Result<Self::Installer, PrepareError>> + Send;
}
pub(crate) trait InstallDetector: Send + Sync {
    fn detect(
        &self,
        catalog: &FreshCatalog,
        app: &CatalogApp,
    ) -> impl Future<Output = Detection> + Send;
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
    ) -> impl Future<Output = Result<Self::Running, LaunchError>> + Send;
}

struct Boundaries<F, N, W, A, L, D> {
    feed: F,
    network: N,
    workspace: W,
    approval: A,
    launcher: L,
    detector: D,
    claims: Arc<Mutex<HashSet<String>>>,
}

struct Claim {
    id: String,
    claims: Arc<Mutex<HashSet<String>>>,
}
impl Drop for Claim {
    fn drop(&mut self) {
        self.claims
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&self.id);
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
                claims: Arc::new(Mutex::new(HashSet::new())),
            }),
        }
    }

    pub(crate) async fn install_app(&self, id: &str, language: &str) -> InstallResult {
        let claims = self.boundaries.claims.clone();
        {
            let Ok(mut active) = claims.lock() else {
                return InstallResult::Busy;
            };
            if !active.insert(id.to_owned()) {
                return InstallResult::Busy;
            }
        }
        let claim = Claim {
            id: id.into(),
            claims,
        };
        let boundaries = self.boundaries.clone();
        let id = id.to_owned();
        let language = language.to_owned();
        let (sender, receiver) = oneshot::channel();
        tokio::spawn(async move {
            let mut sender = Some(sender);
            let result = transaction(boundaries, &id, &language, &mut sender).await;
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

fn cleanup<I: Installer>(installer: I, result: InstallResult) -> InstallResult {
    if installer.cleanup().is_err() {
        InstallResult::CleanupFailed
    } else {
        result
    }
}

fn cancelled(sender: &Option<oneshot::Sender<InstallResult>>) -> bool {
    sender.as_ref().is_none_or(oneshot::Sender::is_closed)
}

async fn transaction<F, N, W, A, L, D>(
    boundaries: Arc<Boundaries<F, N, W, A, L, D>>,
    id: &str,
    language: &str,
    sender: &mut Option<oneshot::Sender<InstallResult>>,
) -> InstallResult
where
    F: CatalogFeed + Send + 'static,
    N: Network + Send + 'static,
    W: InstallWorkspace<N> + 'static,
    A: InstallApproval + Send + Sync + 'static,
    L: InstallLauncher<W::Installer> + 'static,
    D: InstallDetector + 'static,
{
    let catalog = match boundaries.feed.fetch().await {
        Ok(catalog) => catalog,
        Err(_) => return InstallResult::FeedFailed,
    };
    let selection = match catalog.select(id) {
        Ok(selection) => selection,
        Err(_) => return InstallResult::NotAvailable,
    };
    match boundaries.detector.detect(&catalog, selection.app()).await {
        Detection::Installed { .. } => return InstallResult::AlreadyInstalled,
        Detection::Unknown => return InstallResult::DetectionUnknown,
        Detection::NotInstalled => {}
    }
    if cancelled(sender) {
        return InstallResult::Cancelled;
    }
    let Some(version) = selection.app().version.clone() else {
        return InstallResult::NotAvailable;
    };
    let app_name = selection.app().name.clone();
    let language = language.to_owned();
    let approval_boundaries = boundaries.clone();
    let approved = tokio::task::spawn_blocking(move || {
        approval_boundaries.approval.confirm(&ApprovalRequest {
            app_name: &app_name,
            version: &version,
            publisher_host: "github.com",
            language: &language,
        })
    })
    .await;
    if !matches!(approved, Ok(ApprovalDecision::Approved)) || cancelled(sender) {
        return InstallResult::Cancelled;
    }
    let installer = match boundaries
        .workspace
        .prepare(&boundaries.network, selection.app())
        .await
    {
        Ok(installer) => installer,
        Err(error) => {
            return if error.cleanup_failed {
                InstallResult::CleanupFailed
            } else {
                InstallResult::DownloadFailed
            };
        }
    };
    if cancelled(sender) {
        return cleanup(installer, InstallResult::Cancelled);
    }
    let current = match boundaries.feed.fetch().await {
        Ok(current) => current,
        Err(_) => return cleanup(installer, InstallResult::FeedFailed),
    };
    let selection = match selection.revalidate(&current) {
        Ok(selection) => selection,
        Err(_) => return cleanup(installer, InstallResult::ReleaseChanged),
    };
    match boundaries.detector.detect(&current, selection.app()).await {
        Detection::Installed { .. } => return cleanup(installer, InstallResult::AlreadyInstalled),
        Detection::Unknown => return cleanup(installer, InstallResult::DetectionUnknown),
        Detection::NotInstalled => {}
    }
    if cancelled(sender) {
        return cleanup(installer, InstallResult::Cancelled);
    }
    let mut running = match boundaries.launcher.launch(&installer).await {
        Ok(running) => running,
        Err(_) => return cleanup(installer, InstallResult::SpawnFailed),
    };
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
        return cleanup(installer, result);
    }
    let exit = running.wait_until_exit().await;
    let result = match (first, exit) {
        (Ok(()), Ok(())) => match boundaries.detector.detect(&current, selection.app()).await {
            Detection::Installed { version } => InstallResult::Installed { version },
            Detection::NotInstalled | Detection::Unknown => InstallResult::NotDetected,
        },
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
        network: &N,
        app: &CatalogApp,
    ) -> Result<Self::Installer, PrepareError> {
        crate::install_workspace::download_verified(
            network,
            self,
            app,
            crate::install_download::Limits::default(),
            |_| {},
        )
        .await
    }
}

#[cfg(windows)]
pub(crate) struct NativeDetector;
#[cfg(windows)]
impl InstallDetector for NativeDetector {
    async fn detect(&self, catalog: &FreshCatalog, app: &CatalogApp) -> Detection {
        let catalog = catalog.catalog().clone();
        let app = app.clone();
        tokio::task::spawn_blocking(move || crate::apps::detect_catalog_app(&catalog, &app))
            .await
            .unwrap_or(Detection::Unknown)
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
    ) -> Result<Self::Running, LaunchError> {
        let retained = installer.retain_for_process();
        tokio::task::spawn_blocking(move || {
            crate::install_launcher::start(&retained, crate::install_launcher::SystemLauncher)
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
pub(crate) fn native() -> Result<NativeService, reqwest::Error> {
    Ok(InstallService::new(
        crate::install_feed::NativeFeed::new(crate::install_http::HttpTransport::new()?),
        crate::install_http::HttpTransport::new()?,
        crate::install_workspace::PrivateFactory::system(),
        crate::install_approval::NativeInstallApproval,
        NativeLauncher,
        NativeDetector,
    ))
}
