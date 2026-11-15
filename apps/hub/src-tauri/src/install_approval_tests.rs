#[cfg(windows)]
use crate::install_approval::{
    ApprovalDecision, ApprovalDialog, DialogInstallApproval, InstallApproval,
};
#[cfg(not(windows))]
use crate::install_approval::{ApprovalDecision, InstallApproval, NativeInstallApproval};
use crate::install_approval::{ApprovalRequest, approval_text, update_approval_text};

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
fn update_confirmation_shows_both_versions_and_host_in_both_languages() {
    let en = update_approval_text(&request("en"), "1.0.0").expect("English update");
    assert_eq!(en.title, "Confirm update");
    assert_eq!(
        en.body,
        "Download and update Antena: 1.0.0 → 1.2.3 from github.com?"
    );
    let es = update_approval_text(&request("es"), "1.0.0").expect("Spanish update");
    assert_eq!(es.title, "Confirmar actualización");
    assert_eq!(
        es.body,
        "¿Descargar y actualizar Antena: 1.0.0 → 1.2.3 desde github.com?"
    );
    assert_eq!(update_approval_text(&request("unknown"), "1.0.0"), Some(en));
}

#[test]
fn update_confirmation_preserves_values_and_rejects_nul() {
    let injected = ApprovalRequest {
        app_name: "App {currentVersion}",
        version: "{host}",
        publisher_host: "github.com/{version}",
        language: "en",
    };
    let text = update_approval_text(&injected, "{app}").unwrap();
    assert_eq!(
        text.body,
        "Download and update App {currentVersion}: {app} → {host} from github.com/{version}?"
    );
    for bad in [
        ApprovalRequest {
            app_name: "app\0",
            ..request("en")
        },
        ApprovalRequest {
            version: "1.2.3\0",
            ..request("en")
        },
        ApprovalRequest {
            publisher_host: "github.com\0",
            ..request("en")
        },
    ] {
        assert_eq!(update_approval_text(&bad, "1.0.0"), None);
    }
    assert_eq!(update_approval_text(&request("en"), "1.0.0\0"), None);
}

#[test]
fn update_translation_keys_include_all_required_placeholders() {
    let messages: serde_json::Value =
        serde_json::from_str(include_str!("../../src/i18n/messages.json")).unwrap();
    for language in ["en", "es"] {
        let confirm = &messages[language]["update"]["confirm"];
        assert!(!confirm["title"].as_str().unwrap().is_empty());
        let body = confirm["body"].as_str().unwrap();
        for placeholder in ["{app}", "{currentVersion}", "{version}", "{host}"] {
            assert!(body.contains(placeholder), "{language}: {placeholder}");
        }
    }
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
fn windows_update_dialog_uses_default_no_and_rejects_invalid_text() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IDNO, IDYES, MB_DEFBUTTON2, MB_ICONQUESTION, MB_SETFOREGROUND, MB_YESNO,
    };
    for (response, expected) in [
        (IDYES, ApprovalDecision::Approved),
        (IDNO, ApprovalDecision::Denied),
    ] {
        let approval = DialogInstallApproval {
            dialog: FakeDialog {
                response,
                calls: Default::default(),
            },
        };
        assert_eq!(approval.confirm_update(&request("en"), "1.0.0"), expected);
        let calls = approval.dialog.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0].title,
            "Confirm update"
                .encode_utf16()
                .chain(Some(0))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            calls[0].body,
            "Download and update Antena: 1.0.0 → 1.2.3 from github.com?"
                .encode_utf16()
                .chain(Some(0))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            calls[0].flags,
            MB_YESNO | MB_ICONQUESTION | MB_SETFOREGROUND | MB_DEFBUTTON2
        );
        drop(calls);
        assert_eq!(
            approval.confirm_update(&request("en"), "1.0.0\0"),
            ApprovalDecision::Denied
        );
        assert_eq!(approval.dialog.calls.borrow().len(), 1);
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
