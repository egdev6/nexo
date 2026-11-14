use std::{collections::HashMap, sync::Mutex};

use tauri::{
    AppHandle, Emitter, Manager, State,
    menu::{CheckMenuItem, Menu, MenuItem, Submenu},
};

use crate::{
    config,
    i18n::{self, Locale, Presentation},
    ipc::{
        Hub, NoticeDetail, NoticeFailure, NoticeOutcome, QuitOutcome, Snapshot,
        windows::{self, Listener},
    },
    registry_presentation,
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
        return Err(i18n::text(config::bootstrap_locale(&app), "hubOnlyNotRequested").into());
    }
    app.exit(0);
    Ok(())
}

fn rebuild(app: &AppHandle, snapshot: &Snapshot, locale: Locale) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    let mut routes = HashMap::new();
    let mut index = 0_u64;
    for section in tray::compose(snapshot, locale) {
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
            i18n::text(locale, "hubOnly"),
            true,
            None::<&str>,
        )?;
        menu.append(&only)?;
    }
    let quit = MenuItem::with_id(app, "quit", i18n::text(locale, "quit"), true, None::<&str>)?;
    menu.append(&quit)?;
    let tray = app
        .tray_by_id("nexo")
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Nexo tray missing"))?;
    tray.set_menu(Some(menu))?;
    *app.state::<Routes>().0.lock().unwrap() = routes;
    Ok(())
}

// All paths rebuild the latest snapshot under the same presentation lock.
pub(crate) fn rebuild_current(app: &AppHandle) -> tauri::Result<Snapshot> {
    app.state::<Presentation>().refresh(
        || config::bootstrap_locale(app),
        |locale| {
            let snapshot = app.state::<Hub>().snapshot();
            rebuild(app, &snapshot, locale)?;
            Ok(snapshot)
        },
    )
}

fn failure(app: &AppHandle, detail: NoticeDetail, hub_only_allowed: bool) {
    app.state::<Hub>()
        .set_notice_detail(detail, hub_only_allowed);
    if let Err(error) = crate::show_flyout(app) {
        eprintln!("could not show Nexo: {error}");
    }
}

fn reason(result: QuitOutcome) -> Option<NoticeOutcome> {
    match result {
        QuitOutcome::Accepted => None,
        QuitOutcome::Refused(reason) => Some(NoticeOutcome::Refused { reason }),
        QuitOutcome::Timeout => Some(NoticeOutcome::Timeout),
        QuitOutcome::Unavailable => Some(NoticeOutcome::Unavailable),
        QuitOutcome::Disconnected => Some(NoticeOutcome::Disconnected),
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
                    reason(result).map(|outcome| NoticeFailure {
                        app: info.name,
                        outcome,
                    })
                })
                .collect();
            if failures.is_empty() {
                hub.shutdown();
                app.exit(0);
            } else {
                failure(
                    &app,
                    NoticeDetail::Quit {
                        all: true,
                        failures,
                    },
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
                && let Err(error) = rebuild_current(app)
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
            if let Err(error) = rebuild_current(app) {
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
                if let Some(outcome) = reason(hub.quit(&app_id, generation).await) {
                    failure(
                        &app,
                        NoticeDetail::Quit {
                            all: false,
                            failures: vec![NoticeFailure {
                                app: app_id,
                                outcome,
                            }],
                        },
                        false,
                    );
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
            windows::report_startup_error(&error, config::bootstrap_locale(app));
            return Err(error.into());
        }
    };
    let hub = app.state::<Hub>().inner().clone();
    hub.require_presentation();
    let changes = hub.subscribe();
    let app_for_rebuild = app.clone();
    let app_for_events = app.clone();
    tauri::async_runtime::spawn(registry_presentation::run(
        hub.clone(),
        changes,
        move || rebuild_current(&app_for_rebuild),
        move |snapshot| {
            if let Err(error) = app_for_events.emit_to("main", "nexo-registry", snapshot) {
                eprintln!("could not send registry update: {error}");
            }
        },
    ));
    tauri::async_runtime::spawn(async move {
        listener.run(hub).await;
    });
    Ok(())
}
