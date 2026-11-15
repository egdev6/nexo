// Policy boundary: the system opener is injected so tests never launch a browser.
fn open_with(url: &str, opener: impl FnOnce(&str) -> Result<(), String>) -> Result<(), String> {
    let refused = || "nexo.external.refused".to_owned();
    if url.chars().any(char::is_control) || url.contains('\\') {
        return Err(refused());
    }
    let (_, remainder) = url.split_once("://").ok_or_else(refused)?;
    let authority = remainder
        .split(['/', '?', '#'])
        .next()
        .ok_or_else(refused)?;
    // Url normalizes default ports and empty credentials away, so reject them
    // in the original authority before using the parsed, canonical URL.
    if authority.is_empty() || authority.contains(['@', ':']) {
        return Err(refused());
    }
    let parsed = url::Url::parse(url).map_err(|_| refused())?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
    {
        return Err(refused());
    }
    match parsed.host_str() {
        Some("github.com")
            if parsed
                .path()
                .strip_prefix("/egdev6/")
                .is_some_and(|rest| !rest.is_empty()) => {}
        Some("www.youtube.com" | "youtube.com") => {}
        _ => return Err(refused()),
    }
    opener(parsed.as_str())
}

#[cfg(windows)]
#[tauri::command]
pub(crate) fn open_external(window: tauri::WebviewWindow, url: String) -> Result<(), String> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    if window.label() != "main" {
        return Err("nexo.external.refused".into());
    }
    open_with(&url, |url| {
        let wide: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        // SAFETY: the canonical URL is a NUL-terminated UTF-16 string; all
        // optional parameters are null and Windows consumes it synchronously.
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                std::ptr::null(),
                wide.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if result as isize > 32 {
            Ok(())
        } else {
            Err("nexo.external.openFailed".into())
        }
    })
}

#[cfg(test)]
mod tests {
    use super::open_with;
    use std::cell::RefCell;

    #[test]
    fn approved_https_urls_are_normalized_then_opened_once() {
        for (input, expected) in [
            (
                "HTTPS://GITHUB.COM/egdev6/nexo",
                "https://github.com/egdev6/nexo",
            ),
            (
                "https://github.com/egdev6/nexo/releases/tag/v1.2.3",
                "https://github.com/egdev6/nexo/releases/tag/v1.2.3",
            ),
            (
                "https://www.youtube.com/@egdev",
                "https://www.youtube.com/@egdev",
            ),
            (
                "https://youtube.com/watch?v=abc",
                "https://youtube.com/watch?v=abc",
            ),
        ] {
            let opened = RefCell::new(Vec::new());
            assert_eq!(
                open_with(input, |url| {
                    opened.borrow_mut().push(url.to_owned());
                    Ok(())
                }),
                Ok(())
            );
            assert_eq!(*opened.borrow(), [expected]);
        }
    }

    #[test]
    fn rejects_untrusted_scheme_host_userinfo_port_and_path_without_opening() {
        for input in [
            "http://github.com/egdev6/nexo",
            "https://evil.example/egdev6/nexo",
            "https://github.com.evil.example/egdev6/nexo",
            "https://github.com/other/nexo",
            "https://github.com/egdev6evil/nexo",
            "https://github.com/egdev6/",
            "https://github.com:443/egdev6/nexo",
            "https://github.com:8443/egdev6/nexo",
            "https://user@github.com/egdev6/nexo",
            "https://@github.com/egdev6/nexo",
            "https://youtube.com:443/watch",
            "https://youtube.com.evil.example/watch",
            "https://github.com/egdev6/\nhello",
            "file:///C:/secret",
            "not a url",
        ] {
            let opened = RefCell::new(Vec::new());
            assert_eq!(
                open_with(input, |url| {
                    opened.borrow_mut().push(url.to_owned());
                    Ok(())
                }),
                Err("nexo.external.refused".into()),
                "{input:?}"
            );
            assert!(opened.borrow().is_empty(), "{input:?}");
        }
    }

    #[test]
    fn reports_system_opener_failure() {
        assert_eq!(
            open_with("https://youtube.com/watch", |_| Err(
                "nexo.external.openFailed".into()
            )),
            Err("nexo.external.openFailed".into())
        );
    }
}
