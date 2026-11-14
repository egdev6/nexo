#[cfg(windows)]
use crate::install_approval::{
    ApprovalDecision, ApprovalDialog, DialogInstallApproval, InstallApproval,
};
#[cfg(not(windows))]
use crate::install_approval::{ApprovalDecision, InstallApproval, NativeInstallApproval};
use crate::install_approval::{ApprovalRequest, approval_text};

fn request(language: &str) -> ApprovalRequest<'_> {
    ApprovalRequest {
        app_name: "Antena",
        version: "1.2.3",
        publisher_host: "github.com",
        language,
    }
}

#[test]
fn confirmation_substitutes_every_field_in_both_languages() {
    let en = approval_text(&request("en")).expect("English confirmation");
    assert_eq!(en.title, "Confirm installation");
    assert_eq!(
        en.body,
        "Download and install Antena version 1.2.3 from github.com?"
    );

    let es = approval_text(&request("es")).expect("Spanish confirmation");
    assert_eq!(es.title, "Confirmar instalación");
    assert_eq!(
        es.body,
        "¿Descargar e instalar Antena, versión 1.2.3, desde github.com?"
    );
}

#[test]
fn replacement_does_not_reinterpret_values_as_placeholders() {
    let text = approval_text(&ApprovalRequest {
        app_name: "App {host}",
        version: "v{app}",
        publisher_host: "github.com/{version}",
        language: "en",
    })
    .expect("confirmation");
    assert_eq!(
        text.body,
        "Download and install App {host} version v{app} from github.com/{version}?"
    );
}

#[test]
fn unknown_language_falls_back_to_english() {
    let english = approval_text(&request("en")).expect("English confirmation");
    for language in ["fr", "es-MX", ""] {
        assert_eq!(approval_text(&request(language)), Some(english.clone()));
    }
}

#[test]
fn translations_define_both_keys_with_required_placeholders() {
    let messages: serde_json::Value =
        serde_json::from_str(include_str!("../../src/i18n/messages.json")).unwrap();
    for language in ["en", "es"] {
        let confirm = &messages[language]["install"]["confirm"];
        for key in ["title", "body"] {
            let value = confirm[key].as_str().expect("confirmation key is a string");
            assert!(!value.is_empty(), "{language}.install.confirm.{key}");
        }
        let body = confirm["body"].as_str().unwrap();
        for placeholder in ["{app}", "{version}", "{host}"] {
            assert!(body.contains(placeholder), "{language}: {placeholder}");
        }
    }
}

#[test]
fn nul_in_displayed_values_is_rejected() {
    for (app_name, version, publisher_host) in [
        ("Antena\0other", "1.2.3", "github.com"),
        ("Antena", "1.2.3\0other", "github.com"),
        ("Antena", "1.2.3", "github.com\0other"),
    ] {
        assert_eq!(
            approval_text(&ApprovalRequest {
                app_name,
                version,
                publisher_host,
                language: "en",
            }),
            None
        );
    }
}

#[cfg(windows)]
struct DialogCall {
    body: Vec<u16>,
    title: Vec<u16>,
    flags: u32,
}

#[cfg(windows)]
struct FakeDialog {
    response: i32,
    calls: std::cell::RefCell<Vec<DialogCall>>,
}

#[cfg(windows)]
impl ApprovalDialog for FakeDialog {
    fn show(&self, body: &[u16], title: &[u16], flags: u32) -> i32 {
        self.calls.borrow_mut().push(DialogCall {
            body: body.to_vec(),
            title: title.to_vec(),
            flags,
        });
        self.response
    }
}

#[cfg(windows)]
#[test]
fn windows_dialog_approves_only_yes_and_uses_default_no() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IDCANCEL, IDNO, IDYES, MB_DEFBUTTON2, MB_ICONQUESTION, MB_SETFOREGROUND, MB_YESNO,
    };
    for (response, expected) in [
        (IDYES, ApprovalDecision::Approved),
        (IDNO, ApprovalDecision::Denied),
        (IDCANCEL, ApprovalDecision::Denied),
        (0, ApprovalDecision::Denied),
    ] {
        let approval = DialogInstallApproval {
            dialog: FakeDialog {
                response,
                calls: Default::default(),
            },
        };
        assert_eq!(approval.confirm(&request("en")), expected);
        let calls = approval.dialog.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0].body,
            "Download and install Antena version 1.2.3 from github.com?"
                .encode_utf16()
                .chain(Some(0))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            calls[0].title,
            "Confirm installation"
                .encode_utf16()
                .chain(Some(0))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            calls[0].flags,
            MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND | MB_DEFBUTTON2
        );
    }
}

#[cfg(windows)]
#[test]
fn windows_dialog_rejects_nul_before_showing_anything() {
    let approval = DialogInstallApproval {
        dialog: FakeDialog {
            response: windows_sys::Win32::UI::WindowsAndMessaging::IDYES,
            calls: Default::default(),
        },
    };
    assert_eq!(
        approval.confirm(&ApprovalRequest {
            app_name: "Antena\0other",
            ..request("en")
        }),
        ApprovalDecision::Denied
    );
    assert!(approval.dialog.calls.borrow().is_empty());
}

#[cfg(not(windows))]
#[test]
fn native_approval_always_denies_on_non_windows() {
    for language in ["en", "es", "unknown"] {
        assert_eq!(
            NativeInstallApproval.confirm(&request(language)),
            ApprovalDecision::Denied
        );
    }
}
