#[cfg(any(windows, test))]
mod apps;
mod catalog_cache;
mod config;
mod i18n;
pub mod install_approval;
#[cfg(test)]
mod install_approval_tests;
pub mod install_download;
pub mod install_feed;
pub mod install_http;
#[cfg(any(windows, test))]
mod install_launcher;
#[cfg(test)]
mod install_launcher_tests;
#[cfg(any(windows, test))]
mod install_service;
#[cfg(test)]
mod install_service_tests;
pub mod install_signature;
#[cfg(test)]
mod install_signature_tests;
pub mod install_workspace;
#[cfg(test)]
mod install_workspace_tests;
#[cfg(any(windows, test))]
mod ipc;
#[cfg(any(windows, test))]
mod local_apps;
pub mod local_catalog;
mod position;
#[cfg(any(windows, test))]
mod registry_presentation;
#[cfg(windows)]
mod runtime;
#[cfg(any(windows, test))]
mod tray;
mod tray_icon;
pub mod update_close;

use position::{WorkArea, flyout_bounds};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent,
};

#[cfg(windows)]
struct NativeInstallProgress(AppHandle);
#[cfg(windows)]
impl install_service::ProgressSink for NativeInstallProgress {
    fn emit(&self, progress: install_service::InstallProgress) {
        if let Err(error) = self.0.emit_to("main", "install-progress", progress) {
            eprintln!("could not send install progress: {error}");
        }
    }
}

#[cfg(windows)]
#[tauri::command]
async fn install_app(
    app: AppHandle,
    window: WebviewWindow,
    service: State<'_, install_service::NativeService>,
    id: String,
) -> Result<install_service::InstallResult, String> {
    if window.label() != "main" {
        return Ok(install_service::InstallResult::NotAvailable);
    }
    let language = match config::bootstrap_locale(&app) {
        i18n::Locale::Es => "es",
        i18n::Locale::En => "en",
    };
    Ok(service
        .install_app_with_progress(
            &id,
            language,
            std::sync::Arc::new(NativeInstallProgress(app)),
        )
        .await)
}

#[cfg(windows)]
#[tauri::command]
async fn cancel_install(
    window: WebviewWindow,
    service: State<'_, install_service::NativeService>,
    id: String,
) -> Result<install_service::CancelResult, String> {
    if window.label() != "main" {
        return Ok(install_service::CancelResult::NotRunning);
    }
    Ok(service.cancel_install(&id).await)
}

#[derive(Default)]
struct BackdropState(AtomicBool);

#[tauri::command]
fn backdrop_available(state: State<'_, BackdropState>) -> bool {
    state.0.load(Ordering::Relaxed)
}

#[tauri::command]
fn apply_saved_language(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    #[cfg(windows)]
    {
        runtime::rebuild_current(&app)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        app.state::<i18n::Presentation>().refresh(
            || config::bootstrap_locale(&app),
            |locale| {
                let quit =
                    MenuItem::with_id(&app, "quit", i18n::text(locale, "quit"), true, None::<&str>)
                        .map_err(|error| error.to_string())?;
                let menu = Menu::with_items(&app, &[&quit]).map_err(|error| error.to_string())?;
                let tray = app.tray_by_id("nexo").ok_or("Nexo tray missing")?;
                tray.set_menu(Some(menu)).map_err(|error| error.to_string())
            },
        )
    }
}

#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FlyoutVisibility {
    visible: bool,
    sequence: u64,
    cycle: u64,
    at: u64,
    shown_at: u64,
}

#[derive(Default)]
struct VisibilityState(Mutex<FlyoutVisibility>);

fn record_visibility(app: &AppHandle, visible: bool) {
    let state = app.state::<VisibilityState>();
    let Ok(mut current) = state.0.lock() else {
        return;
    };
    if current.visible == visible {
        return;
    }
    current.visible = visible;
    current.sequence += 1;
    if visible {
        current.cycle += 1;
    }
    current.at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX);
    if visible {
        current.shown_at = current.at;
    }
    let snapshot = current.clone();
    drop(current);
    if let Err(error) = app.emit_to("main", "flyout-visibility", snapshot) {
        eprintln!("could not send flyout visibility: {error}");
    }
}

#[tauri::command]
fn get_flyout_state(state: State<'_, VisibilityState>) -> Result<FlyoutVisibility, String> {
    state
        .0
        .lock()
        .map(|value| value.clone())
        .map_err(|error| error.to_string())
}

fn hide_window(window: &WebviewWindow) -> tauri::Result<()> {
    if window.is_visible()? {
        window.hide()?;
        record_visibility(window.app_handle(), false);
    }
    Ok(())
}

#[tauri::command]
fn hide_flyout(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    hide_window(&window).map_err(|error| error.to_string())
}

#[derive(Default)]
struct FocusState {
    pointer_over_tray: AtomicBool,
    tray_focus_loss: Mutex<Option<Instant>>,
}

fn place_flyout(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.primary_monitor()? else {
        return Ok(());
    };
    let work = monitor.work_area();
    let area = WorkArea {
        x: work.position.x,
        y: work.position.y,
        width: work.size.width,
        height: work.size.height,
    };
    let bounds = flyout_bounds(&area, monitor.scale_factor());
    let size = PhysicalSize::new(bounds.width, bounds.height);
    let position = PhysicalPosition::new(bounds.x, bounds.y);
    if window.inner_size()? != size {
        window.set_size(size)?;
    }
    if window.outer_position()? != position {
        window.set_position(position)?;
    }
    Ok(())
}

fn show_flyout(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(mut lost) = app.state::<FocusState>().tray_focus_loss.lock() {
            *lost = None;
        }
        if !window.is_visible()? {
            place_flyout(&window)?;
            window.show()?;
            record_visibility(app, true);
        }
        window.set_focus()?;
    }
    Ok(())
}

fn toggle_flyout(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible()? {
            hide_window(&window)?;
        } else {
            // Clicking the tray can first defocus and hide the flyout. Do not
            // interpret that same click as a request to reopen it.
            let just_hidden = app
                .state::<FocusState>()
                .tray_focus_loss
                .lock()
                .map(|mut lost| {
                    lost.take()
                        .is_some_and(|at| at.elapsed() < Duration::from_millis(250))
                })
                .unwrap_or(false);
            if !just_hidden {
                show_flyout(app)?;
            }
        }
    }
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(FocusState::default())
        .manage(VisibilityState::default())
        .manage(BackdropState::default())
        .manage(config::ConfigLock::default())
        .manage(i18n::Presentation::default())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Nexo")
                .build(),
        );
    #[cfg(windows)]
    let builder = builder
        .manage(install_service::native().expect("install HTTP client"))
        .manage(ipc::Hub::new())
        .manage(runtime::Routes::default())
        .manage(local_catalog::RefreshFence::default())
        .invoke_handler(tauri::generate_handler![
            backdrop_available,
            get_flyout_state,
            hide_flyout,
            catalog_cache::read_catalog_cache,
            catalog_cache::read_catalog_v2_cache,
            catalog_cache::read_catalog_v3_cache,
            catalog_cache::write_catalog_cache,
            config::get_settings,
            config::save_settings,
            config::recover_settings,
            config::quit_after_settings,
            apply_saved_language,
            runtime::registry_snapshot,
            apps::installed_apps,
            apps::open_official_app,
            apps::close_connected_app,
            install_app,
            cancel_install,
            local_apps::windows::local_apps_list,
            local_apps::windows::local_app_add,
            local_apps::windows::local_app_update,
            local_apps::windows::local_app_remove,
            local_apps::windows::local_app_repair,
            local_apps::windows::local_app_pick_icon,
            local_apps::windows::local_app_icon,
            local_apps::windows::local_app_open,
            local_apps::windows::local_catalog_set,
            local_apps::windows::local_catalog_refresh,
            local_apps::windows::local_catalog_clear,
            local_apps::windows::local_catalog_bind,
            local_apps::windows::local_catalog_unbind,
            local_apps::windows::local_catalog_open,
            runtime::hub_only_exit
        ]);
    #[cfg(not(windows))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        backdrop_available,
        get_flyout_state,
        hide_flyout,
        catalog_cache::read_catalog_cache,
        catalog_cache::read_catalog_v2_cache,
        catalog_cache::read_catalog_v3_cache,
        catalog_cache::write_catalog_cache,
        config::get_settings,
        config::save_settings,
        config::recover_settings,
        config::quit_after_settings,
        apply_saved_language
    ]);
    builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Err(error) = show_flyout(app) {
                eprintln!("could not show Nexo: {error}");
            }
        }))
        .on_window_event(|window, event| {
            if window.label() == "main"
                && matches!(event, WindowEvent::Focused(false))
                && window.is_visible().unwrap_or(false)
            {
                let state = window.app_handle().state::<FocusState>();
                if let Ok(mut lost) = state.tray_focus_loss.lock() {
                    *lost = state
                        .pointer_over_tray
                        .load(Ordering::Relaxed)
                        .then(Instant::now);
                }
                match window.hide() {
                    Ok(()) => record_visibility(window.app_handle(), false),
                    Err(error) => eprintln!("could not hide Nexo: {error}"),
                }
            }
        })
        .setup(|app| {
            if install_workspace::PrivateFactory::system()
                .cleanup_stale()
                .is_err()
            {
                eprintln!("Could not clean stale installer workspaces");
            }
            // Keep Mica/acrylic as an optional OS-controlled fallback. If neither
            // works, the CSS panel can still be transparent and the desktop sharp;
            // the CSS blur slider does not control either native effect's radius.
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let applied = window_vibrancy::apply_mica(&window, None)
                    .or_else(|_| window_vibrancy::apply_acrylic(&window, None))
                    .is_ok();
                app.state::<BackdropState>()
                    .0
                    .store(applied, Ordering::Relaxed);
            }
            let locale = config::bootstrap_locale(app.handle());
            let quit =
                MenuItem::with_id(app, "quit", i18n::text(locale, "quit"), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            TrayIconBuilder::with_id("nexo")
                .icon(tray_icon::icon())
                .tooltip("Nexo")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    let app = tray.app_handle();
                    match event {
                        TrayIconEvent::Enter { .. } => {
                            app.state::<FocusState>()
                                .pointer_over_tray
                                .store(true, Ordering::Relaxed);
                        }
                        TrayIconEvent::Leave { .. } => {
                            app.state::<FocusState>()
                                .pointer_over_tray
                                .store(false, Ordering::Relaxed);
                        }
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            if let Err(error) = toggle_flyout(app) {
                                eprintln!("could not toggle Nexo: {error}");
                            }
                        }
                        _ => {}
                    }
                })
                .on_menu_event(|app, event| {
                    let id = event.id.as_ref();
                    if id == "quit" || id == "hub-only-exit" {
                        // Flush settings first; Windows then runs the IPC quit policy.
                        let mode = if id == "quit" { "all" } else { "hub-only" };
                        if let Err(error) = show_flyout(app)
                            .and_then(|()| app.emit_to("main", "quit-requested", mode))
                        {
                            eprintln!("could not request a safe exit: {error}");
                        }
                    } else {
                        #[cfg(windows)]
                        runtime::handle_menu(app, id);
                    }
                })
                .build(app)?;
            #[cfg(windows)]
            {
                local_apps::windows::start_local_catalogs(app.handle());
                runtime::start(app.handle())?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Nexo")
        .run(|_app, _event| {
            #[cfg(windows)]
            if matches!(_event, tauri::RunEvent::Exit)
                && let Some(hub) = _app.try_state::<ipc::Hub>()
            {
                hub.shutdown();
            }
        });
}
