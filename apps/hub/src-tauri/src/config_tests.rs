use super::{FileState, Patch, Source, Store};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    dir: PathBuf,
    store: Store,
}
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "nexo-settings-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).unwrap();
        let store = Store::new(dir.join("config.json"));
        Self { dir, store }
    }
    fn path(&self) -> PathBuf {
        self.dir.join("config.json")
    }
    fn write(&self, text: &str) {
        std::fs::write(self.path(), text).unwrap();
    }
    fn raw(&self) -> String {
        std::fs::read_to_string(self.path()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.dir).unwrap();
    }
}

#[test]
fn missing_file_uses_first_run_defaults_without_writing() {
    let f = Fixture::new();
    let snapshot = f.store.read();
    assert_eq!(snapshot.state, FileState::Missing);
    assert_eq!(snapshot.settings.language, "es");
    assert!(!snapshot.settings.start_with_windows);
    assert!(snapshot.settings.show_news_on_open);
    assert_eq!(snapshot.settings.accent, "#ff0036");
    assert!(!snapshot.settings.compact);
    assert_eq!(
        (snapshot.settings.opacity, snapshot.settings.blur),
        (85, 24)
    );
    assert!(!snapshot.settings.first_run_complete);
    assert_eq!(snapshot.settings.sources[0].id, "official");
    assert!(!f.path().exists());
}

#[test]
fn patches_round_trip_onboarding_appearance_news_and_ordered_sources() {
    let f = Fixture::new();
    let sources = vec![
        Source {
            id: "official".into(),
            label: "Catálogo oficial egdev".into(),
            kind: "official".into(),
            location: None,
        },
        Source {
            id: "local-1".into(),
            label: "Local".into(),
            kind: "local".into(),
            location: Some("C:\\local.json".into()),
        },
    ];
    let saved = f
        .store
        .patch(Patch {
            language: Some("en".into()),
            start_with_windows: Some(true),
            show_news_on_open: Some(false),
            accent: Some("#123456".into()),
            compact: Some(true),
            opacity: Some(0),
            blur: Some(40),
            first_run_complete: Some(true),
            sources: Some(sources.clone()),
            ..Default::default()
        })
        .unwrap();
    let reloaded = Store::new(f.path()).read();
    assert_eq!(reloaded.state, FileState::Ready);
    assert_eq!(reloaded.settings, saved);
    assert_eq!(saved.sources, sources);
    assert!(saved.first_run_complete);
    assert_eq!(
        (saved.language.as_str(), saved.opacity, saved.blur),
        ("en", 0, 40)
    );
    assert!(!saved.show_news_on_open);
}

#[test]
fn invalid_fields_are_tolerated_and_clamped_independently() {
    let f = Fixture::new();
    f.write(r##"{"version":1,"language":5,"showNewsOnOpen":false,"accent":"0F0","compact":true,"opacity":999,"blur":-10,"startWithWindows":"bad"}"##);
    let s = f.store.read();
    assert_eq!(s.state, FileState::Ready);
    assert_eq!(s.settings.language, "es");
    assert!(!s.settings.show_news_on_open);
    assert_eq!(s.settings.accent, "#00ff00");
    assert!(s.settings.compact);
    assert_eq!((s.settings.opacity, s.settings.blur), (100, 0));
    assert!(!s.settings.start_with_windows);
}

#[test]
fn partial_patches_preserve_unrelated_values_and_unknown_fields() {
    let f = Fixture::new();
    f.write(r##"{"version":1,"language":"en","compact":true,"futureField":{"kept":42}}"##);
    f.store
        .patch(Patch {
            opacity: Some(3),
            ..Default::default()
        })
        .unwrap();
    f.store
        .patch(Patch {
            blur: Some(12),
            ..Default::default()
        })
        .unwrap();
    let s = f.store.read().settings;
    assert_eq!(
        (s.language.as_str(), s.compact, s.opacity, s.blur),
        ("en", true, 3, 12)
    );
    assert!(f.raw().contains("futureField"));
    assert!(f.raw().contains("42"));
}

#[test]
fn unrelated_patch_preserves_future_metadata_inside_source_descriptors() {
    let f = Fixture::new();
    f.write(r#"{"version":1,"sources":[{"id":"official","label":"Catálogo oficial egdev","kind":"official","metadata":{"keep":42}}]}"#);
    f.store
        .patch(Patch {
            compact: Some(true),
            ..Default::default()
        })
        .unwrap();
    assert!(f.raw().contains("metadata"));
    assert!(f.raw().contains("42"));
    assert!(f.store.read().settings.compact);
}

#[test]
fn corrupt_file_is_protected_until_explicit_backed_up_recovery() {
    let f = Fixture::new();
    f.write("{ broken");
    assert_eq!(f.store.read().state, FileState::Corrupt);
    assert!(
        f.store
            .patch(Patch {
                compact: Some(true),
                ..Default::default()
            })
            .is_err()
    );
    assert_eq!(f.raw(), "{ broken");
    let recovered = f.store.recover().unwrap();
    assert_eq!(recovered.language, "es");
    assert_eq!(
        std::fs::read_to_string(f.dir.join("config.json.bak")).unwrap(),
        "{ broken"
    );
    assert_eq!(f.store.read().state, FileState::Ready);
}

#[test]
fn failed_backup_does_not_overwrite_corrupt_original() {
    let f = Fixture::new();
    f.write("{ broken");
    std::fs::write(f.dir.join("config.json.bak"), "existing backup").unwrap();
    assert!(f.store.recover().is_err());
    assert_eq!(f.raw(), "{ broken");
    assert_eq!(
        std::fs::read_to_string(f.dir.join("config.json.bak")).unwrap(),
        "existing backup"
    );
}

#[cfg(unix)]
#[test]
fn failed_write_keeps_the_original_file_unchanged() {
    use std::os::unix::fs::PermissionsExt;

    struct Restore(PathBuf, std::fs::Permissions);
    impl Drop for Restore {
        fn drop(&mut self) {
            std::fs::set_permissions(&self.0, self.1.clone()).unwrap();
        }
    }

    let f = Fixture::new();
    let raw = r#"{"version":1,"language":"en","compact":true}"#;
    f.write(raw);
    let permissions = std::fs::metadata(&f.dir).unwrap().permissions();
    let restore = Restore(f.dir.clone(), permissions);
    std::fs::set_permissions(&f.dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    let result = f.store.patch(Patch {
        compact: Some(false),
        ..Default::default()
    });
    drop(restore);
    assert!(result.is_err());
    assert_eq!(f.raw(), raw);
    assert!(f.store.read().settings.compact);
}

#[test]
fn future_version_stays_read_only_and_unchanged() {
    let f = Fixture::new();
    let raw = r#"{"version":999,"language":"en"}"#;
    f.write(raw);
    assert_eq!(f.store.read().state, FileState::Future);
    assert!(
        f.store
            .patch(Patch {
                language: Some("es".into()),
                ..Default::default()
            })
            .is_err()
    );
    assert!(f.store.recover().is_err());
    assert_eq!(f.raw(), raw);
}

#[test]
fn unreadable_path_is_not_treated_as_missing_or_overwritten() {
    let f = Fixture::new();
    std::fs::create_dir(f.path()).unwrap();
    assert_eq!(f.store.read().state, FileState::Unreadable);
    assert!(f.store.patch(Patch::default()).is_err());
    assert!(f.path().is_dir());
}

#[test]
fn synthetic_v0_migrates_on_save_without_losing_valid_values() {
    let f = Fixture::new();
    f.write(r#"{"version":0,"language":"en","compact":true,"unknown":12}"#);
    assert_eq!(f.store.read().settings.language, "en");
    let s = f
        .store
        .patch(Patch {
            opacity: Some(42),
            ..Default::default()
        })
        .unwrap();
    assert!(s.compact);
    assert_eq!(s.opacity, 42);
    assert!(f.raw().contains("\"version\": 2"));
    assert!(f.raw().contains("unknown"));
}

#[test]
fn v1_migrates_without_a_news_visit_and_preserves_existing_settings() {
    let f = Fixture::new();
    f.write(r##"{"version":1,"language":"en","showNewsOnOpen":false,"accent":"#123456","compact":true,"firstRunComplete":true,"unknown":42,"newsVisit":{"lastVisitAt":"2026-05-31T12:00:00Z","seenKeys":["a:old"]}}"##);
    let initial = f.store.read();
    assert_eq!(initial.state, FileState::Ready);
    let json = serde_json::to_value(&initial.settings).unwrap();
    assert!(json["newsVisit"].is_null());
    let saved = f.store.patch(Patch::default()).unwrap();
    assert_eq!(saved.language, "en");
    assert!(!saved.show_news_on_open);
    assert_eq!(saved.accent, "#123456");
    assert!(serde_json::to_value(&saved).unwrap()["newsVisit"].is_null());
    assert!(saved.compact && saved.first_run_complete);
    assert!(f.raw().contains("\"version\": 2"));
    assert!(f.raw().contains("unknown"));
}

#[test]
fn news_visit_round_trips_and_partial_settings_patches_preserve_it() {
    let f = Fixture::new();
    let patch: Patch = serde_json::from_value(serde_json::json!({"newsVisit": {
        "lastVisitAt": "2026-05-31T12:00:00Z", "seenKeys": ["a:one", "n:one:release"]
    }}))
    .unwrap();
    f.store.patch(patch).unwrap();
    f.store
        .patch(Patch {
            compact: Some(true),
            ..Default::default()
        })
        .unwrap();
    let reloaded = Store::new(f.path()).read();
    assert_eq!(reloaded.state, FileState::Ready);
    let json = serde_json::to_value(reloaded.settings).unwrap();
    assert_eq!(
        json["newsVisit"],
        serde_json::json!({
            "lastVisitAt": "2026-05-31T12:00:00Z", "seenKeys": ["a:one", "n:one:release"]
        })
    );
    assert_eq!(json["compact"], true);
}

#[test]
fn malformed_news_visit_is_tolerated_without_resetting_other_fields() {
    let f = Fixture::new();
    f.write(r#"{"version":2,"language":"en","newsVisit":{"lastVisitAt":5,"seenKeys":["a:one"]}}"#);
    let snapshot = f.store.read();
    assert_eq!(snapshot.state, FileState::Ready);
    let json = serde_json::to_value(snapshot.settings).unwrap();
    assert_eq!(json["language"], "en");
    assert!(json["newsVisit"].is_null());
}
