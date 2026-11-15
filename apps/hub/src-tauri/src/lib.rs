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
#[cfg(test)]
mod update_service_tests;
mod window_motion;
#[cfg(test)]
mod window_motion_tests;

use position::{WorkArea, flyout_bounds, work_area_right_edge};
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
use window_motion::{Animation, Coordinator, Geometry, Surface};

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
async fn update_app(
    app: AppHandle,
    window: WebviewWindow,
    service: State<'_, install_service::NativeService>,
    hub: State<'_, ipc::Hub>,
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
        .update_app_with_progress(
            &id,
            language,
            std::sync::Arc::new(NativeInstallProgress(app)),
            std::sync::Arc::new(install_service::NativeUpdateCloser::new(
                hub.inner().clone(),
            )),
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

#[derive(Default)]
struct MotionState(Mutex<Coordinator>);

struct NativeFlyout<'a>(&'a WebviewWindow);

impl Surface for NativeFlyout<'_> {
    type Error = tauri::Error;
    fn is_visible(&self) -> tauri::Result<bool> {
        self.0.is_visible()
    }
    fn geometry(&self) -> tauri::Result<Option<Geometry>> {
        let Some(monitor) = self.0.primary_monitor()? else {
            return Ok(None);
        };
        let work = monitor.work_area();
        let area = WorkArea {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        };
        let bounds = flyout_bounds(&area, monitor.scale_factor());
        Ok(Some(Geometry {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            offscreen_x: work_area_right_edge(&area),
        }))
    }
    fn set_size(&self, width: u32, height: u32) -> tauri::Result<()> {
        let size = PhysicalSize::new(width, height);
        if self.0.inner_size()? != size {
            self.0.set_size(size)?;
        }
        Ok(())
    }
    fn position(&self) -> tauri::Result<(i32, i32)> {
        let position = self.0.outer_position()?;
        Ok((position.x, position.y))
    }
    fn set_position(&self, x: i32, y: i32) -> tauri::Result<()> {
        self.0.set_position(PhysicalPosition::new(x, y))
    }
    fn show(&self) -> tauri::Result<()> {
        self.0.show()
    }
    fn hide(&self) -> tauri::Result<()> {
        self.0.hide()
    }
    fn visibility(&self, visible: bool) {
        record_visibility(self.0.app_handle(), visible);
    }
}

#[cfg(windows)]
fn reduced_motion() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SPI_GETCLIENTAREAANIMATION, SystemParametersInfoW,
    };
    let mut enabled: i32 = 0;
    // SAFETY: this SPI action writes a BOOL into the valid pointer supplied here.
    let success = unsafe {
        SystemParametersInfoW(
            SPI_GETCLIENTAREAANIMATION,
            0,
            std::ptr::from_mut(&mut enabled).cast(),
            0,
        )
    };
    success == 0 || enabled == 0
}

#[cfg(not(windows))]
fn reduced_motion() -> bool {
    false
}

// The timer is off-thread, but every coordinator and native-window operation
// runs on the UI thread. Check the generation there, not before dispatching a
// frame, so even already-queued frames cannot outlive a newer request.
fn schedule_animation(window: &WebviewWindow, animation: Option<Animation>) {
    let Some(animation) = animation else { return };
    let window = window.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        loop {
            let last = started.elapsed() >= window_motion::DURATION;
            let target = window.clone();
            if let Err(error) = window.run_on_main_thread(move || {
                let state = target.app_handle().state::<MotionState>();
                let Ok(mut motion) = state.0.try_lock() else {
                    return;
                };
                if let Err(error) =
                    motion.advance(&NativeFlyout(&target), &animation, started.elapsed())
                {
                    eprintln!("could not animate Nexo: {error}");
                    if let Err(error) = motion.abort(&NativeFlyout(&target)) {
                        eprintln!("could not hide Nexo after animation failure: {error}");
                    }
                }
            }) {
                eprintln!("could not schedule Nexo animation: {error}");
                return;
            }
            if last {
                return;
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    });
}

fn hide_window_on_main(window: &WebviewWindow) -> tauri::Result<()> {
    let state = window.app_handle().state::<MotionState>();
    let animation = if let Ok(mut motion) = state.0.try_lock() {
        motion.hide(&NativeFlyout(window), reduced_motion())?
    } else {
        None
    };
    schedule_animation(window, animation);
    Ok(())
}

fn hide_window(window: &WebviewWindow) -> tauri::Result<()> {
    let target = window.clone();
    window.run_on_main_thread(move || {
        if let Err(error) = hide_window_on_main(&target) {
            eprintln!("could not hide Nexo: {error}");
        }
    })
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

fn show_flyout(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let target = window.clone();
        return window.run_on_main_thread(move || {
            let app = target.app_handle();
            if let Ok(mut lost) = app.state::<FocusState>().tray_focus_loss.lock() {
                *lost = None;
            }
            let result = (|| {
                let animation = if let Ok(mut motion) = app.state::<MotionState>().0.try_lock() {
                    motion.show(&NativeFlyout(&target), reduced_motion())?
                } else {
                    None
                };
                schedule_animation(&target, animation);
                target.set_focus()
            })();
            if let Err(error) = result {
                eprintln!("could not show Nexo: {error}");
            }
        });
    }
    Ok(())
}

// Tray callbacks are delivered on Tauri's UI thread.
fn toggle_flyout(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<MotionState>();
        let Ok(mut motion) = state.0.try_lock() else {
            return Ok(());
        };
        let reopening = !window.is_visible()? || motion.is_exiting();
        // The click that caused a blur must not also reopen the exiting window.
        let just_hidden = reopening
            && app
                .state::<FocusState>()
                .tray_focus_loss
                .lock()
                .map(|mut lost| {
                    lost.take()
                        .is_some_and(|at| at.elapsed() < Duration::from_millis(250))
                })
                .unwrap_or(false);
        let animation = motion.toggle(&NativeFlyout(&window), reduced_motion(), just_hidden)?;
        drop(motion);
        schedule_animation(&window, animation);
        if reopening && !just_hidden {
            window.set_focus()?;
        }
    }
    Ok(())
}

// The window event supplies the native prevent-close and hide operations.
fn handle_close_request<E>(
    label: &str,
    prevent: impl FnOnce(),
    hide: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    if label == "main" {
        prevent();
        hide()?;
    }
    Ok(())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .manage(FocusState::default())
        .manage(VisibilityState::default())
        .manage(MotionState::default())
        .manage(BackdropState::default())
        .manage(config::ConfigLock::default())
        .manage(i18n::Presentation::default())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Nexo")
                .build(),
        );
    #[cfg(windows)]
    let hub = ipc::Hub::new();
    #[cfg(windows)]
    let builder = builder
        .manage(install_service::native(hub.clone()).expect("install HTTP client"))
        .manage(hub)
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
            update_app,
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
            if let WindowEvent::CloseRequested { api, .. } = event
                && let Err(error) = handle_close_request(
                    window.label(),
                    || api.prevent_close(),
                    || {
                        if let Some(flyout) = window.app_handle().get_webview_window("main") {
                            hide_window(&flyout)
                        } else {
                            window.hide()
                        }
                    },
                )
            {
                eprintln!("could not hide Nexo: {error}");
            }
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
                let result = if let Some(flyout) = window.app_handle().get_webview_window("main") {
                    hide_window(&flyout)
                } else {
                    window.hide()
                };
                if let Err(error) = result {
                    eprintln!("could not hide Nexo: {error}");
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

#[cfg(test)]
mod close_tests {
    use super::handle_close_request;
    use std::cell::RefCell;

    #[test]
    fn main_close_prevents_destruction_then_hides() {
        let events = RefCell::new(Vec::new());
        let result = handle_close_request(
            "main",
            || events.borrow_mut().push("prevent"),
            || {
                events.borrow_mut().push("hide");
                Ok::<_, &str>(())
            },
        );
        assert_eq!(result, Ok(()));
        assert_eq!(*events.borrow(), ["prevent", "hide"]);
    }

    #[test]
    fn main_close_is_still_prevented_when_hiding_fails() {
        let events = RefCell::new(Vec::new());
        let result = handle_close_request(
            "main",
            || events.borrow_mut().push("prevent"),
            || {
                events.borrow_mut().push("hide");
                Err::<(), _>("hide failed")
            },
        );
        assert_eq!(result, Err("hide failed"));
        assert_eq!(*events.borrow(), ["prevent", "hide"]);
    }

    #[test]
    fn other_windows_keep_their_normal_close_behavior() {
        let events = RefCell::new(Vec::new());
        let result = handle_close_request(
            "other",
            || events.borrow_mut().push("prevent"),
            || {
                events.borrow_mut().push("hide");
                Ok::<_, &str>(())
            },
        );
        assert_eq!(result, Ok(()));
        assert!(events.borrow().is_empty());
    }
}
