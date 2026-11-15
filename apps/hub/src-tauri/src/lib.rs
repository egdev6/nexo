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

#[derive(Clone, serde::Serialize)]
struct FlyoutMotion {
    phase: &'static str,
    sequence: u64,
}

struct MotionCoordinator {
    current: FlyoutMotion,
    pending_hide: Option<u64>,
}

impl Default for MotionCoordinator {
    fn default() -> Self {
        Self {
            current: FlyoutMotion {
                phase: "hidden",
                sequence: 0,
            },
            pending_hide: None,
        }
    }
}

trait FlyoutSurface {
    type Error;
    fn is_visible(&self) -> Result<bool, Self::Error>;
    fn show(&self) -> Result<(), Self::Error>;
    fn hide(&self) -> Result<(), Self::Error>;
    fn visibility(&self, visible: bool);
    fn emit(&self, event: FlyoutMotion);
}

impl MotionCoordinator {
    fn publish(&mut self, surface: &impl FlyoutSurface, phase: &'static str) -> u64 {
        self.current.sequence += 1;
        self.current.phase = phase;
        surface.emit(self.current.clone());
        self.current.sequence
    }

    fn show<S: FlyoutSurface>(&mut self, surface: &S) -> Result<(), S::Error> {
        if !surface.is_visible()? {
            surface.show()?;
            surface.visibility(true);
            self.pending_hide = None;
            self.publish(surface, "enter");
        } else if self.pending_hide.take().is_some() {
            self.publish(surface, "enter");
        }
        Ok(())
    }

    fn hide<S: FlyoutSurface>(&mut self, surface: &S) -> Result<Option<u64>, S::Error> {
        if !surface.is_visible()? || self.pending_hide.is_some() {
            return Ok(None);
        }
        let sequence = self.publish(surface, "exit");
        self.pending_hide = Some(sequence);
        Ok(Some(sequence))
    }

    fn finish<S: FlyoutSurface>(&mut self, surface: &S, sequence: u64) -> Result<(), S::Error> {
        if self.pending_hide == Some(sequence) {
            surface.hide()?;
            self.pending_hide = None;
            surface.visibility(false);
            self.publish(surface, "hidden");
        }
        Ok(())
    }

    fn toggle<S: FlyoutSurface>(
        &mut self,
        surface: &S,
        suppress_reopen: bool,
    ) -> Result<Option<u64>, S::Error> {
        if surface.is_visible()? && self.pending_hide.is_none() {
            self.hide(surface)
        } else {
            if !suppress_reopen {
                self.show(surface)?;
            }
            Ok(None)
        }
    }
}

#[derive(Default)]
struct MotionState(Mutex<MotionCoordinator>);

struct NativeFlyout<'a>(&'a WebviewWindow);

impl FlyoutSurface for NativeFlyout<'_> {
    type Error = tauri::Error;
    fn is_visible(&self) -> tauri::Result<bool> {
        self.0.is_visible()
    }
    fn show(&self) -> tauri::Result<()> {
        place_flyout(self.0)?;
        self.0.show()
    }
    fn hide(&self) -> tauri::Result<()> {
        self.0.hide()
    }
    fn visibility(&self, visible: bool) {
        record_visibility(self.0.app_handle(), visible);
    }
    fn emit(&self, event: FlyoutMotion) {
        if let Err(error) = self.0.emit("flyout-motion", event) {
            eprintln!("could not send flyout motion: {error}");
        }
    }
}

#[tauri::command]
fn get_flyout_motion(state: State<'_, MotionState>) -> Result<FlyoutMotion, String> {
    state
        .0
        .lock()
        .map(|motion| motion.current.clone())
        .map_err(|error| error.to_string())
}

fn finish_window_hide(window: &WebviewWindow, sequence: u64) -> tauri::Result<()> {
    let state = window.app_handle().state::<MotionState>();
    if let Ok(mut motion) = state.0.lock() {
        motion.finish(&NativeFlyout(window), sequence)?;
    }
    Ok(())
}

#[tauri::command]
fn finish_flyout_hide(window: WebviewWindow, sequence: u64) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    finish_window_hide(&window, sequence).map_err(|error| error.to_string())
}

// A nonresponsive or not-yet-loaded webview must never prevent hiding to tray.
fn schedule_hide_fallback(window: &WebviewWindow, sequence: u64) {
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(600));
        if let Err(error) = finish_window_hide(&window, sequence) {
            eprintln!("could not hide Nexo: {error}");
        }
    });
}

fn hide_window(window: &WebviewWindow) -> tauri::Result<()> {
    let state = window.app_handle().state::<MotionState>();
    let sequence = if let Ok(mut motion) = state.0.lock() {
        motion.hide(&NativeFlyout(window))?
    } else {
        None
    };
    if let Some(sequence) = sequence {
        schedule_hide_fallback(window, sequence);
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
        if let Ok(mut motion) = app.state::<MotionState>().0.lock() {
            motion.show(&NativeFlyout(&window))?;
        }
        window.set_focus()?;
    }
    Ok(())
}

fn toggle_flyout(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<MotionState>();
        let Ok(mut motion) = state.0.lock() else {
            return Ok(());
        };
        let reopening = !window.is_visible()? || motion.pending_hide.is_some();
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
        let sequence = motion.toggle(&NativeFlyout(&window), just_hidden)?;
        drop(motion);
        if let Some(sequence) = sequence {
            schedule_hide_fallback(&window, sequence);
        }
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
            get_flyout_motion,
            finish_flyout_hide,
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
        get_flyout_motion,
        finish_flyout_hide,
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
mod motion_tests {
    use super::{FlyoutMotion, FlyoutSurface, MotionCoordinator, handle_close_request};
    use std::cell::{Cell, RefCell};

    #[derive(Default)]
    struct Surface {
        visible: Cell<bool>,
        events: RefCell<Vec<String>>,
    }

    impl FlyoutSurface for Surface {
        type Error = ();

        fn is_visible(&self) -> Result<bool, Self::Error> {
            Ok(self.visible.get())
        }
        fn show(&self) -> Result<(), Self::Error> {
            self.visible.set(true);
            self.events.borrow_mut().push("show".into());
            Ok(())
        }
        fn hide(&self) -> Result<(), Self::Error> {
            self.visible.set(false);
            self.events.borrow_mut().push("hide".into());
            Ok(())
        }
        fn visibility(&self, visible: bool) {
            self.events.borrow_mut().push(format!("visible:{visible}"));
        }
        fn emit(&self, event: FlyoutMotion) {
            self.events
                .borrow_mut()
                .push(format!("{}:{}", event.phase, event.sequence));
        }
    }

    #[test]
    fn tray_shortcut_close_and_blur_each_emit_before_hiding_and_reopen() {
        let surface = Surface::default();
        let mut motion = MotionCoordinator::default();

        // Tray click opens; the next click starts an exit, but does not hide yet.
        motion.toggle(&surface, false).unwrap();
        let tray_exit = motion.toggle(&surface, false).unwrap().unwrap();
        assert!(surface.visible.get());
        assert_eq!(
            surface.events.borrow().as_slice(),
            ["show", "visible:true", "enter:1", "exit:2"]
        );
        motion.finish(&surface, tray_exit).unwrap();
        assert!(!surface.visible.get());

        // A second instance/shortcut reopens, and a native close is prevented.
        motion.show(&surface).unwrap();
        let prevented = Cell::new(false);
        let mut close_exit = None;
        handle_close_request(
            "main",
            || prevented.set(true),
            || {
                close_exit = motion.hide(&surface)?;
                Ok::<_, ()>(())
            },
        )
        .unwrap();
        assert!(prevented.get());
        assert!(surface.visible.get());
        motion.finish(&surface, close_exit.unwrap()).unwrap();

        // Reopening after close, then focus loss, uses the same exit protocol.
        motion.toggle(&surface, false).unwrap();
        let blur_exit = motion.hide(&surface).unwrap().unwrap();
        assert!(surface.visible.get());
        motion.finish(&surface, blur_exit).unwrap();
        motion.show(&surface).unwrap();
        assert_eq!(
            surface.events.borrow().as_slice(),
            [
                "show",
                "visible:true",
                "enter:1",
                "exit:2",
                "hide",
                "visible:false",
                "hidden:3",
                "show",
                "visible:true",
                "enter:4",
                "exit:5",
                "hide",
                "visible:false",
                "hidden:6",
                "show",
                "visible:true",
                "enter:7",
                "exit:8",
                "hide",
                "visible:false",
                "hidden:9",
                "show",
                "visible:true",
                "enter:10",
            ]
        );
    }

    #[test]
    fn reopening_cancels_stale_completion_and_the_tray_blur_click_does_not_reopen() {
        let surface = Surface::default();
        let mut motion = MotionCoordinator::default();
        motion.show(&surface).unwrap();
        let exit = motion.hide(&surface).unwrap().unwrap();
        assert_eq!(motion.toggle(&surface, true).unwrap(), None);
        assert_eq!(motion.hide(&surface).unwrap(), None);
        motion.show(&surface).unwrap();
        motion.finish(&surface, exit).unwrap();
        assert!(surface.visible.get());
        assert_eq!(
            surface.events.borrow().as_slice(),
            ["show", "visible:true", "enter:1", "exit:2", "enter:3"]
        );
        motion.show(&surface).unwrap();
        assert_eq!(surface.events.borrow().len(), 5);
    }
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
