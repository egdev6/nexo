use nexo_catalog::Catalog;

#[cfg(windows)]
pub(crate) mod windows;

#[cfg(windows)]
#[tauri::command]
pub(crate) async fn close_connected_app(
    app: tauri::AppHandle,
    id: String,
    hub: tauri::State<'_, crate::ipc::Hub>,
) -> Result<(), String> {
    let locale = crate::config::bootstrap_locale(&app);
    let hub = hub.inner().clone();
    let entry = hub
        .snapshot()
        .apps
        .into_iter()
        .find(|entry| entry.app.id == id)
        .filter(|entry| {
            entry.responsive
                && entry
                    .capabilities
                    .contains(&nexo_protocol::Capability::Quit)
        })
        .ok_or_else(|| crate::i18n::text(locale, "appCloseUnavailable").to_string())?;
    match crate::runtime::reason(hub.quit_responsive(&id, entry.generation).await) {
        Some(crate::ipc::NoticeOutcome::Refused { reason }) => {
            Err(reason.unwrap_or_else(|| crate::i18n::text(locale, "refused").to_owned()))
        }
        Some(crate::ipc::NoticeOutcome::Timeout) => {
            Err(crate::i18n::text(locale, "timeout").into())
        }
        Some(crate::ipc::NoticeOutcome::Unavailable) => {
            Err(crate::i18n::text(locale, "unavailable").into())
        }
        Some(crate::ipc::NoticeOutcome::Disconnected) => {
            Err(crate::i18n::text(locale, "disconnected").into())
        }
        None => Ok(()),
    }
}

#[cfg(windows)]
fn official_catalog(app: tauri::AppHandle) -> Result<Catalog, String> {
    let text = match crate::catalog_cache::read_catalog_v2_cache(app.clone())? {
        Some(text) => text,
        None => crate::catalog_cache::read_catalog_cache(app)?
            .ok_or_else(|| "nexo.appNoCatalog".to_string())?,
    };
    nexo_catalog::parse_catalog(&text).map_err(|error| error.to_string())
}

#[cfg(windows)]
#[tauri::command]
pub(crate) async fn open_official_app(
    app: tauri::AppHandle,
    id: String,
    hub: tauri::State<'_, crate::ipc::Hub>,
) -> Result<String, String> {
    let locale = crate::config::bootstrap_locale(&app);
    let catalog =
        official_catalog(app).map_err(|error| crate::i18n::app_message(locale, &error))?;
    if !catalog.apps.iter().any(|app| app.id == id) {
        return Err(crate::i18n::text(locale, "appNotOfficial").into());
    }
    let hub = hub.inner().clone();
    if let Some(entry) = hub
        .snapshot()
        .apps
        .into_iter()
        .find(|entry| entry.app.id == id)
    {
        if !entry.responsive || !hub.show_responsive(&id, entry.generation) {
            return Err(crate::i18n::text(locale, "appUnresponsiveShow").into());
        }
        return Ok(crate::i18n::text(locale, "appShowRequested").into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        open_official(
            &catalog,
            &windows::CurrentUserRegistry,
            &windows::SystemLauncher { hub: &hub, id: &id },
            &id,
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| crate::i18n::app_message(locale, &error))?;
    Ok(crate::i18n::text(locale, "appLaunchRequested").into())
}

#[cfg(windows)]
#[tauri::command]
pub(crate) async fn installed_apps(
    app: tauri::AppHandle,
    hub: tauri::State<'_, crate::ipc::Hub>,
) -> Result<Vec<Observation>, String> {
    let locale = crate::config::bootstrap_locale(&app);
    let catalog =
        official_catalog(app).map_err(|error| crate::i18n::app_message(locale, &error))?;
    let hub = hub.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        inspect(
            &catalog,
            &windows::CurrentUserRegistry,
            &windows::SystemLauncher { hub: &hub, id: "" },
        )
        .into_iter()
        .map(|mut observation| {
            observation.reason = crate::i18n::app_message(locale, &observation.reason);
            observation.open_reason = observation
                .open_reason
                .map(|reason| crate::i18n::app_message(locale, &reason));
            observation
        })
        .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Entry {
    physical_key: String,
    display_name: Option<String>,
    publisher: Option<String>,
    version: Option<String>,
    install_location: Option<String>,
    display_icon: Option<String>,
}

trait Registry {
    fn scan(&self) -> Result<Vec<Entry>, String>;
    fn equal(&self, left: &str, right: &str) -> bool;
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
enum InstallState {
    Installed,
    NotInstalled,
    Unknown,
}

trait Launcher {
    fn resolve(&self, location: &str, relative: &str) -> Result<std::path::PathBuf, String>;
    fn launch(
        &self,
        executable: &std::path::Path,
        location: &str,
        relative: &str,
    ) -> Result<(), String>;
}

fn open_official(
    catalog: &Catalog,
    registry: &impl Registry,
    launcher: &impl Launcher,
    id: &str,
) -> Result<(), String> {
    let app = catalog
        .apps
        .iter()
        .find(|app| app.id == id)
        .ok_or("nexo.appNotOfficial")?;
    let hint = app.detection.as_ref().ok_or("nexo.appNoDetection")?;
    let entry = matched_apps(catalog, registry)
        .into_iter()
        .find(|(observation, _)| observation.id == id)
        .and_then(|(_, entry)| entry)
        .ok_or("nexo.appNoUnique")?;
    let location = identity(entry.install_location.as_deref()).ok_or("nexo.appLocationMissing")?;
    let executable = launcher.resolve(location, &hint.windows.executable_relative_path)?;
    launcher.launch(
        &executable,
        location,
        &hint.windows.executable_relative_path,
    )
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Observation {
    id: String,
    state: InstallState,
    reason: String,
    version: Option<String>,
    can_open: bool,
    open_reason: Option<String>,
}

fn identity(value: Option<&str>) -> Option<&str> {
    let value = value?.trim();
    (!value.is_empty() && !value.chars().any(char::is_control)).then_some(value)
}

fn same(registry: &impl Registry, left: &str, right: &str) -> bool {
    registry.equal(left.trim(), right.trim())
}

#[cfg(test)]
fn observe(catalog: &Catalog, registry: &impl Registry) -> Vec<Observation> {
    matched_apps(catalog, registry)
        .into_iter()
        .map(|(observation, _)| observation)
        .collect()
}

fn inspect(
    catalog: &Catalog,
    registry: &impl Registry,
    launcher: &impl Launcher,
) -> Vec<Observation> {
    matched_apps(catalog, registry)
        .into_iter()
        .map(|(mut observation, entry)| {
            if let Some(entry) = entry {
                let result = identity(entry.install_location.as_deref())
                    .ok_or_else(|| "nexo.appLocationMissing".to_string())
                    .and_then(|location| {
                        let app = catalog
                            .apps
                            .iter()
                            .find(|app| app.id == observation.id)
                            .expect("matched official app");
                        let hint = app.detection.as_ref().expect("matched hint");
                        launcher.resolve(location, &hint.windows.executable_relative_path)
                    });
                match result {
                    Ok(_) => {
                        observation.can_open = true;
                        observation.open_reason = None;
                    }
                    Err(reason) => observation.open_reason = Some(reason),
                }
            }
            observation
        })
        .collect()
}

fn matched_apps(catalog: &Catalog, registry: &impl Registry) -> Vec<(Observation, Option<Entry>)> {
    let scanned = registry.scan();
    catalog
        .apps
        .iter()
        .map(|app| {
            let unknown = |reason: &str| {
                (
                    Observation {
                        id: app.id.clone(),
                        state: InstallState::Unknown,
                        reason: reason.into(),
                        version: None,
                        can_open: false,
                        open_reason: Some(reason.into()),
                    },
                    None,
                )
            };
            let Some(hint) = app.detection.as_ref().map(|detection| &detection.windows) else {
                return unknown("nexo.appNoHint");
            };
            let Ok(entries) = &scanned else {
                return unknown("nexo.appScanFailed");
            };
            let mut matches: Vec<&Entry> = Vec::new();
            let mut incomplete = false;
            for entry in entries {
                let name = identity(entry.display_name.as_deref());
                let publisher = identity(entry.publisher.as_deref());
                if name.is_none() && publisher.is_none() {
                    continue;
                }
                if name.is_some_and(|name| !same(registry, name, &hint.display_name))
                    || publisher
                        .is_some_and(|publisher| !same(registry, publisher, &hint.publisher))
                {
                    continue;
                }
                if name.is_none() || publisher.is_none() {
                    incomplete = true;
                    continue;
                }
                if let Some(previous) = matches
                    .iter()
                    .find(|previous| same(registry, &previous.physical_key, &entry.physical_key))
                {
                    if **previous != *entry {
                        incomplete = true;
                    }
                } else {
                    matches.push(entry);
                }
            }
            if incomplete || matches.len() > 1 {
                return unknown("nexo.appAmbiguous");
            }
            let Some(entry) = matches.first() else {
                return (
                    Observation {
                        id: app.id.clone(),
                        state: InstallState::NotInstalled,
                        reason: "nexo.appNoMatches".into(),
                        version: None,
                        can_open: false,
                        open_reason: Some("nexo.appNotInstalled".into()),
                    },
                    None,
                );
            };
            if catalog
                .apps
                .iter()
                .filter(|other| other.id != app.id)
                .any(|other| {
                    other.detection.as_ref().is_some_and(|detection| {
                        same(
                            registry,
                            &detection.windows.display_name,
                            &hint.display_name,
                        ) && same(registry, &detection.windows.publisher, &hint.publisher)
                    })
                })
            {
                return unknown("nexo.appSharedMatch");
            }
            (
                Observation {
                    id: app.id.clone(),
                    state: InstallState::Installed,
                    reason: "nexo.appInstalled".into(),
                    version: identity(entry.version.as_deref()).map(str::to_owned),
                    can_open: false,
                    open_reason: None,
                },
                Some((*entry).clone()),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::cell::Cell;

    struct FakeRegistry {
        entries: Result<Vec<Entry>, String>,
        scans: Cell<usize>,
    }
    impl Registry for FakeRegistry {
        fn scan(&self) -> Result<Vec<Entry>, String> {
            self.scans.set(self.scans.get() + 1);
            self.entries.clone()
        }
        fn equal(&self, left: &str, right: &str) -> bool {
            left.eq_ignore_ascii_case(right)
        }
    }
    fn catalog() -> Catalog {
        let mut value: Value = serde_json::from_str(include_str!(
            "../../../../crates/nexo-catalog/fixtures/full.json"
        ))
        .unwrap();
        value["schemaVersion"] = json!(2);
        value["apps"][0]["detection"] = json!({"windows": {"displayName": "Example App", "publisher": "Example Publisher", "executableRelativePath": "bin\\Example.exe"}});
        nexo_catalog::parse_catalog(&value.to_string()).unwrap()
    }
    fn entry(key: &str) -> Entry {
        Entry {
            physical_key: key.into(),
            display_name: Some(" Example App ".into()),
            publisher: Some("example publisher".into()),
            version: Some(" 1.4.7 ".into()),
            install_location: Some("C:\\Apps\\Example".into()),
            display_icon: Some("C:\\Apps\\Example\\Example.exe,0".into()),
        }
    }
    fn fake(entries: Result<Vec<Entry>, String>) -> FakeRegistry {
        FakeRegistry {
            entries,
            scans: Cell::new(0),
        }
    }

    #[test]
    fn exact_trimmed_identity_deduplicates_the_same_physical_entry_and_reports_installed_version() {
        let registry = fake(Ok(vec![entry("physical-a"), entry("physical-a")]));
        let observations = observe(&catalog(), &registry);
        assert_eq!(registry.scans.get(), 1);
        assert_eq!(observations.len(), 1);
        assert_eq!(observations[0].state, InstallState::Installed);
        assert_eq!(observations[0].version.as_deref(), Some("1.4.7"));
    }

    #[test]
    fn complete_scan_without_exact_name_and_publisher_is_absent() {
        let mut unrelated = entry("physical-a");
        unrelated.publisher = Some("different".into());
        let result = observe(&catalog(), &fake(Ok(vec![unrelated])));
        assert_eq!(result[0].state, InstallState::NotInstalled);
        assert_eq!(result[0].version, None);
    }

    #[test]
    fn entries_without_either_identity_do_not_obscure_matches_or_absence() {
        let mut unrelated = entry("unrelated");
        unrelated.display_name = None;
        unrelated.publisher = None;
        let registry = fake(Ok(vec![unrelated.clone(), entry("physical-a")]));
        let installed = observe(&catalog(), &registry);
        assert_eq!(registry.scans.get(), 1);
        assert_eq!(installed[0].state, InstallState::Installed);
        assert_eq!(installed[0].version.as_deref(), Some("1.4.7"));

        let absent = observe(&catalog(), &fake(Ok(vec![unrelated])));
        assert_eq!(absent[0].state, InstallState::NotInstalled);
        assert_eq!(absent[0].version, None);
    }

    #[test]
    fn unreadable_scan_missing_hint_missing_candidate_identity_or_multiple_matches_are_unknown() {
        let mut missing = entry("physical-a");
        missing.publisher = None;
        for entries in [
            Err("denied".into()),
            Ok(vec![missing]),
            Ok(vec![entry("physical-a"), entry("physical-b")]),
        ] {
            let result = observe(&catalog(), &fake(entries));
            assert_eq!(result[0].state, InstallState::Unknown);
            assert!(!result[0].reason.is_empty());
            assert_eq!(result[0].version, None);
        }
        let mut no_hint = catalog();
        no_hint.apps[0].detection = None;
        assert_eq!(
            observe(&no_hint, &fake(Ok(vec![])))[0].state,
            InstallState::Unknown
        );
    }

    #[test]
    fn one_entry_matching_multiple_official_ids_is_unknown_for_both() {
        let mut value = serde_json::to_value(catalog()).unwrap();
        let mut second = value["apps"][0].clone();
        second["id"] = json!("another-app");
        value["apps"].as_array_mut().unwrap().push(second);
        let catalog = nexo_catalog::parse_catalog(&value.to_string()).unwrap();
        let result = observe(&catalog, &fake(Ok(vec![entry("physical-a")])));
        assert_eq!(result.len(), 2);
        assert!(
            result
                .iter()
                .all(|item| item.state == InstallState::Unknown && item.version.is_none())
        );
    }

    #[derive(Default)]
    struct FakeLauncher {
        resolved: std::cell::RefCell<Vec<(String, String)>>,
        launched: std::cell::RefCell<Vec<std::path::PathBuf>>,
        fail_resolution: Cell<bool>,
        fail_launch: Cell<bool>,
    }
    impl Launcher for FakeLauncher {
        fn resolve(&self, location: &str, relative: &str) -> Result<std::path::PathBuf, String> {
            self.resolved
                .borrow_mut()
                .push((location.into(), relative.into()));
            if self.fail_resolution.get() {
                return Err("unsafe path".into());
            }
            Ok(std::path::PathBuf::from("resolved-example.exe"))
        }
        fn launch(
            &self,
            executable: &std::path::Path,
            _location: &str,
            _relative: &str,
        ) -> Result<(), String> {
            if self.fail_launch.get() {
                return Err("spawn failed".into());
            }
            self.launched.borrow_mut().push(executable.to_path_buf());
            Ok(())
        }
    }

    #[test]
    fn scan_exposes_open_availability_only_after_path_resolution() {
        let launcher = FakeLauncher::default();
        let registry = fake(Ok(vec![entry("physical-a")]));
        let result = inspect(&catalog(), &registry, &launcher);
        assert!(result[0].can_open);
        assert!(result[0].open_reason.is_none());
        assert!(launcher.launched.borrow().is_empty());
        launcher.fail_resolution.set(true);
        let result = inspect(&catalog(), &registry, &launcher);
        assert!(!result[0].can_open);
        assert_eq!(result[0].open_reason.as_deref(), Some("unsafe path"));
        assert!(launcher.launched.borrow().is_empty());
    }

    #[test]
    fn open_uses_only_a_fresh_unique_official_match_and_the_catalog_relative_hint() {
        let registry = fake(Ok(vec![entry("physical-a")]));
        let launcher = FakeLauncher::default();
        assert!(open_official(&catalog(), &registry, &launcher, "example-app").is_ok());
        assert_eq!(registry.scans.get(), 1);
        assert_eq!(
            *launcher.resolved.borrow(),
            [("C:\\Apps\\Example".into(), "bin\\Example.exe".into())]
        );
        assert_eq!(
            *launcher.launched.borrow(),
            [std::path::PathBuf::from("resolved-example.exe")]
        );
        assert!(open_official(&catalog(), &registry, &launcher, "not-official").is_err());
        assert_eq!(launcher.launched.borrow().len(), 1);
    }

    #[test]
    fn open_rejects_ambiguous_missing_or_unsafe_installations_and_surfaces_spawn_errors() {
        for entries in [
            Err("denied".into()),
            Ok(vec![]),
            Ok(vec![entry("a"), entry("b")]),
        ] {
            let launcher = FakeLauncher::default();
            assert!(open_official(&catalog(), &fake(entries), &launcher, "example-app").is_err());
            assert!(launcher.resolved.borrow().is_empty());
            assert!(launcher.launched.borrow().is_empty());
        }
        let mut no_location = entry("a");
        no_location.install_location = None;
        let launcher = FakeLauncher::default();
        assert!(
            open_official(
                &catalog(),
                &fake(Ok(vec![no_location])),
                &launcher,
                "example-app"
            )
            .is_err()
        );
        assert!(launcher.resolved.borrow().is_empty());
        assert!(launcher.launched.borrow().is_empty());
        launcher.fail_resolution.set(true);
        assert!(
            open_official(
                &catalog(),
                &fake(Ok(vec![entry("a")])),
                &launcher,
                "example-app"
            )
            .is_err()
        );
        assert!(launcher.launched.borrow().is_empty());
        launcher.fail_resolution.set(false);
        launcher.fail_launch.set(true);
        assert_eq!(
            open_official(
                &catalog(),
                &fake(Ok(vec![entry("a")])),
                &launcher,
                "example-app"
            ),
            Err("spawn failed".into())
        );
        assert!(launcher.launched.borrow().is_empty());
    }

    #[test]
    fn official_open_still_refuses_a_local_executable_path_as_an_id() {
        let registry = fake(Ok(vec![entry("physical-a")]));
        let launcher = FakeLauncher::default();
        assert_eq!(
            open_official(&catalog(), &registry, &launcher, "C:\\Apps\\App.exe"),
            Err("nexo.appNotOfficial".into())
        );
        assert_eq!(registry.scans.get(), 0);
        assert!(launcher.resolved.borrow().is_empty());
        assert!(launcher.launched.borrow().is_empty());
    }

    #[test]
    fn installed_does_not_require_location_or_version_and_never_uses_catalog_version() {
        let mut item = entry("physical-a");
        item.install_location = None;
        item.version = None;
        let result = observe(&catalog(), &fake(Ok(vec![item])));
        assert_eq!(result[0].state, InstallState::Installed);
        assert_eq!(result[0].version, None);
    }
}
