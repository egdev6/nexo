use super::{Entry, Registry};
use std::io::ErrorKind;
use windows_sys::{
    Wdk::System::Registry::{KeyNameInformation, NtQueryKey},
    Win32::Globalization::{CSTR_EQUAL, CompareStringOrdinal},
};
use winreg::{
    HKCU, RegKey,
    enums::{KEY_READ, KEY_WOW64_32KEY, KEY_WOW64_64KEY, REG_SZ},
};

pub(super) struct CurrentUserRegistry;

fn resolve_path(location: &str, relative: &str) -> Result<std::path::PathBuf, String> {
    use std::os::windows::fs::MetadataExt;
    use std::path::{Component, Path, Prefix};
    let location = if let Some(quoted) = location.strip_prefix('"') {
        quoted
            .strip_suffix('"')
            .ok_or("La ubicación contiene comillas no equilibradas")?
    } else {
        location
    };
    if location.contains('"') {
        return Err("La ubicación contiene comillas inválidas".into());
    }
    let directory = Path::new(location);
    let mut components = directory.components();
    if !matches!(components.next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_)))
        || !matches!(components.next(), Some(Component::RootDir))
        || components.any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("La ubicación no es una ruta local absoluta segura".into());
    }
    let relative = Path::new(relative);
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        || !relative
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
    {
        return Err("La ruta del ejecutable no es segura".into());
    }
    let executable = directory.join(relative);
    for path in executable.ancestors() {
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|_| "No se puede acceder a la ubicación del ejecutable".to_string())?;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("La ruta contiene un enlace o punto de análisis".into());
        }
    }
    if !std::fs::metadata(directory)
        .map_err(|error| error.to_string())?
        .is_dir()
        || !std::fs::metadata(&executable)
            .map_err(|error| error.to_string())?
            .is_file()
    {
        return Err("No hay un ejecutable normal en la ubicación".into());
    }
    let base = std::fs::canonicalize(directory).map_err(|error| error.to_string())?;
    let executable = std::fs::canonicalize(executable).map_err(|error| error.to_string())?;
    if !executable.starts_with(&base) {
        return Err("El ejecutable está fuera de la instalación".into());
    }
    Ok(executable)
}

pub(super) struct SystemLauncher<'a> {
    pub hub: &'a crate::ipc::Hub,
    pub id: &'a str,
}

impl super::Launcher for SystemLauncher<'_> {
    fn resolve(&self, location: &str, relative: &str) -> Result<std::path::PathBuf, String> {
        resolve_path(location, relative)
    }

    fn launch(
        &self,
        executable: &std::path::Path,
        location: &str,
        relative: &str,
    ) -> Result<(), String> {
        use std::os::windows::process::CommandExt;
        self.hub.while_disconnected(self.id, || {
            let fresh = resolve_path(location, relative)?;
            if fresh != executable {
                return Err("La ubicación cambió; vuelve a intentar".into());
            }
            // Hard links are accepted; same-user replacement remains possible between
            // revalidation and spawn. Name, publisher and path do not authenticate a publisher.
            std::process::Command::new(fresh)
                .creation_flags(0x0000_0008 | 0x0000_0200)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map(|_| ())
                .map_err(|error| format!("No se pudo iniciar la app: {error}"))
        })
    }
}

fn value(key: &RegKey, name: &str) -> Result<Option<String>, String> {
    let raw = match key.get_raw_value(name) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if raw.vtype != REG_SZ || raw.bytes.len() > 65536 || !raw.bytes.len().is_multiple_of(2) {
        return Ok(None);
    }
    let mut words: Vec<u16> = raw
        .bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .collect();
    while words.last() == Some(&0) {
        words.pop();
    }
    Ok(String::from_utf16(&words).ok())
}

// The object manager's resolved key name distinguishes redirected views while
// identifying a shared physical key when both WOW64 views resolve to it.
fn physical_key(key: &RegKey) -> Result<String, String> {
    let mut needed = 0_u32;
    unsafe {
        NtQueryKey(
            key.raw_handle(),
            KeyNameInformation,
            std::ptr::null_mut(),
            0,
            &mut needed,
        );
    }
    if !(4..=65536).contains(&needed) {
        return Err("No se pudo identificar la entrada del registro".into());
    }
    let mut storage = vec![0_u32; (needed as usize).div_ceil(4)];
    let status = unsafe {
        NtQueryKey(
            key.raw_handle(),
            KeyNameInformation,
            storage.as_mut_ptr().cast(),
            needed,
            &mut needed,
        )
    };
    if status < 0 {
        return Err("No se pudo identificar la entrada del registro".into());
    }
    let bytes = storage[0] as usize;
    if !bytes.is_multiple_of(2) || bytes > (storage.len() - 1) * 4 {
        return Err("Nombre de entrada inválido".into());
    }
    let words =
        unsafe { std::slice::from_raw_parts(storage.as_ptr().add(1).cast::<u16>(), bytes / 2) };
    String::from_utf16(words).map_err(|_| "Nombre de entrada inválido".into())
}

impl Registry for CurrentUserRegistry {
    fn scan(&self) -> Result<Vec<Entry>, String> {
        const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
        let mut entries = Vec::new();
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            let root = match HKCU.open_subkey_with_flags(UNINSTALL, KEY_READ | view) {
                Ok(key) => key,
                Err(error) if error.kind() == ErrorKind::NotFound => continue,
                Err(error) => return Err(error.to_string()),
            };
            for name in root.enum_keys() {
                let name = name.map_err(|error| error.to_string())?;
                let key = root
                    .open_subkey_with_flags(&name, KEY_READ | view)
                    .map_err(|error| error.to_string())?;
                entries.push(Entry {
                    physical_key: physical_key(&key)?,
                    display_name: value(&key, "DisplayName")?,
                    publisher: value(&key, "Publisher")?,
                    version: value(&key, "DisplayVersion")?,
                    install_location: value(&key, "InstallLocation")?,
                    display_icon: value(&key, "DisplayIcon")?,
                });
            }
        }
        Ok(entries)
    }

    fn equal(&self, left: &str, right: &str) -> bool {
        let left: Vec<u16> = left.encode_utf16().collect();
        let right: Vec<u16> = right.encode_utf16().collect();
        let (Ok(left_len), Ok(right_len)) = (i32::try_from(left.len()), i32::try_from(right.len()))
        else {
            return false;
        };
        unsafe {
            CompareStringOrdinal(left.as_ptr(), left_len, right.as_ptr(), right_len, 1)
                == CSTR_EQUAL
        }
    }
}

#[cfg(test)]
mod path_tests {
    use super::resolve_path;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "nexo-vp-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).unwrap();
        }
    }

    #[test]
    fn resolves_only_a_real_executable_beneath_an_absolute_local_installation() {
        let dir = Scratch::new();
        std::fs::create_dir(dir.0.join("bin")).unwrap();
        std::fs::write(dir.0.join("bin").join("App.exe"), b"fixture").unwrap();
        let location = dir.0.to_str().unwrap();
        assert_eq!(
            resolve_path(location, r"bin\App.exe").unwrap(),
            std::fs::canonicalize(dir.0.join("bin").join("App.exe")).unwrap()
        );
        for relative in [
            r"..\other.exe",
            r"C:\other.exe",
            r"\\server\share\other.exe",
            r"missing.exe",
            r"bin",
        ] {
            assert!(resolve_path(location, relative).is_err(), "{relative}");
        }
        assert!(resolve_path(r"\\server\share", "App.exe").is_err());
        assert!(resolve_path("relative", "App.exe").is_err());
    }

    #[test]
    fn resolves_the_quoted_install_location_written_by_tauri_nsis() {
        let dir = Scratch::new();
        std::fs::write(dir.0.join("App.exe"), b"fixture").unwrap();
        let quoted = format!("\"{}\"", dir.0.display());
        assert_eq!(
            resolve_path(&quoted, "App.exe").unwrap(),
            std::fs::canonicalize(dir.0.join("App.exe")).unwrap()
        );
        assert!(resolve_path(&format!("\"{}", dir.0.display()), "App.exe").is_err());
        assert!(resolve_path(&format!("{}\"", dir.0.display()), "App.exe").is_err());
        assert!(resolve_path(&format!("\"\"{}\"\"", dir.0.display()), "App.exe").is_err());
        assert!(resolve_path(&quoted, r"..\App.exe").is_err());
        assert!(resolve_path(r#""\\server\share""#, "App.exe").is_err());
    }

    #[test]
    fn refuses_a_junction_escape_beneath_the_installation() {
        let outside = Scratch::new();
        std::fs::write(outside.0.join("App.exe"), b"fixture").unwrap();
        let install = Scratch::new();
        let link = install.0.join("bin");
        assert!(
            std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(&link)
                .arg(&outside.0)
                .stdout(std::process::Stdio::null())
                .status()
                .unwrap()
                .success()
        );
        let result = resolve_path(install.0.to_str().unwrap(), r"bin\App.exe");
        std::fs::remove_dir(&link).unwrap();
        assert!(result.is_err());
    }
}
