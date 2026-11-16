//! Native approval for a selected installation; the caller owns selection and revalidation.
//!
//! A decision alone is not a one-shot authorization: the caller must bind it to the
//! selected app and release, serialize the operation, and revalidate before spawning.

#[derive(Debug)]
pub struct ApprovalRequest<'a> {
    pub app_name: &'a str,
    pub version: &'a str,
    pub publisher_host: &'a str,
    pub language: &'a str,
    pub installation_unknown: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalDecision {
    Approved,
    Denied,
}

pub trait InstallApproval {
    fn confirm(&self, req: &ApprovalRequest<'_>) -> ApprovalDecision;

    fn confirm_update(
        &self,
        _req: &ApprovalRequest<'_>,
        _current_version: &str,
    ) -> ApprovalDecision {
        ApprovalDecision::Denied
    }
}

pub struct NativeInstallApproval;

#[cfg(windows)]
pub trait ApprovalDialog {
    fn show(&self, body: &[u16], title: &[u16], flags: u32) -> i32;
}

#[cfg(windows)]
pub struct DialogInstallApproval<D> {
    pub dialog: D,
}

#[cfg(windows)]
impl<D: ApprovalDialog> InstallApproval for DialogInstallApproval<D> {
    fn confirm(&self, req: &ApprovalRequest<'_>) -> ApprovalDecision {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            IDYES, MB_DEFBUTTON2, MB_ICONQUESTION, MB_SETFOREGROUND, MB_YESNO,
        };

        let Some(text) = approval_text(req) else {
            return ApprovalDecision::Denied;
        };
        let title: Vec<u16> = text.title.encode_utf16().chain(Some(0)).collect();
        let body: Vec<u16> = text.body.encode_utf16().chain(Some(0)).collect();
        let response = self.dialog.show(
            &body,
            &title,
            MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND | MB_DEFBUTTON2,
        );
        if response == IDYES {
            ApprovalDecision::Approved
        } else {
            ApprovalDecision::Denied
        }
    }

    fn confirm_update(&self, req: &ApprovalRequest<'_>, current_version: &str) -> ApprovalDecision {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            IDYES, MB_DEFBUTTON2, MB_ICONQUESTION, MB_SETFOREGROUND, MB_YESNO,
        };

        let Some(text) = update_approval_text(req, current_version) else {
            return ApprovalDecision::Denied;
        };
        let title: Vec<u16> = text.title.encode_utf16().chain(Some(0)).collect();
        let body: Vec<u16> = text.body.encode_utf16().chain(Some(0)).collect();
        let response = self.dialog.show(
            &body,
            &title,
            MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND | MB_DEFBUTTON2,
        );
        if response == IDYES {
            ApprovalDecision::Approved
        } else {
            ApprovalDecision::Denied
        }
    }
}

#[cfg(windows)]
struct WindowsDialog;

#[cfg(windows)]
impl ApprovalDialog for WindowsDialog {
    fn show(&self, body: &[u16], title: &[u16], flags: u32) -> i32 {
        use windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW;

        // The caller supplies NUL-terminated buffers without interior NULs; both outlive the call.
        unsafe { MessageBoxW(std::ptr::null_mut(), body.as_ptr(), title.as_ptr(), flags) }
    }
}

#[cfg(windows)]
impl InstallApproval for NativeInstallApproval {
    fn confirm(&self, req: &ApprovalRequest<'_>) -> ApprovalDecision {
        DialogInstallApproval {
            dialog: WindowsDialog,
        }
        .confirm(req)
    }

    fn confirm_update(&self, req: &ApprovalRequest<'_>, current_version: &str) -> ApprovalDecision {
        DialogInstallApproval {
            dialog: WindowsDialog,
        }
        .confirm_update(req, current_version)
    }
}

#[cfg(not(windows))]
impl InstallApproval for NativeInstallApproval {
    fn confirm(&self, _req: &ApprovalRequest<'_>) -> ApprovalDecision {
        ApprovalDecision::Denied
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ApprovalText {
    pub title: String,
    pub body: String,
}

pub fn update_approval_text(
    req: &ApprovalRequest<'_>,
    current_version: &str,
) -> Option<ApprovalText> {
    if [
        req.app_name,
        req.version,
        req.publisher_host,
        current_version,
    ]
    .iter()
    .any(|value| value.contains('\0'))
    {
        return None;
    }
    let messages: serde_json::Value =
        serde_json::from_str(include_str!("../../src/i18n/messages.json")).ok()?;
    let language = if req.language == "es" { "es" } else { "en" };
    let confirm = messages.get(language)?.get("update")?.get("confirm")?;
    let title = confirm.get("title")?.as_str()?;
    let body = confirm.get("body")?.as_str()?;
    if title.is_empty()
        || !["{app}", "{currentVersion}", "{version}", "{host}"]
            .iter()
            .all(|placeholder| body.contains(placeholder))
    {
        return None;
    }
    // Render each template segment before inserting the current version: no supplied
    // value is reinterpreted as a placeholder.
    let render_update = |template: &str| {
        template
            .split("{currentVersion}")
            .map(|part| render(part, req))
            .collect::<Vec<_>>()
            .join(current_version)
    };
    let text = ApprovalText {
        title: render_update(title),
        body: render_update(body),
    };
    if text.title.contains('\0') || text.body.contains('\0') {
        return None;
    }
    Some(text)
}

pub fn approval_text(req: &ApprovalRequest<'_>) -> Option<ApprovalText> {
    if [req.app_name, req.version, req.publisher_host]
        .iter()
        .any(|value| value.contains('\0'))
    {
        return None;
    }
    let messages: serde_json::Value =
        serde_json::from_str(include_str!("../../src/i18n/messages.json")).ok()?;
    let language = if req.language == "es" { "es" } else { "en" };
    let confirm = messages.get(language)?.get("install")?.get("confirm")?;
    let title = confirm.get("title")?.as_str()?;
    let body = confirm.get("body")?.as_str()?;
    if title.is_empty()
        || !["{app}", "{version}", "{host}"]
            .iter()
            .all(|placeholder| body.contains(placeholder))
    {
        return None;
    }
    let mut text = ApprovalText {
        title: render(title, req),
        body: render(body, req),
    };
    if req.installation_unknown {
        let warning = confirm.get("unknownWarning")?.as_str()?;
        if warning.is_empty() {
            return None;
        }
        text.body.push('\n');
        text.body.push_str(warning);
    }
    if text.title.contains('\0') || text.body.contains('\0') {
        return None;
    }
    Some(text)
}

fn render(template: &str, req: &ApprovalRequest<'_>) -> String {
    let mut rest = template;
    let mut output = String::with_capacity(template.len());
    while let Some(start) = rest.find('{') {
        output.push_str(&rest[..start]);
        rest = &rest[start..];
        let replacement = [
            ("{app}", req.app_name),
            ("{version}", req.version),
            ("{host}", req.publisher_host),
        ]
        .into_iter()
        .find(|(placeholder, _)| rest.starts_with(placeholder));
        if let Some((placeholder, value)) = replacement {
            output.push_str(value);
            rest = &rest[placeholder.len()..];
        } else {
            output.push('{');
            rest = &rest[1..];
        }
    }
    output.push_str(rest);
    output
}
