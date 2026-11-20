use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(windows)]
use tauri::Manager;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

/// The update found by the last check, plus whether the updater already ran
/// its pre-exit hook (hub IPC shut down, tray removed) for it.
#[derive(Default)]
pub struct PendingUpdate {
    update: Mutex<Option<Update>>,
    hook_ran: Arc<AtomicBool>,
}

#[derive(Debug, PartialEq, Eq)]
enum Recovery {
    Restart,
    ReportError,
}

/// After the pre-exit hook the hub can no longer serve apps, so a failed
/// installer launch must restart Nexo instead of leaving it half alive.
fn after_install_error(hook_ran: bool) -> Recovery {
    if hook_ran {
        Recovery::Restart
    } else {
        Recovery::ReportError
    }
}

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    version: String,
}

fn update_info(version: Option<&str>) -> Option<UpdateInfo> {
    version.map(|version| UpdateInfo {
        version: version.to_owned(),
    })
}

#[tauri::command]
pub fn app_version(window: WebviewWindow) -> Result<&'static str, String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    Ok(env!("CARGO_PKG_VERSION"))
}

#[tauri::command]
pub async fn self_update_check(
    app: AppHandle,
    window: WebviewWindow,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    let mut slot = pending
        .update
        .try_lock()
        .map_err(|error| error.to_string())?;
    *slot = None;
    pending.hook_ran.store(false, Ordering::SeqCst);
    let handle = app.clone();
    let hook_ran = Arc::clone(&pending.hook_ran);
    let updater = app
        .updater_builder()
        .on_before_exit(move || {
            hook_ran.store(true, Ordering::SeqCst);
            #[cfg(windows)]
            if let Some(hub) = handle.try_state::<crate::ipc::Hub>() {
                hub.shutdown();
            }
            handle.cleanup_before_exit();
        })
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    let info = update_info(update.as_ref().map(|update| update.version.as_str()));
    *slot = update;
    Ok(info)
}

#[tauri::command]
pub async fn self_update_install(
    app: AppHandle,
    window: WebviewWindow,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    let mut slot = pending
        .update
        .try_lock()
        .map_err(|error| error.to_string())?;
    let update = slot
        .take()
        .ok_or("No hay ninguna actualización pendiente")?;
    if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
        match after_install_error(pending.hook_ran.load(Ordering::SeqCst)) {
            Recovery::ReportError => return Err(error.to_string()),
            Recovery::Restart => {
                eprintln!(
                    "Self-update installer launch failed after shutdown, restarting: {error}"
                );
                app.restart();
            }
        }
    }
    // On Windows the updater launches NSIS with /R and exits instead of returning.
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::{Recovery, after_install_error, update_info};
    use serde_json::json;

    #[test]
    fn restarts_after_the_shutdown_hook_but_reports_earlier_install_errors() {
        assert_eq!(after_install_error(false), Recovery::ReportError);
        assert_eq!(after_install_error(true), Recovery::Restart);
    }

    #[test]
    fn updater_config_requires_a_signed_version() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let updater: tauri_plugin_updater::Config =
            serde_json::from_value(config["plugins"]["updater"].clone()).unwrap();
        assert!(updater.require_signed_version);
    }

    #[test]
    fn serializes_a_new_version_or_no_update_for_the_ui() {
        assert_eq!(
            serde_json::to_value(update_info(Some("2.3.4"))).unwrap(),
            json!({ "version": "2.3.4" })
        );
        assert_eq!(
            serde_json::to_value(update_info(None)).unwrap(),
            json!(null)
        );
    }
}
