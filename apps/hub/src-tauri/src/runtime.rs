use std::{collections::HashMap, sync::Mutex};

use tauri::{
    AppHandle, Emitter, Manager, State,
    menu::{CheckMenuItem, Menu, MenuItem, Submenu},
};

use crate::{
    ipc::{
        Hub, QuitOutcome, Snapshot,
        windows::{self, Listener},
    },
    tray::{self, Command},
};

#[derive(Default)]
pub(crate) struct Routes(Mutex<HashMap<String, Command>>);

#[tauri::command]
pub(crate) fn registry_snapshot(hub: State<'_, Hub>) -> Snapshot {
    hub.snapshot()
}

#[tauri::command]
pub(crate) fn hub_only_exit(app: AppHandle, hub: State<'_, Hub>) -> Result<(), String> {
    if !hub.hub_only_exit() {
        return Err("No se ha solicitado una salida solo de Nexo".into());
    }
    app.exit(0);
    Ok(())
}

fn rebuild(app: &AppHandle, snapshot: &Snapshot) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    let mut routes = HashMap::new();
    let mut index = 0_u64;
    for section in tray::compose(snapshot) {
        let submenu = Submenu::new(app, section.label.replace('&', "&&"), true)?;
        for item in section.items {
            let id = format!("nexo:{}:{index}", snapshot.revision);
            index += 1;
            let label = item.label.replace('&', "&&");
            if let Some(checked) = item.checked {
                let native = CheckMenuItem::with_id(
                    app,
                    id.clone(),
                    label,
                    item.enabled,
                    checked,
                    None::<&str>,
                )?;
                submenu.append(&native)?;
            } else {
                let native = MenuItem::with_id(app, id.clone(), label, item.enabled, None::<&str>)?;
                submenu.append(&native)?;
            }
            routes.insert(id, item.command);
        }
        menu.append(&submenu)?;
    }
    if snapshot
        .notice
        .as_ref()
        .is_some_and(|notice| notice.hub_only_allowed)
    {
        let only = MenuItem::with_id(
            app,
            "hub-only-exit",
            "Salir solo de Nexo",
            true,
            None::<&str>,
        )?;
        menu.append(&only)?;
    }
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    menu.append(&quit)?;
    let tray = app
        .tray_by_id("nexo")
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Nexo tray missing"))?;
    tray.set_menu(Some(menu))?;
    *app.state::<Routes>().0.lock().unwrap() = routes;
    Ok(())
}

fn failure(app: &AppHandle, message: String, hub_only_allowed: bool) {
    app.state::<Hub>().set_notice(message, hub_only_allowed);
    if let Err(error) = crate::show_flyout(app) {
        eprintln!("could not show Nexo: {error}");
    }
}

pub(crate) fn reason(result: QuitOutcome) -> Option<String> {
    match result {
        QuitOutcome::Accepted => None,
        QuitOutcome::Refused(reason) => {
            Some(reason.unwrap_or_else(|| "La app rechazó el cierre".into()))
        }
        QuitOutcome::Timeout => Some("No respondió en 10 segundos".into()),
        QuitOutcome::Unavailable => Some("La app no admite cierre o no está disponible".into()),
        QuitOutcome::Disconnected => Some("La conexión se perdió; estado desconocido".into()),
    }
}

pub(crate) fn handle_menu(app: &AppHandle, id: &str) {
    let hub = app.state::<Hub>().inner().clone();
    if id == "hub-only-exit" {
        if hub.hub_only_exit() {
            app.exit(0);
        }
        return;
    }
    if id == "quit" {
        hub.clear_notice();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let results = hub.quit_all().await;
            let failures: Vec<_> = results
                .into_iter()
                .filter_map(|(info, result)| {
                    reason(result).map(|reason| format!("{}: {reason}", info.name))
                })
                .collect();
            if failures.is_empty() {
                hub.shutdown();
                app.exit(0);
            } else {
                failure(
                    &app,
                    format!("Nexo sigue abierto. {}", failures.join("; ")),
                    true,
                );
            }
        });
        return;
    }
    let command = app.state::<Routes>().0.lock().unwrap().get(id).cloned();
    match command {
        Some(Command::Toggle {
            app: app_id,
            generation,
            value,
        }) => {
            if !hub.set_unified(&app_id, generation, value)
                && let Err(error) = rebuild(app, &hub.snapshot())
            {
                eprintln!("could not restore Nexo tray state: {error}");
                hub.shutdown();
            }
        }
        Some(Command::Show { app, generation }) => {
            hub.show(&app, generation);
        }
        Some(Command::Action {
            app: app_id,
            generation,
            revision,
            item,
        }) => {
            hub.action(&app_id, generation, revision, &item);
            // Native check items toggle themselves; the app remains authoritative.
            if let Err(error) = rebuild(app, &hub.snapshot()) {
                eprintln!("could not restore Nexo tray state: {error}");
                hub.shutdown();
            }
        }
        Some(Command::Quit {
            app: app_id,
            generation,
        }) => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(message) = reason(hub.quit(&app_id, generation).await) {
                    failure(&app, format!("{app_id}: {message}"), false);
                }
            });
        }
        None => {}
    }
}

pub(crate) fn start(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let listener = match tauri::async_runtime::block_on(async { Listener::acquire() }) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("Nexo pipe ownership failed: {error}");
            windows::report_startup_error(&error);
            return Err(error.into());
        }
    };
    let hub = app.state::<Hub>().inner().clone();
    hub.require_presentation();
    let mut changes = hub.subscribe();
    let app_for_events = app.clone();
    let hub_for_events = hub.clone();
    tauri::async_runtime::spawn(async move {
        while changes.changed().await.is_ok() {
            let snapshot = hub_for_events.snapshot();
            if let Err(error) = rebuild(&app_for_events, &snapshot) {
                eprintln!("could not update Nexo tray; closing IPC: {error}");
                hub_for_events.shutdown();
                hub_for_events.set_notice(
                    "No se pudo actualizar la bandeja; la conexión con las apps se cerró.".into(),
                    false,
                );
                let _ = app_for_events.emit_to("main", "nexo-registry", hub_for_events.snapshot());
                return;
            }
            hub_for_events.mark_presented(snapshot.revision);
            if let Err(error) = app_for_events.emit_to("main", "nexo-registry", snapshot) {
                eprintln!("could not send registry update: {error}");
            }
        }
    });
    tauri::async_runtime::spawn(async move {
        listener.run(hub).await;
    });
    Ok(())
}
