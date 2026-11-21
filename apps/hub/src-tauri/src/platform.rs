/// Map Rust target identifiers to Tauri updater platform keys.
pub(crate) fn key_for(os: &str, arch: &str) -> Option<String> {
    let os = match os {
        "windows" => "windows",
        "macos" => "darwin",
        "linux" => "linux",
        _ => return None,
    };
    let arch = match arch {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        "x86" => "i686",
        "arm" => "armv7",
        _ => return None,
    };
    Some(format!("{os}-{arch}"))
}

#[tauri::command]
pub(crate) fn platform_key() -> Option<String> {
    key_for(std::env::consts::OS, std::env::consts::ARCH)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_every_supported_os_and_architecture_and_rejects_unknown_targets() {
        for (os, target_os) in [
            ("windows", "windows"),
            ("macos", "darwin"),
            ("linux", "linux"),
        ] {
            for (arch, target_arch) in [
                ("x86_64", "x86_64"),
                ("aarch64", "aarch64"),
                ("x86", "i686"),
                ("arm", "armv7"),
            ] {
                assert_eq!(
                    key_for(os, arch),
                    Some(format!("{target_os}-{target_arch}"))
                );
            }
        }
        for (os, arch) in [
            ("freebsd", "x86_64"),
            ("darwin", "x86_64"),
            ("linux", "riscv64"),
            ("", ""),
        ] {
            assert_eq!(key_for(os, arch), None);
        }
        assert_eq!(
            platform_key(),
            key_for(std::env::consts::OS, std::env::consts::ARCH)
        );
    }
}
