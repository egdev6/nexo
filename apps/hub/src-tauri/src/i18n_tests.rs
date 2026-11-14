use super::{Locale, Presentation, app_message, text};
use crate::ipc::{Hub, NoticeDetail, NoticeFailure, NoticeOutcome};
use serde_json::Value;
use std::{
    cell::{Cell, RefCell},
    collections::BTreeSet,
    sync::{Arc, Mutex, mpsc},
};

#[test]
fn shared_native_catalog_has_matching_nonempty_keys_and_placeholders() {
    let catalog: Value =
        serde_json::from_str(include_str!("../../src/i18n/messages.json")).unwrap();
    let es = catalog["es"]["native"].as_object().unwrap();
    let en = catalog["en"]["native"].as_object().unwrap();
    assert_eq!(
        es.keys().collect::<BTreeSet<_>>(),
        en.keys().collect::<BTreeSet<_>>()
    );
    for (key, value) in es {
        let spanish = value.as_str().unwrap();
        let english = en[key].as_str().unwrap();
        assert!(!spanish.trim().is_empty(), "es {key}");
        assert!(!english.trim().is_empty(), "en {key}");
        let placeholders = |value: &str| {
            value
                .split('{')
                .skip(1)
                .map(|part| part.split('}').next().unwrap().to_owned())
                .collect::<BTreeSet<_>>()
        };
        assert_eq!(placeholders(spanish), placeholders(english), "{key}");
        assert_eq!(text(Locale::Es, key), spanish);
        assert_eq!(text(Locale::En, key), english);
    }
    assert_eq!(text(Locale::Es, "quit"), "Salir");
    assert_eq!(text(Locale::En, "quit"), "Quit");
}

#[test]
fn app_detection_and_launch_messages_are_available_in_both_languages() {
    assert_eq!(
        text(Locale::Es, "appNoHint"),
        "Sin datos de detección en el catálogo"
    );
    assert_eq!(
        text(Locale::En, "appNoHint"),
        "No detection information in the catalog"
    );
    assert_eq!(
        text(Locale::En, "appUnsafeExe"),
        "The executable path is unsafe"
    );
    assert_eq!(
        text(Locale::En, "appLaunchRequested"),
        "Launch requested; execution is not confirmed"
    );
    assert_eq!(
        text(Locale::En, "appSpawnFailed"),
        "Could not start the app: {error}"
    );
}

#[test]
fn app_message_localizes_known_codes_and_keeps_external_diagnostics() {
    assert_eq!(
        app_message(Locale::En, "nexo.appNoHint"),
        "No detection information in the catalog"
    );
    assert_eq!(
        app_message(Locale::Es, "nexo.appSpawnFailed:disk full"),
        "No se pudo iniciar la app: disk full"
    );
    assert_eq!(
        app_message(Locale::En, "external refusal"),
        "external refusal"
    );
    assert_eq!(
        app_message(Locale::En, "nexo.appUnknown"),
        "nexo.appUnknown"
    );
}

#[test]
fn refresh_reads_latest_saved_language_and_rebuilds_with_retry_after_failure() {
    let state = Presentation::default();
    let saved = Cell::new(Locale::Es);
    let calls = RefCell::new(Vec::new());
    state
        .refresh(
            || saved.get(),
            |locale| {
                calls.borrow_mut().push(locale);
                Ok::<_, &str>(())
            },
        )
        .unwrap();
    saved.set(Locale::En);
    let error = state.refresh(
        || saved.get(),
        |locale| {
            calls.borrow_mut().push(locale);
            Err::<(), _>("tray failed")
        },
    );
    assert_eq!(error, Err("tray failed"));
    assert_eq!(saved.get(), Locale::En);
    state
        .refresh(
            || saved.get(),
            |locale| {
                calls.borrow_mut().push(locale);
                Ok::<_, &str>(())
            },
        )
        .unwrap();
    saved.set(Locale::Es);
    state
        .refresh(
            || saved.get(),
            |locale| {
                calls.borrow_mut().push(locale);
                Ok::<_, &str>(())
            },
        )
        .unwrap();
    assert_eq!(
        *calls.borrow(),
        vec![Locale::Es, Locale::En, Locale::En, Locale::Es]
    );
}

#[test]
fn concurrent_refreshes_read_after_the_previous_presentation_finishes() {
    let state = Arc::new(Presentation::default());
    let saved = Arc::new(Mutex::new(Locale::Es));
    let calls = Arc::new(Mutex::new(Vec::new()));
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first_state = state.clone();
    let first_saved = saved.clone();
    let first_calls = calls.clone();
    let first = std::thread::spawn(move || {
        first_state
            .refresh(
                || *first_saved.lock().unwrap(),
                |locale| {
                    entered_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    first_calls.lock().unwrap().push(locale);
                    Ok::<_, ()>(())
                },
            )
            .unwrap();
    });
    entered_rx.recv().unwrap();
    *saved.lock().unwrap() = Locale::En;
    let second_state = state.clone();
    let second_saved = saved.clone();
    let second_calls = calls.clone();
    let second = std::thread::spawn(move || {
        second_state
            .refresh(
                || *second_saved.lock().unwrap(),
                |locale| {
                    second_calls.lock().unwrap().push(locale);
                    Ok::<_, ()>(())
                },
            )
            .unwrap();
    });
    release_tx.send(()).unwrap();
    first.join().unwrap();
    second.join().unwrap();
    assert_eq!(*calls.lock().unwrap(), vec![Locale::Es, Locale::En]);
}

#[test]
fn structured_notices_localize_hub_copy_without_changing_refusal_data() {
    let detail = NoticeDetail::Quit {
        all: true,
        failures: vec![
            NoticeFailure {
                app: "Antena".into(),
                outcome: NoticeOutcome::Refused {
                    reason: Some("cambios sin guardar".into()),
                },
            },
            NoticeFailure {
                app: "Beta".into(),
                outcome: NoticeOutcome::Timeout,
            },
        ],
    };
    assert_eq!(
        detail.message(Locale::Es),
        "Nexo sigue abierto. Antena: cambios sin guardar; Beta: No respondió en 10 segundos"
    );
    assert_eq!(
        detail.message(Locale::En),
        "Nexo remains open. Antena: cambios sin guardar; Beta: No response within 10 seconds"
    );
    let hub = Hub::new();
    hub.set_notice_detail(detail, true);
    let snapshot = hub.snapshot();
    let notice = snapshot.notice.unwrap();
    assert!(notice.hub_only_allowed);
    let json = serde_json::to_value(notice).unwrap();
    assert_eq!(json["detail"]["kind"], "quit");
    assert_eq!(
        json["detail"]["failures"][0]["outcome"]["reason"],
        "cambios sin guardar"
    );
    let single = NoticeDetail::Quit {
        all: false,
        failures: vec![
            NoticeFailure {
                app: "A".into(),
                outcome: NoticeOutcome::Refused { reason: None },
            },
            NoticeFailure {
                app: "B".into(),
                outcome: NoticeOutcome::Unavailable,
            },
            NoticeFailure {
                app: "C".into(),
                outcome: NoticeOutcome::Disconnected,
            },
        ],
    };
    assert_eq!(
        single.message(Locale::En),
        "A: The app refused to close; B: The app cannot close or is unavailable; C: Connection lost; status unknown"
    );
    assert_eq!(
        NoticeDetail::ConnectionClosed.message(Locale::En),
        "Nexo's connection closed unexpectedly."
    );
    assert_eq!(
        text(Locale::Es, "trayFailure"),
        "No se pudo actualizar la bandeja; la conexión con las apps se cerró."
    );
}
