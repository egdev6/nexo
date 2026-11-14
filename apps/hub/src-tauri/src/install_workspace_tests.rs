use crate::install_download::{
    self, Body, Limits, Network, NetworkError, Response, ResponseKind, WorkspaceFactory,
};
use crate::install_signature::VerifyError;
use crate::install_workspace::{
    PrepareError, PrepareFailure, PrivateFactory, download_verified, owner_is_trusted,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

const URL: &str = "https://github.com/egdev6/example/releases/download/v1/example_x64-setup.exe";
const KEY: &str = include_str!("../tests/fixtures/tauri-test.pub");
const SIGNATURE: &str = include_str!("../tests/fixtures/tauri-test.sig.txt");
static NEXT: AtomicU64 = AtomicU64::new(0);

#[test]
fn owner_check_accepts_the_token_user() {
    let user = "S-1-5-21-100-200-300-1001";
    assert!(owner_is_trusted(user, user, "S-1-5-32-544"));
}

#[test]
fn owner_check_accepts_the_token_default_owner() {
    let user = "S-1-5-21-100-200-300-1001";
    let default_owner = "S-1-5-32-544";
    assert!(owner_is_trusted(default_owner, user, default_owner));
}

#[test]
fn owner_check_rejects_other_sids() {
    let user = "S-1-5-21-100-200-300-1001";
    assert!(!owner_is_trusted(
        "S-1-5-21-100-200-300-1002",
        user,
        "S-1-5-32-544"
    ));
    // Administrators is not trusted merely because it is a well-known SID.
    assert!(!owner_is_trusted("S-1-5-32-544", user, user));
}

pub(super) struct Scratch(PathBuf);
impl Scratch {
    pub(super) fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "nexo-workspace-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    pub(super) fn factory(&self) -> PrivateFactory {
        PrivateFactory::in_directory(self.0.clone())
    }
    pub(super) fn workspaces(&self) -> Vec<PathBuf> {
        fs::read_dir(&self.0)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("nexo-install-")
                    && fs::symlink_metadata(path).unwrap().file_type().is_dir()
            })
            .collect()
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

pub(super) fn app() -> nexo_catalog::CatalogApp {
    let mut value: serde_json::Value = serde_json::from_str(include_str!(
        "../../../../crates/nexo-catalog/fixtures/minimal.json"
    ))
    .unwrap();
    value["schemaVersion"] = 3.into();
    value["apps"][0]["installerUrl"] = URL.into();
    value["apps"][0]["latestJsonUrl"] =
        "https://github.com/egdev6/example/releases/download/v1/latest.json".into();
    value["apps"][0]["updaterPublicKey"] = STANDARD.encode(KEY).into();
    nexo_catalog::parse_catalog(&value.to_string())
        .unwrap()
        .apps
        .remove(0)
}

pub(super) struct FakeBody(Option<Vec<u8>>);
impl Body for FakeBody {
    async fn next(&mut self) -> Result<Option<Vec<u8>>, NetworkError> {
        Ok(self.0.take().filter(|chunk| !chunk.is_empty()))
    }
}
pub(super) struct FakeNetwork {
    replies: Mutex<VecDeque<Vec<u8>>>,
    requests: Mutex<Vec<String>>,
    tamper_root: Option<PathBuf>,
}
impl FakeNetwork {
    fn new(installer: &[u8], signature: &[u8]) -> Self {
        Self {
            replies: Mutex::new([installer.to_vec(), signature.to_vec()].into()),
            requests: Mutex::new(vec![]),
            tamper_root: None,
        }
    }
    pub(super) fn valid() -> Self {
        Self::new(b"test", STANDARD.encode(SIGNATURE).as_bytes())
    }
    fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}
impl Network for FakeNetwork {
    type Body = FakeBody;
    async fn get(&self, url: &str) -> Result<Response<Self::Body>, NetworkError> {
        self.requests.lock().unwrap().push(url.into());
        if url.ends_with(".sig")
            && let Some(root) = &self.tamper_root
        {
            let workspace = fs::read_dir(root)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| {
                    path.is_dir()
                        && path
                            .file_name()
                            .unwrap()
                            .to_string_lossy()
                            .starts_with("nexo-install-")
                })
                .unwrap();
            fs::write(workspace.join("installer.exe"), b"Test").unwrap();
        }
        let bytes = self
            .replies
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected network request");
        Ok(Response {
            effective_url: url.into(),
            kind: ResponseKind::Ok {
                length: Some(bytes.len() as u64),
                body: FakeBody(Some(bytes)),
            },
        })
    }
}

pub(super) async fn prepare(
    network: &FakeNetwork,
    factory: &PrivateFactory,
    app: &nexo_catalog::CatalogApp,
    limits: Limits,
) -> Result<crate::install_workspace::VerifiedInstaller, PrepareError> {
    download_verified(network, factory, app, limits, |_| {}).await
}
fn assert_error(
    result: Result<crate::install_workspace::VerifiedInstaller, PrepareError>,
    cause: PrepareFailure,
    scratch: &Scratch,
) {
    assert_eq!(
        result.unwrap_err(),
        PrepareError {
            cause,
            cleanup_failed: false
        }
    );
    assert!(
        scratch.workspaces().is_empty(),
        "workspace must be removed on failure"
    );
}

#[tokio::test]
async fn verified_handle_keeps_unique_private_workspace_and_exact_verified_path_until_drop() {
    let scratch = Scratch::new();
    let factory = scratch.factory();
    let first = prepare(&FakeNetwork::valid(), &factory, &app(), Limits::default())
        .await
        .unwrap();
    let second = prepare(&FakeNetwork::valid(), &factory, &app(), Limits::default())
        .await
        .unwrap();
    let first_path = first.executable_path().to_owned();
    assert_ne!(first_path, second.executable_path());
    assert_eq!(first_path.file_name().unwrap(), "installer.exe");
    assert_eq!(fs::read(&first_path).unwrap(), b"test");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(first_path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
    }
    assert_eq!(scratch.workspaces().len(), 2);
    drop(first);
    assert!(!first_path.exists());
    assert_eq!(scratch.workspaces().len(), 1);
    drop(second);
    assert!(scratch.workspaces().is_empty());
}

#[tokio::test]
async fn explicit_cleanup_removes_a_verified_workspace_before_spawn() {
    let scratch = Scratch::new();
    let installer = prepare(
        &FakeNetwork::valid(),
        &scratch.factory(),
        &app(),
        Limits::default(),
    )
    .await
    .unwrap();
    let path = installer.executable_path().to_owned();
    assert!(installer.cleanup().is_ok());
    assert!(!path.exists());
    assert!(scratch.workspaces().is_empty());
}

#[tokio::test]
async fn explicit_cleanup_reports_failure_and_stale_cleanup_can_recover() {
    let scratch = Scratch::new();
    let factory = scratch.factory();
    let installer = prepare(&FakeNetwork::valid(), &factory, &app(), Limits::default())
        .await
        .unwrap();
    let path = installer.executable_path().to_owned();
    let lock = fs::read_dir(&scratch.0)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(".nexo-install-coordination-")
        })
        .unwrap();
    // A directory in place of the coordination file makes its open fail on all platforms.
    fs::remove_file(&lock).unwrap();
    fs::create_dir(&lock).unwrap();
    let outcome = installer.cleanup();
    let still_present = path.exists();
    fs::remove_dir(&lock).unwrap();
    factory.cleanup_stale().unwrap();
    assert!(outcome.is_err());
    assert!(still_present);
    assert!(!path.exists());
    assert!(scratch.workspaces().is_empty());
}

#[tokio::test]
async fn explicit_cleanup_does_not_remove_a_retained_installer() {
    let scratch = Scratch::new();
    let installer = prepare(
        &FakeNetwork::valid(),
        &scratch.factory(),
        &app(),
        Limits::default(),
    )
    .await
    .unwrap();
    let retained = installer.retain_for_process();
    let path = retained.executable_path().to_owned();
    assert!(installer.cleanup().is_err());
    assert!(path.exists());
    drop(retained);
    assert!(!path.exists());
    assert!(scratch.workspaces().is_empty());
}

#[tokio::test]
async fn missing_key_is_rejected_before_network_and_workspace_creation() {
    let scratch = Scratch::new();
    let network = FakeNetwork::valid();
    let mut app = app();
    app.updater_public_key = None;
    assert_error(
        prepare(&network, &scratch.factory(), &app, Limits::default()).await,
        PrepareFailure::Verify(VerifyError::MissingKey),
        &scratch,
    );
    assert!(network.requests().is_empty());
}

#[tokio::test]
async fn unsupported_installer_assets_are_rejected_before_network_or_workspace_creation() {
    for asset in [
        "setup.exe",
        "example_x64-setup.msi",
        "example_arm64-setup.exe",
        "example_x64-setup.EXE",
        "example_x64-setup.exe.txt",
    ] {
        let scratch = Scratch::new();
        let network = FakeNetwork::valid();
        let mut app = app();
        app.installer_url =
            format!("https://github.com/egdev6/example/releases/download/v1/{asset}");
        let result = prepare(&network, &scratch.factory(), &app, Limits::default()).await;
        assert_eq!(
            result.unwrap_err(),
            PrepareError {
                cause: PrepareFailure::UnsupportedInstaller,
                cleanup_failed: false,
            },
            "{asset}"
        );
        assert!(network.requests().is_empty(), "{asset}");
        assert!(scratch.workspaces().is_empty(), "{asset}");
    }
}

#[tokio::test]
async fn bad_signature_yields_no_handle_and_removes_workspace() {
    let scratch = Scratch::new();
    let network = FakeNetwork::new(b"test", b"bad signature");
    assert_error(
        prepare(&network, &scratch.factory(), &app(), Limits::default()).await,
        PrepareFailure::Verify(VerifyError::MalformedSignature),
        &scratch,
    );
    assert_eq!(network.requests(), [URL.to_owned(), format!("{URL}.sig")]);
}

#[tokio::test]
async fn tampering_after_download_before_verification_fails_and_cleans() {
    let scratch = Scratch::new();
    let mut network = FakeNetwork::valid();
    network.tamper_root = Some(scratch.0.clone());
    assert_error(
        prepare(&network, &scratch.factory(), &app(), Limits::default()).await,
        PrepareFailure::Verify(VerifyError::VerificationFailed),
        &scratch,
    );
    assert_eq!(network.requests(), [URL.to_owned(), format!("{URL}.sig")]);
}

#[tokio::test]
async fn disallowed_host_yields_no_handle_or_workspace() {
    let scratch = Scratch::new();
    let network = FakeNetwork::valid();
    let mut app = app();
    app.installer_url =
        "https://github.com.evil/egdev6/example/releases/download/v1/example_x64-setup.exe".into();
    assert_error(
        prepare(&network, &scratch.factory(), &app, Limits::default()).await,
        PrepareFailure::Download(install_download::Failure::InitialUrl),
        &scratch,
    );
    assert!(network.requests().is_empty());
}

#[tokio::test]
async fn size_limit_yields_no_handle_and_cleans_without_signature_request() {
    let scratch = Scratch::new();
    let network = FakeNetwork::valid();
    let limits = Limits {
        installer_bytes: 3,
        ..Limits::default()
    };
    assert_error(
        prepare(&network, &scratch.factory(), &app(), limits).await,
        PrepareFailure::Download(install_download::Failure::SizeLimit),
        &scratch,
    );
    assert_eq!(network.requests(), [URL.to_owned()]);
}

#[tokio::test]
async fn existing_download_pair_still_cleans_when_dropped_without_verification() {
    let scratch = Scratch::new();
    let network = FakeNetwork::valid();
    let prepared = install_download::download_pair(
        &network,
        &scratch.factory(),
        URL,
        Limits::default(),
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(network.requests(), [URL.to_owned(), format!("{URL}.sig")]);
    assert_eq!(scratch.workspaces().len(), 1);
    drop(prepared);
    assert!(scratch.workspaces().is_empty());
}

#[test]
fn unverified_workspace_debug_never_exposes_the_installer_path() {
    let scratch = Scratch::new();
    let workspace = scratch.factory().create().unwrap();
    let debug = format!("{workspace:?}");
    assert!(!debug.contains("nexo-install-"), "{debug}");
    assert!(!debug.contains("installer.exe"), "{debug}");
    drop(workspace);
    assert!(scratch.workspaces().is_empty());
}

#[test]
fn unmarked_owned_candidate_is_reported_and_never_deleted() {
    let scratch = Scratch::new();
    let candidate = scratch
        .0
        .join("nexo-install-00000000000000000000000000000000");
    fs::create_dir(&candidate).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&candidate, fs::Permissions::from_mode(0o700)).unwrap();
    }
    assert!(scratch.factory().cleanup_stale().is_err());
    assert!(candidate.exists());
}

#[test]
fn stale_cleanup_skips_live_and_unrelated_paths_and_removes_abandoned_workspaces() {
    let scratch = Scratch::new();
    let factory = scratch.factory();
    let active = factory.create().unwrap();
    let abandoned = factory.create().unwrap();
    abandoned.abandon_for_test();
    let mut paths = scratch.workspaces();
    paths.sort();
    assert_eq!(paths.len(), 2);
    let unrelated = scratch.0.join("unrelated");
    fs::create_dir(&unrelated).unwrap();
    fs::write(unrelated.join("keep"), b"keep").unwrap();
    let forged = scratch
        .0
        .join("nexo-install-00000000000000000000000000000000");
    fs::create_dir(&forged).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&forged, fs::Permissions::from_mode(0o700)).unwrap();
        std::os::unix::fs::symlink(
            &unrelated,
            scratch
                .0
                .join("nexo-install-11111111111111111111111111111111"),
        )
        .unwrap();
    }
    assert!(factory.cleanup_stale().is_err()); // the unmarked candidate is ambiguous
    assert_eq!(scratch.workspaces().len(), 2); // active plus unmarked unrelated directory
    assert!(forged.exists());
    assert_eq!(fs::read(unrelated.join("keep")).unwrap(), b"keep");
    drop(active);
    assert_eq!(scratch.workspaces(), [forged]);
}

#[cfg(unix)]
#[test]
fn inaccessible_owned_stale_workspace_reports_failure() {
    use std::os::unix::fs::PermissionsExt;
    let scratch = Scratch::new();
    let factory = scratch.factory();
    let workspace = factory.create().unwrap();
    let path = scratch.workspaces().pop().unwrap();
    workspace.abandon_for_test();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o0)).unwrap();
    let result = factory.cleanup_stale();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(
        result.is_err(),
        "inaccessible stale workspace must not be reported as clean"
    );
    assert!(path.exists());
    factory.cleanup_stale().unwrap();
    assert!(!path.exists());
}

#[cfg(unix)]
#[tokio::test]
async fn unprotected_temp_root_is_rejected_without_creating_workspace() {
    use std::os::unix::fs::PermissionsExt;
    let scratch = Scratch::new();
    fs::set_permissions(&scratch.0, fs::Permissions::from_mode(0o700)).unwrap();
    let unsafe_root = scratch.0.join("unsafe-root");
    fs::create_dir(&unsafe_root).unwrap();
    fs::set_permissions(&unsafe_root, fs::Permissions::from_mode(0o770)).unwrap();
    let factory = PrivateFactory::in_directory(unsafe_root.clone());
    let network = FakeNetwork::valid();
    let result = prepare(&network, &factory, &app(), Limits::default()).await;
    assert_eq!(
        result.unwrap_err().cause,
        PrepareFailure::Download(install_download::Failure::Storage)
    );
    assert!(network.requests().is_empty());
    assert_eq!(fs::read_dir(unsafe_root).unwrap().count(), 0);
}

#[cfg(windows)]
#[tokio::test]
async fn windows_verified_handle_denies_write_rename_and_delete_until_drop() {
    let scratch = Scratch::new();
    let verified = prepare(
        &FakeNetwork::valid(),
        &scratch.factory(),
        &app(),
        Limits::default(),
    )
    .await
    .unwrap();
    let path = verified.executable_path().to_owned();
    assert!(fs::write(&path, b"tampered").is_err());
    assert!(fs::rename(&path, path.with_file_name("other.exe")).is_err());
    assert!(fs::remove_file(&path).is_err());
    let directory = path.parent().unwrap();
    assert!(fs::rename(directory, directory.with_file_name("other-directory")).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"test");
    drop(verified);
    assert!(!path.exists());
}
