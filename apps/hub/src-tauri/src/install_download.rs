//! Bounded, injectable installer download stage. It does not execute files.
//!
//! Downloading alone does not verify signatures or authorize execution. The workspace adapter
//! must retain the prepared workspace through verification and eventual process creation.
use std::future::Future;
use std::time::Duration;

pub const INSTALLER_LIMIT: u64 = 512 * 1024 * 1024;
pub const SIGNATURE_LIMIT: u64 = 16 * 1024;
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
pub const MAX_REDIRECTS: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Artifact {
    Installer,
    Signature,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    InitialUrl,
    RedirectUrl,
    RedirectLimit,
    Network,
    ConnectTimeout,
    DownloadTimeout,
    SizeLimit,
    LengthMismatch,
    Storage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DownloadError {
    pub cause: Failure,
    pub cleanup_failed: bool,
}

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub installer_bytes: u64,
    pub signature_bytes: u64,
    pub connect_timeout: Duration,
    pub download_timeout: Duration,
    pub redirects: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            installer_bytes: INSTALLER_LIMIT,
            signature_bytes: SIGNATURE_LIMIT,
            connect_timeout: CONNECT_TIMEOUT,
            download_timeout: DOWNLOAD_TIMEOUT,
            redirects: MAX_REDIRECTS,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    pub artifact: Artifact,
    pub bytes: u64,
    pub total: Option<u64>,
}

#[derive(Debug)]
pub struct NetworkError;
#[derive(Debug)]
pub struct StorageError;

pub trait Body: Send {
    fn next(&mut self) -> impl Future<Output = Result<Option<Vec<u8>>, NetworkError>> + Send;
}

pub enum ResponseKind<B> {
    Ok { length: Option<u64>, body: B },
    Redirect(String),
    Failed,
}

pub struct Response<B> {
    pub effective_url: String,
    pub kind: ResponseKind<B>,
}

/// Implementations must disable automatic redirects: checking `effective_url` after a request
/// cannot undo a connection to a forbidden host. Responses must be streamed without decompression.
pub trait Network: Sync {
    type Body: Body;
    fn get(
        &self,
        url: &str,
    ) -> impl Future<Output = Result<Response<Self::Body>, NetworkError>> + Send;
}

pub trait Workspace: Send {
    fn write(
        &mut self,
        artifact: Artifact,
        bytes: &[u8],
    ) -> impl Future<Output = Result<(), StorageError>> + Send;
    fn cleanup(&mut self) -> Result<(), StorageError>;
}

/// Implementations must create a unique private directory and fixed-name files that cannot be
/// replaced or redirected before signature verification and process launch.
pub trait WorkspaceFactory {
    type Workspace: Workspace;
    fn create(&self) -> Result<Self::Workspace, StorageError>;

    /// Factories may report a failed cleanup when creation itself only partially succeeded.
    fn create_for_download(&self) -> Result<Self::Workspace, DownloadError> {
        self.create().map_err(|_| DownloadError {
            cause: Failure::Storage,
            cleanup_failed: false,
        })
    }
}

pub struct Prepared<W: Workspace> {
    workspace: Option<W>,
}

impl<W: Workspace> Prepared<W> {
    pub(crate) fn into_workspace(mut self) -> W {
        self.workspace.take().expect("workspace is present")
    }

    pub fn cleanup(mut self) -> Result<(), StorageError> {
        self.workspace
            .take()
            .expect("workspace is present")
            .cleanup()
    }
}

impl<W: Workspace> Drop for Prepared<W> {
    fn drop(&mut self) {
        if let Some(mut workspace) = self.workspace.take()
            && workspace.cleanup().is_err()
        {
            eprintln!("Could not clean the temporary download workspace");
        }
    }
}

fn redirect_target(current: &url::Url, location: &str) -> Result<url::Url, Failure> {
    if location
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control() || ch == '\\' || ch == '\u{feff}')
    {
        return Err(Failure::RedirectUrl);
    }
    let authority = location
        .find("://")
        .filter(|&index| !location[..index].contains(['/', '?', '#']))
        .map(|index| &location[index + 3..])
        .or_else(|| location.strip_prefix("//"));
    if let Some(authority) = authority
        && authority
            .split(['/', '?', '#'])
            .next()
            .is_some_and(|part| part.contains('@'))
    {
        return Err(Failure::RedirectUrl);
    }
    let target = current.join(location).map_err(|_| Failure::RedirectUrl)?;
    if target.scheme() != "https"
        || !matches!(
            target.host_str(),
            Some("release-assets.githubusercontent.com" | "objects.githubusercontent.com")
        )
        || target.port().is_some()
        || !target.username().is_empty()
        || target.password().is_some()
        || target.fragment().is_some()
    {
        return Err(Failure::RedirectUrl);
    }
    Ok(target)
}

impl Limits {
    fn bounded(self) -> Self {
        Self {
            installer_bytes: self.installer_bytes.min(INSTALLER_LIMIT),
            signature_bytes: self.signature_bytes.min(SIGNATURE_LIMIT),
            connect_timeout: self.connect_timeout.min(CONNECT_TIMEOUT),
            download_timeout: self.download_timeout.min(DOWNLOAD_TIMEOUT),
            redirects: self.redirects.min(MAX_REDIRECTS),
        }
    }
}

async fn download_one<N: Network, W: Workspace>(
    network: &N,
    workspace: &mut W,
    initial: &str,
    artifact: Artifact,
    limits: Limits,
    progress: &mut impl FnMut(Progress),
) -> Result<(), Failure> {
    let mut url = url::Url::parse(initial).map_err(|_| Failure::InitialUrl)?;
    let max_bytes = match artifact {
        Artifact::Installer => limits.installer_bytes,
        Artifact::Signature => limits.signature_bytes,
    };
    let deadline = tokio::time::Instant::now() + limits.download_timeout;
    let operation = async {
        let mut redirects = 0;
        loop {
            if tokio::time::Instant::now() >= deadline {
                return Err(Failure::DownloadTimeout);
            }
            let response = tokio::time::timeout(limits.connect_timeout, network.get(url.as_str()))
                .await
                .map_err(|_| Failure::ConnectTimeout)?
                .map_err(|_| Failure::Network)?;
            if response.effective_url != url.as_str() {
                return Err(Failure::RedirectUrl);
            }
            match response.kind {
                ResponseKind::Failed => return Err(Failure::Network),
                ResponseKind::Redirect(location) => {
                    if redirects >= limits.redirects {
                        return Err(Failure::RedirectLimit);
                    }
                    url = redirect_target(&url, &location)?;
                    redirects += 1;
                }
                ResponseKind::Ok { length, mut body } => {
                    if length.is_some_and(|length| length > max_bytes) {
                        return Err(Failure::SizeLimit);
                    }
                    let mut received = 0_u64;
                    while let Some(chunk) = body.next().await.map_err(|_| Failure::Network)? {
                        if tokio::time::Instant::now() >= deadline {
                            return Err(Failure::DownloadTimeout);
                        }
                        if chunk.is_empty() {
                            return Err(Failure::Network);
                        }
                        received = received
                            .checked_add(chunk.len() as u64)
                            .ok_or(Failure::SizeLimit)?;
                        if received > max_bytes {
                            return Err(Failure::SizeLimit);
                        }
                        if length.is_some_and(|length| received > length) {
                            return Err(Failure::LengthMismatch);
                        }
                        workspace
                            .write(artifact, &chunk)
                            .await
                            .map_err(|_| Failure::Storage)?;
                        progress(Progress {
                            artifact,
                            bytes: received,
                            total: length,
                        });
                    }
                    if length.is_some_and(|length| length != received) {
                        return Err(Failure::LengthMismatch);
                    }
                    return Ok(());
                }
            }
        }
    };
    tokio::time::timeout(limits.download_timeout, operation)
        .await
        .map_err(|_| Failure::DownloadTimeout)?
}

/// Download an installer and its signature without running either. Limits may only be tightened.
pub async fn download_pair<N: Network, F: WorkspaceFactory>(
    network: &N,
    factory: &F,
    initial: &str,
    limits: Limits,
    mut progress: impl FnMut(Progress),
) -> Result<Prepared<F::Workspace>, DownloadError> {
    if nexo_catalog::check_release_asset_url(initial).is_err() {
        return Err(DownloadError {
            cause: Failure::InitialUrl,
            cleanup_failed: false,
        });
    }
    let signature = format!("{initial}.sig");
    if nexo_catalog::check_release_asset_url(&signature).is_err() {
        return Err(DownloadError {
            cause: Failure::InitialUrl,
            cleanup_failed: false,
        });
    }
    let workspace = factory.create_for_download()?;
    // The guard also cleans up if the caller drops or cancels the future mid-download.
    let mut prepared = Prepared {
        workspace: Some(workspace),
    };
    let limits = limits.bounded();
    let mut result = Ok(());
    for (url, artifact) in [
        (initial, Artifact::Installer),
        (signature.as_str(), Artifact::Signature),
    ] {
        result = download_one(
            network,
            prepared.workspace.as_mut().expect("workspace is present"),
            url,
            artifact,
            limits,
            &mut progress,
        )
        .await;
        if result.is_err() {
            break;
        }
    }
    match result {
        Ok(()) => Ok(prepared),
        Err(cause) => Err(DownloadError {
            cause,
            cleanup_failed: prepared.cleanup().is_err(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    const INITIAL: &str = "https://github.com/egdev6/example/releases/download/v1/setup.exe";
    const ASSET: &str = "https://release-assets.githubusercontent.com/file?token=fixture";

    enum Reply {
        Ok {
            length: Option<u64>,
            chunks: Vec<Vec<u8>>,
        },
        PendingBody,
        Redirect(String),
        Failed,
        PendingConnection,
        AutoRedirect(String),
    }
    struct FakeBody {
        chunks: VecDeque<Vec<u8>>,
        pending: bool,
    }
    impl Body for FakeBody {
        async fn next(&mut self) -> Result<Option<Vec<u8>>, NetworkError> {
            if self.pending {
                return std::future::pending().await;
            }
            Ok(self.chunks.pop_front())
        }
    }
    #[derive(Default)]
    struct FakeNetwork {
        replies: Mutex<VecDeque<Reply>>,
        requests: Mutex<Vec<String>>,
    }
    impl FakeNetwork {
        fn with(replies: Vec<Reply>) -> Self {
            Self {
                replies: Mutex::new(replies.into()),
                requests: Mutex::new(vec![]),
            }
        }
        fn requests(&self) -> Vec<String> {
            self.requests.lock().unwrap().clone()
        }
    }
    impl Network for FakeNetwork {
        type Body = FakeBody;
        async fn get(&self, url: &str) -> Result<Response<Self::Body>, NetworkError> {
            self.requests.lock().unwrap().push(url.to_owned());
            let reply = self
                .replies
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected network request");
            let mut effective_url = url.to_owned();
            let kind = match reply {
                Reply::Ok { length, chunks } => ResponseKind::Ok {
                    length,
                    body: FakeBody {
                        chunks: chunks.into(),
                        pending: false,
                    },
                },
                Reply::PendingBody => ResponseKind::Ok {
                    length: None,
                    body: FakeBody {
                        chunks: VecDeque::new(),
                        pending: true,
                    },
                },
                Reply::Redirect(location) => ResponseKind::Redirect(location),
                Reply::Failed => ResponseKind::Failed,
                Reply::PendingConnection => return std::future::pending().await,
                Reply::AutoRedirect(location) => {
                    effective_url = location;
                    ResponseKind::Failed
                }
            };
            Ok(Response {
                effective_url,
                kind,
            })
        }
    }

    #[derive(Default)]
    struct State {
        created: usize,
        cleaned: usize,
        installer: Vec<u8>,
        signature: Vec<u8>,
        fail_cleanup: bool,
        fail_write: bool,
    }
    #[derive(Clone, Default)]
    struct FakeFactory(Arc<Mutex<State>>);
    struct FakeWorkspace(Arc<Mutex<State>>);
    impl WorkspaceFactory for FakeFactory {
        type Workspace = FakeWorkspace;
        fn create(&self) -> Result<Self::Workspace, StorageError> {
            self.0.lock().unwrap().created += 1;
            Ok(FakeWorkspace(self.0.clone()))
        }
    }
    impl Workspace for FakeWorkspace {
        async fn write(&mut self, artifact: Artifact, bytes: &[u8]) -> Result<(), StorageError> {
            let mut state = self.0.lock().unwrap();
            if state.fail_write {
                return Err(StorageError);
            }
            match artifact {
                Artifact::Installer => state.installer.extend_from_slice(bytes),
                Artifact::Signature => state.signature.extend_from_slice(bytes),
            }
            Ok(())
        }
        fn cleanup(&mut self) -> Result<(), StorageError> {
            let mut state = self.0.lock().unwrap();
            state.cleaned += 1;
            if state.fail_cleanup {
                Err(StorageError)
            } else {
                Ok(())
            }
        }
    }
    fn ok(bytes: &[u8], length: Option<u64>) -> Reply {
        Reply::Ok {
            length,
            chunks: vec![bytes.to_vec()],
        }
    }
    fn limits() -> Limits {
        Limits {
            installer_bytes: 8,
            signature_bytes: 4,
            connect_timeout: Duration::from_secs(2),
            download_timeout: Duration::from_secs(5),
            redirects: 2,
        }
    }
    async fn error(network: &FakeNetwork, factory: &FakeFactory, initial: &str) -> DownloadError {
        match download_pair(network, factory, initial, limits(), |_| {}).await {
            Ok(_) => panic!("unexpected download"),
            Err(error) => error,
        }
    }

    #[tokio::test]
    async fn refuses_untrusted_initial_url_before_network_or_storage() {
        let network = FakeNetwork::default();
        let factory = FakeFactory::default();
        let failure = error(
            &network,
            &factory,
            "https://github.com.evil/egdev6/example/releases/download/v1/a.exe",
        )
        .await;
        assert_eq!(failure.cause, Failure::InitialUrl);
        assert!(network.requests().is_empty());
        assert_eq!(factory.0.lock().unwrap().created, 0);
    }

    #[tokio::test]
    async fn streams_both_artifacts_and_cleans_after_success() {
        let network = FakeNetwork::with(vec![
            Reply::Ok {
                length: Some(4),
                chunks: vec![b"ab".to_vec(), b"cd".to_vec()],
            },
            ok(b"sig", None),
        ]);
        let factory = FakeFactory::default();
        let mut progress = vec![];
        let prepared = download_pair(&network, &factory, INITIAL, limits(), |item| {
            progress.push(item)
        })
        .await
        .ok()
        .unwrap();
        assert_eq!(
            network.requests(),
            [INITIAL.to_owned(), format!("{INITIAL}.sig")]
        );
        assert_eq!(
            progress,
            [
                Progress {
                    artifact: Artifact::Installer,
                    bytes: 2,
                    total: Some(4)
                },
                Progress {
                    artifact: Artifact::Installer,
                    bytes: 4,
                    total: Some(4)
                },
                Progress {
                    artifact: Artifact::Signature,
                    bytes: 3,
                    total: None
                }
            ]
        );
        {
            let state = factory.0.lock().unwrap();
            assert_eq!(state.created, 1);
            assert_eq!(state.cleaned, 0);
            assert_eq!(state.installer, b"abcd");
            assert_eq!(state.signature, b"sig");
        }
        assert!(prepared.cleanup().is_ok());
        assert_eq!(factory.0.lock().unwrap().cleaned, 1);
    }

    #[tokio::test]
    async fn accepts_only_the_two_github_asset_hosts_on_redirect() {
        for asset in [ASSET, "https://objects.githubusercontent.com/file?x=1"] {
            let network = FakeNetwork::with(vec![
                Reply::Redirect(asset.into()),
                ok(b"i", None),
                ok(b"s", None),
            ]);
            let factory = FakeFactory::default();
            let prepared = download_pair(&network, &factory, INITIAL, limits(), |_| {})
                .await
                .ok()
                .unwrap();
            assert_eq!(
                network.requests(),
                [
                    INITIAL.to_owned(),
                    asset.to_owned(),
                    format!("{INITIAL}.sig")
                ]
            );
            assert!(prepared.cleanup().is_ok());
        }
        for asset in [
            "https://release-assets.githubusercontent.com.evil/file",
            "http://release-assets.githubusercontent.com/file",
            "https://user@release-assets.githubusercontent.com/file",
            "HTTPS://@release-assets.githubusercontent.com/file",
            "https://github.com/egdev6/example/releases/download/v1/other.exe",
            "https://release-assets.githubusercontent.com:444/file",
        ] {
            let network = FakeNetwork::with(vec![Reply::Redirect(asset.into())]);
            let factory = FakeFactory::default();
            assert_eq!(
                error(&network, &factory, INITIAL).await.cause,
                Failure::RedirectUrl,
                "{asset}"
            );
            assert_eq!(network.requests().len(), 1);
            assert_eq!(factory.0.lock().unwrap().cleaned, 1);
        }
    }

    #[tokio::test]
    async fn refuses_excess_redirects_and_automatic_redirects() {
        let network = FakeNetwork::with(vec![
            Reply::Redirect(ASSET.into()),
            Reply::Redirect(ASSET.into()),
            Reply::Redirect(ASSET.into()),
        ]);
        let factory = FakeFactory::default();
        assert_eq!(
            error(&network, &factory, INITIAL).await.cause,
            Failure::RedirectLimit
        );
        assert_eq!(network.requests().len(), 3);
        assert_eq!(factory.0.lock().unwrap().cleaned, 1);
        let network = FakeNetwork::with(vec![Reply::AutoRedirect(
            "https://evil.example/file".into(),
        )]);
        let factory = FakeFactory::default();
        assert_eq!(
            error(&network, &factory, INITIAL).await.cause,
            Failure::RedirectUrl
        );
        assert_eq!(factory.0.lock().unwrap().cleaned, 1);
    }

    #[tokio::test]
    async fn bounds_streamed_data_and_checks_advertised_length_for_both_artifacts() {
        for (replies, cause) in [
            (vec![ok(b"", Some(9))], Failure::SizeLimit),
            (
                vec![Reply::Ok {
                    length: None,
                    chunks: vec![b"12345".to_vec(), b"6789".to_vec()],
                }],
                Failure::SizeLimit,
            ),
            (vec![ok(b"ab", Some(3))], Failure::LengthMismatch),
            (vec![ok(b"a", None), ok(b"12345", None)], Failure::SizeLimit),
            (
                vec![ok(b"a", None), ok(b"x", Some(2))],
                Failure::LengthMismatch,
            ),
        ] {
            let network = FakeNetwork::with(replies);
            let factory = FakeFactory::default();
            assert_eq!(error(&network, &factory, INITIAL).await.cause, cause);
            assert_eq!(factory.0.lock().unwrap().cleaned, 1);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn bounds_connection_and_overall_download_time() {
        for (reply, cause) in [
            (Reply::PendingConnection, Failure::ConnectTimeout),
            (Reply::PendingBody, Failure::DownloadTimeout),
        ] {
            let network = FakeNetwork::with(vec![reply]);
            let factory = FakeFactory::default();
            assert_eq!(error(&network, &factory, INITIAL).await.cause, cause);
            assert_eq!(factory.0.lock().unwrap().cleaned, 1);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn dropping_an_in_flight_download_cleans_its_workspace() {
        let network = FakeNetwork::with(vec![Reply::PendingBody]);
        let factory = FakeFactory::default();
        let pending = download_pair(&network, &factory, INITIAL, limits(), |_| {});
        assert!(
            tokio::time::timeout(Duration::from_secs(1), pending)
                .await
                .is_err()
        );
        assert_eq!(factory.0.lock().unwrap().cleaned, 1);
    }

    #[tokio::test]
    async fn successful_download_reports_cleanup_failure() {
        let network = FakeNetwork::with(vec![ok(b"a", None), ok(b"s", None)]);
        let factory = FakeFactory::default();
        factory.0.lock().unwrap().fail_cleanup = true;
        let prepared = download_pair(&network, &factory, INITIAL, limits(), |_| {})
            .await
            .ok()
            .unwrap();
        assert!(prepared.cleanup().is_err());
        assert_eq!(factory.0.lock().unwrap().cleaned, 1);
    }

    #[tokio::test]
    async fn reports_cleanup_failure_without_hiding_download_failure() {
        let network = FakeNetwork::with(vec![Reply::Failed]);
        let factory = FakeFactory::default();
        factory.0.lock().unwrap().fail_cleanup = true;
        let failure = error(&network, &factory, INITIAL).await;
        assert_eq!(
            failure,
            DownloadError {
                cause: Failure::Network,
                cleanup_failed: true
            }
        );
        assert_eq!(factory.0.lock().unwrap().cleaned, 1);
    }

    struct PartialCreateFailure;
    impl WorkspaceFactory for PartialCreateFailure {
        type Workspace = FakeWorkspace;
        fn create(&self) -> Result<Self::Workspace, StorageError> {
            Err(StorageError)
        }
        fn create_for_download(&self) -> Result<Self::Workspace, DownloadError> {
            Err(DownloadError {
                cause: Failure::Storage,
                cleanup_failed: true,
            })
        }
    }

    #[tokio::test]
    async fn partial_creation_cleanup_failure_is_reported_without_network() {
        let network = FakeNetwork::default();
        let result =
            download_pair(&network, &PartialCreateFailure, INITIAL, limits(), |_| {}).await;
        assert!(matches!(
            result,
            Err(DownloadError {
                cause: Failure::Storage,
                cleanup_failed: true
            })
        ));
        assert!(network.requests().is_empty());
    }

    #[tokio::test]
    async fn storage_failure_never_requests_the_signature_and_cleans_workspace() {
        let network = FakeNetwork::with(vec![ok(b"a", None)]);
        let factory = FakeFactory::default();
        factory.0.lock().unwrap().fail_write = true;
        assert_eq!(
            error(&network, &factory, INITIAL).await.cause,
            Failure::Storage
        );
        assert_eq!(network.requests(), [INITIAL.to_owned()]);
        assert_eq!(factory.0.lock().unwrap().cleaned, 1);
    }
}

#[cfg(test)]
#[path = "vp_install_tests.rs"]
mod vp_install_tests;
