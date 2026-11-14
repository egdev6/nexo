//! Private temporary workspaces and verified installer handles.
//!
//! This stage does not authorize execution: the install transaction must still recheck the
//! catalog and installation state, and must retain the verified handle through process creation.
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::install_download::{
    self, Artifact, Limits, Network, Progress, StorageError, Workspace, WorkspaceFactory,
};
use crate::install_signature::{self, VerifyError};

const PREFIX: &str = "nexo-install-";
const MARKER: &str = ".nexo-workspace";
const MARKER_CONTENT: &[u8] = b"nexo-install-workspace-v1\n";
const INSTALLER: &str = "installer.exe";
const SIGNATURE: &str = "installer.sig";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PrepareFailure {
    Download(install_download::Failure),
    Verify(VerifyError),
    Storage,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PrepareError {
    pub cause: PrepareFailure,
    pub cleanup_failed: bool,
}

/// Factory rooted at the operating system's temporary directory.
pub struct PrivateFactory {
    root: PathBuf,
}

impl PrivateFactory {
    pub fn system() -> Self {
        Self {
            root: std::env::temp_dir(),
        }
    }

    #[cfg(test)]
    pub(crate) fn in_directory(root: PathBuf) -> Self {
        Self { root }
    }

    /// Remove only recognized, owned workspaces whose process lock is no longer held.
    pub fn cleanup_stale(&self) -> Result<(), StorageError> {
        self.cleanup_stale_inner().map_err(|_| StorageError)
    }

    fn cleanup_stale_inner(&self) -> io::Result<()> {
        let root = open_directory(&self.root)?;
        validate_root(&root)?;
        let _coordination = coordination_lock(&self.root)?;
        let mut failed = false;
        for entry in fs::read_dir(&self.root)? {
            let entry = match entry {
                Ok(entry) => entry,
                Err(_) => {
                    failed = true;
                    continue;
                }
            };
            let name = entry.file_name();
            if !name.to_str().is_some_and(is_workspace_name) {
                continue;
            }
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(_) => {
                    failed = true;
                    continue;
                }
            };
            if !metadata.is_dir() || !metadata_owned(&metadata) {
                continue;
            }
            let directory = match open_directory(&path) {
                Ok(directory) => directory,
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(_) => {
                    failed = true;
                    continue;
                }
            };
            if !owned_private_directory(&directory)? {
                continue;
            }
            // An unmarked directory is ambiguous, not proof that Nexo owns it. Leave it
            // untouched, but report it: creation might have crashed before writing the marker.
            let marker_path = path.join(MARKER);
            match fs::symlink_metadata(&marker_path) {
                Ok(metadata) if metadata.is_file() => {}
                _ => {
                    failed = true;
                    continue;
                }
            }
            let mut marker = match open_regular(&marker_path, false) {
                Ok(marker) => marker,
                Err(_) => {
                    failed = true;
                    continue;
                }
            };
            match marker.try_lock() {
                Ok(()) => {}
                Err(std::fs::TryLockError::WouldBlock) => continue,
                Err(_) => {
                    failed = true;
                    continue;
                }
            }
            let mut content = Vec::new();
            if (&mut marker).take(128).read_to_end(&mut content).is_err() {
                failed = true;
                continue;
            }
            if content != MARKER_CONTENT {
                failed = true;
                continue;
            }
            // Coordination excludes workspace creation/cleanup until removal completes. Close
            // both handles first: Windows cannot remove a directory with pending open children.
            drop(marker);
            drop(directory);
            if let Err(error) = fs::remove_dir_all(&path)
                && error.kind() != io::ErrorKind::NotFound
            {
                failed = true;
            }
        }
        if failed {
            Err(io::Error::other("workspace cleanup failed"))
        } else {
            Ok(())
        }
    }
}

/// A workspace deliberately exposes no executable path.
pub struct PrivateWorkspace {
    root: PathBuf,
    path: PathBuf,
    root_guard: Option<File>,
    directory_guard: Option<File>,
    marker: Option<File>,
    installer: Option<File>,
    signature: Option<File>,
    owned: bool,
}

impl std::fmt::Debug for PrivateWorkspace {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("PrivateWorkspace")
            .finish_non_exhaustive()
    }
}

impl WorkspaceFactory for PrivateFactory {
    type Workspace = PrivateWorkspace;

    fn create(&self) -> Result<Self::Workspace, StorageError> {
        create_workspace(&self.root).map_err(|_| StorageError)
    }

    fn create_for_download(&self) -> Result<Self::Workspace, install_download::DownloadError> {
        create_workspace(&self.root).map_err(|error| install_download::DownloadError {
            cause: install_download::Failure::Storage,
            cleanup_failed: error.cleanup_failed,
        })
    }
}

impl Workspace for PrivateWorkspace {
    async fn write(&mut self, artifact: Artifact, bytes: &[u8]) -> Result<(), StorageError> {
        let file = match artifact {
            Artifact::Installer => &mut self.installer,
            Artifact::Signature => &mut self.signature,
        };
        file.as_mut()
            .ok_or(StorageError)?
            .write_all(bytes)
            .map_err(|_| StorageError)
    }

    fn cleanup(&mut self) -> Result<(), StorageError> {
        self.cleanup_inner().map_err(|_| StorageError)
    }
}

impl PrivateWorkspace {
    fn cleanup_inner(&mut self) -> io::Result<()> {
        if !self.owned {
            return Ok(());
        }
        let _coordination = coordination_lock(&self.root)?;
        self.installer.take();
        self.signature.take();
        self.marker.take();
        self.directory_guard.take();
        match fs::remove_dir_all(&self.path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        self.owned = false;
        self.root_guard.take();
        Ok(())
    }

    fn open_for_verification(&mut self) -> io::Result<(File, Vec<u8>)> {
        // Close the one download writer before the one protected read-open. On Windows the
        // latter denies both writes and deletes until the verified handle is dropped.
        self.installer
            .take()
            .ok_or_else(|| io::Error::other("installer missing"))?;
        let mut signature = self
            .signature
            .take()
            .ok_or_else(|| io::Error::other("signature missing"))?;
        signature.seek(SeekFrom::Start(0))?;
        let mut signature_bytes = Vec::new();
        (&mut signature)
            .take(install_download::SIGNATURE_LIMIT + 1)
            .read_to_end(&mut signature_bytes)?;
        if signature_bytes.len() as u64 > install_download::SIGNATURE_LIMIT {
            return Err(io::Error::other("signature too large"));
        }
        drop(signature);
        Ok((open_installer(&self.path.join(INSTALLER))?, signature_bytes))
    }

    #[cfg(test)]
    pub(crate) fn abandon_for_test(mut self) {
        // Simulate a crash: release OS handles but leave the disk state behind.
        self.owned = false;
    }
}

impl Drop for PrivateWorkspace {
    fn drop(&mut self) {
        if self.cleanup_inner().is_err() {
            eprintln!("Could not clean the temporary download workspace");
        }
    }
}

/// A verified installer. Its path cannot be obtained from an unverified download.
///
/// ```compile_fail
/// use nexo_hub_lib::install_workspace::VerifiedInstaller;
/// let _unverified = VerifiedInstaller { path: std::path::PathBuf::new() };
/// ```
#[derive(Debug)]
pub struct VerifiedInstaller {
    path: PathBuf,
    file: Option<File>,
    workspace: Option<PrivateWorkspace>,
}

impl VerifiedInstaller {
    /// This path remains protected only while this value is alive.
    pub fn executable_path(&self) -> &Path {
        &self.path
    }
}

impl Drop for VerifiedInstaller {
    fn drop(&mut self) {
        self.file.take();
        self.workspace.take();
    }
}

/// Download and verify a catalog entry without executing it. The entry must come from the
/// native trusted v3 catalog; obtaining and refreshing that catalog is a separate boundary.
pub async fn download_verified<N: Network>(
    network: &N,
    factory: &PrivateFactory,
    app: &nexo_catalog::CatalogApp,
    limits: Limits,
    progress: impl FnMut(Progress),
) -> Result<VerifiedInstaller, PrepareError> {
    let key = app.updater_public_key.as_deref().ok_or(PrepareError {
        cause: PrepareFailure::Verify(VerifyError::MissingKey),
        cleanup_failed: false,
    })?;
    let prepared =
        install_download::download_pair(network, factory, &app.installer_url, limits, progress)
            .await
            .map_err(|error| PrepareError {
                cause: PrepareFailure::Download(error.cause),
                cleanup_failed: error.cleanup_failed,
            })?;
    let mut workspace = prepared.into_workspace();
    let verified = (|| {
        let (mut file, signature) = workspace
            .open_for_verification()
            .map_err(|_| PrepareFailure::Storage)?;
        install_signature::verify_reader(Some(key), &signature, &mut file)
            .map_err(PrepareFailure::Verify)?;
        Ok::<File, PrepareFailure>(file)
    })();
    match verified {
        Ok(file) => Ok(VerifiedInstaller {
            path: workspace.path.join(INSTALLER),
            file: Some(file),
            workspace: Some(workspace),
        }),
        Err(cause) => Err(PrepareError {
            cause,
            cleanup_failed: workspace.cleanup().is_err(),
        }),
    }
}

fn is_workspace_name(name: &str) -> bool {
    name.strip_prefix(PREFIX).is_some_and(|suffix| {
        suffix.len() == 32
            && suffix
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

fn random_name() -> io::Result<String> {
    let mut bytes = [0_u8; 16];
    rustls::crypto::ring::default_provider()
        .secure_random
        .fill(&mut bytes)
        .map_err(|_| io::Error::other("secure randomness unavailable"))?;
    let mut name = String::from(PREFIX);
    for byte in bytes {
        use std::fmt::Write as _;
        write!(&mut name, "{byte:02x}").expect("writing to a string cannot fail");
    }
    Ok(name)
}

struct CreateError {
    cleanup_failed: bool,
}

impl From<io::Error> for CreateError {
    fn from(_error: io::Error) -> Self {
        Self {
            cleanup_failed: false,
        }
    }
}

fn create_workspace(root: &Path) -> Result<PrivateWorkspace, CreateError> {
    let root_guard = open_directory(root)?;
    validate_root(&root_guard)?;
    let _coordination = coordination_lock(root)?;
    for _ in 0..16 {
        let path = root.join(random_name()?);
        #[cfg(unix)]
        let mut builder = fs::DirBuilder::new();
        #[cfg(not(unix))]
        let builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        match builder.create(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
        let result = (|| {
            let directory_guard = open_directory(&path)?;
            if !owned_private_directory(&directory_guard)? {
                return Err(io::Error::other("workspace is not private"));
            }
            let mut marker = open_regular(&path.join(MARKER), true)?;
            marker.lock()?;
            marker.write_all(MARKER_CONTENT)?;
            let installer = open_regular(&path.join(INSTALLER), true)?;
            let signature = open_regular(&path.join(SIGNATURE), true)?;
            Ok((directory_guard, marker, installer, signature))
        })();
        match result {
            Ok((directory_guard, marker, installer, signature)) => {
                return Ok(PrivateWorkspace {
                    root: root.to_owned(),
                    path,
                    root_guard: Some(root_guard),
                    directory_guard: Some(directory_guard),
                    marker: Some(marker),
                    installer: Some(installer),
                    signature: Some(signature),
                    owned: true,
                });
            }
            Err(_error) => {
                let cleanup_failed = fs::remove_dir_all(&path).is_err();
                if cleanup_failed {
                    eprintln!("Could not clean the temporary download workspace");
                }
                return Err(CreateError { cleanup_failed });
            }
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "workspace name collisions").into())
}

fn coordination_lock(root: &Path) -> io::Result<File> {
    let path = root.join(format!(
        ".nexo-install-coordination-{}.lock",
        current_user_id()?
    ));
    let file = match open_regular(&path, true) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => open_regular(&path, false)?,
        Err(error) => return Err(error),
    };
    file.lock()?;
    Ok(file)
}

fn open_regular(path: &Path, create: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(create);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path)?;
    if !regular_owned_file(&file)? {
        return Err(io::Error::other("unsafe temporary file"));
    }
    Ok(file)
}

fn open_installer(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
        };
        options
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ);
    }
    let file = options.open(path)?;
    if !regular_owned_file(&file)? {
        return Err(io::Error::other("unsafe installer"));
    }
    Ok(file)
}

fn open_directory(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows_sys::Win32::Storage::FileSystem::{
            FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ,
            FILE_SHARE_WRITE,
        };
        options
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE);
    }
    let file = options.open(path)?;
    if !file.metadata()?.is_dir() || is_reparse(&file)? {
        return Err(io::Error::other("unsafe temporary directory"));
    }
    Ok(file)
}

fn regular_owned_file(file: &File) -> io::Result<bool> {
    let metadata = file.metadata()?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return Ok(false);
        }
    }
    Ok(metadata.is_file() && !is_reparse(file)? && is_owned(file)?)
}

fn owned_private_directory(file: &File) -> io::Result<bool> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if file.metadata()?.mode() & 0o777 != 0o700 {
            return Ok(false);
        }
    }
    is_owned(file)
}

#[cfg(unix)]
fn validate_root(file: &File) -> io::Result<()> {
    use std::os::unix::fs::MetadataExt;
    let mode = file.metadata()?.mode();
    if mode & 0o022 != 0 && mode & libc::S_ISVTX == 0 {
        return Err(io::Error::other("unprotected temporary directory"));
    }
    Ok(())
}
#[cfg(windows)]
fn validate_root(file: &File) -> io::Result<()> {
    if !is_owned(file)? {
        return Err(io::Error::other(
            "temporary directory is not owned by the user",
        ));
    }
    Ok(())
}
#[cfg(unix)]
fn metadata_owned(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    // SAFETY: geteuid takes no pointers and has no failure case.
    metadata.uid() == unsafe { libc::geteuid() }
}
#[cfg(windows)]
fn metadata_owned(_metadata: &fs::Metadata) -> bool {
    true
}

#[cfg(unix)]
fn current_user_id() -> io::Result<String> {
    // SAFETY: geteuid takes no pointers and has no failure case.
    Ok(unsafe { libc::geteuid() }.to_string())
}
#[cfg(unix)]
fn is_owned(file: &File) -> io::Result<bool> {
    use std::os::unix::fs::MetadataExt;
    // SAFETY: geteuid takes no pointers and has no failure case.
    Ok(file.metadata()?.uid() == unsafe { libc::geteuid() })
}
#[cfg(unix)]
fn is_reparse(_file: &File) -> io::Result<bool> {
    Ok(false)
}

#[cfg(windows)]
fn current_user_id() -> io::Result<String> {
    tauri_plugin_nexo::current_user_sid()
}
#[cfg(windows)]
fn is_reparse(file: &File) -> io::Result<bool> {
    use std::os::windows::fs::MetadataExt;
    use windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_REPARSE_POINT;
    Ok(file.metadata()?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
}
#[cfg(windows)]
fn is_owned(file: &File) -> io::Result<bool> {
    use std::{os::windows::io::AsRawHandle, ptr};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{ConvertSidToStringSidW, GetSecurityInfo, SE_FILE_OBJECT},
            OWNER_SECURITY_INFORMATION,
        },
    };
    struct Local(*mut std::ffi::c_void);
    impl Drop for Local {
        fn drop(&mut self) {
            // SAFETY: the value was allocated by the corresponding Windows API.
            unsafe {
                LocalFree(self.0);
            }
        }
    }
    let mut owner = ptr::null_mut();
    let mut descriptor = ptr::null_mut();
    // SAFETY: file owns a valid handle; the output pointers are writable and optional fields are null.
    let status = unsafe {
        GetSecurityInfo(
            file.as_raw_handle().cast(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    let _descriptor = Local(descriptor);
    let mut raw = ptr::null_mut();
    // SAFETY: owner belongs to the live descriptor and raw is writable.
    if unsafe { ConvertSidToStringSidW(owner, &mut raw) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let _sid = Local(raw.cast());
    let mut length = 0;
    // SAFETY: ConvertSidToStringSidW returned a NUL-terminated Windows string.
    unsafe {
        while *raw.add(length) != 0 {
            length += 1;
        }
    }
    // SAFETY: the NUL-terminated string has length initialized UTF-16 code units.
    let sid = String::from_utf16(unsafe { std::slice::from_raw_parts(raw, length) })
        .map_err(|_| io::Error::other("invalid owner SID"))?;
    Ok(sid == current_user_id()?)
}
