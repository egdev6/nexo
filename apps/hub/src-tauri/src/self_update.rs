use tauri::{AppHandle, State, WebviewWindow};
#[cfg(windows)]
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

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
    let mut slot = pending.0.try_lock().map_err(|error| error.to_string())?;
    *slot = None;
    let handle = app.clone();
    let updater = app
        .updater_builder()
        .on_before_exit(move || {
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
    let mut slot = pending.0.try_lock().map_err(|error| error.to_string())?;
    let update = slot.take().ok_or("No hay ninguna actualización pendiente")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    // On Windows the updater launches NSIS with /R and exits instead of returning.
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::update_info;
    use serde_json::json;

    #[test]
    fn serializes_a_new_version_or_no_update_for_the_ui() {
        assert_eq!(
            serde_json::to_value(update_info(Some("2.3.4"))).unwrap(),
            json!({ "version": "2.3.4" })
        );
        assert_eq!(serde_json::to_value(update_info(None)).unwrap(), json!(null));
    }
}
