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
#[cfg(any(windows, test))]
mod open_external;
mod platform;
mod position;
#[cfg(any(windows, test))]
mod registry_presentation;
#[cfg(windows)]
mod runtime;
mod self_update;
mod startup_log;
#[cfg(any(windows, test))]
mod tray;
mod tray_icon;
pub mod update_close;
#[cfg(test)]
mod update_service_tests;
#[cfg_attr(not(windows), allow(dead_code))]
mod window_clip;
mod window_motion;
#[cfg(test)]
mod window_motion_tests;
#[cfg(windows)]
mod windows_backdrop;

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
use window_motion::{Coordinator, Geometry, MotionSnapshot, Surface};

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

#[cfg(not(windows))]
#[tauri::command]
async fn installed_apps(app: AppHandle) -> Result<(), String> {
    Err(i18n::text(config::bootstrap_locale(&app), "appPlatformUnavailable").into())
}

#[cfg(not(windows))]
#[tauri::command]
async fn open_official_app(app: AppHandle, id: String) -> Result<(), String> {
    let _ = id;
    Err(i18n::text(config::bootstrap_locale(&app), "appPlatformUnavailable").into())
}

#[cfg(not(windows))]
#[tauri::command]
async fn close_official_app(app: AppHandle, id: String) -> Result<(), String> {
    let _ = id;
    Err(i18n::text(config::bootstrap_locale(&app), "appPlatformUnavailable").into())
}

#[tauri::command]
fn backdrop_available() -> bool {
    cfg!(windows)
}

#[cfg(windows)]
#[tauri::command]
async fn set_surface_clip(
    window: WebviewWindow,
    clip: Option<window_clip::Clip>,
    blur: u8,
    opacity: u8,
    generation: u64,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    if let Some(clip) = &clip {
        clip.validate()?;
    }
    window_clip::physical_sigma(blur, opacity, 1.0)?;
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let allowed = target
                .app_handle()
                .state::<MotionState>()
                .0
                .try_lock()
                .map(|motion| {
                    let snapshot = motion.snapshot();
                    snapshot.phase == window_motion::Phase::Open
                        && snapshot.generation == generation
                })
                .unwrap_or(false);
            let result = if !allowed {
                Ok(())
            } else if let Some(clip) = clip {
                windows_backdrop::apply(&target, clip, blur, opacity)
            } else {
                windows_backdrop::hide();
                Ok(())
            };
            let _ = tx.try_send(result);
        })
        .map_err(|error| error.to_string())?;
    rx.recv()
        .await
        .ok_or_else(|| "Content backdrop UI callback was dropped".to_string())?
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
        }))
    }
    fn set_size(&self, width: u32, height: u32) -> tauri::Result<()> {
        let size = PhysicalSize::new(width, height);
        if self.0.inner_size()? != size {
            self.0.set_size(size)?;
        }
        Ok(())
    }
    fn set_position(&self, x: i32, y: i32) -> tauri::Result<()> {
        self.0.set_position(PhysicalPosition::new(x, y))
    }
    fn set_cloaked(&self, cloaked: bool) -> tauri::Result<()> {
        #[cfg(windows)]
        {
            use windows_sys::Win32::Graphics::Dwm::{DWMWA_CLOAK, DwmSetWindowAttribute};

            let hwnd = self.0.hwnd().inspect_err(|error| {
                eprintln!("could not get Nexo window handle for DWM cloak: {error}");
            })?;
            let value = i32::from(cloaked);
            // SAFETY: the window owns this HWND; DWMWA_CLOAK takes a BOOL.
            let result = unsafe {
                DwmSetWindowAttribute(
                    hwnd.0.cast(),
                    DWMWA_CLOAK as u32,
                    std::ptr::from_ref(&value).cast(),
                    std::mem::size_of_val(&value) as u32,
                )
            };
            if result < 0 {
                let error = std::io::Error::other(format!(
                    "could not set Nexo DWM cloak to {cloaked}: {result:#010x}"
                ));
                eprintln!("{error}");
                return Err(error.into());
            }
        }
        #[cfg(not(windows))]
        let _ = cloaked;
        Ok(())
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
    fn motion(&self, snapshot: MotionSnapshot) {
        #[cfg(windows)]
        if snapshot.phase != window_motion::Phase::Open {
            windows_backdrop::hide();
        }
        if let Err(error) = self.0.emit("flyout-motion", snapshot) {
            eprintln!("could not send flyout motion: {error}");
        }
    }
}

#[cfg(windows)]
fn configure_dwm_window(window: &WebviewWindow) {
    use windows_sys::Win32::{
        Foundation::TRUE,
        Graphics::Dwm::{
            DWMWA_TRANSITIONS_FORCEDISABLED, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
            DwmSetWindowAttribute,
        },
    };

    match window.hwnd() {
        Ok(hwnd) => {
            // SAFETY: the window owns this valid HWND, and TRUE is a BOOL with
            // the size required by DWMWA_TRANSITIONS_FORCEDISABLED.
            let result = unsafe {
                DwmSetWindowAttribute(
                    hwnd.0.cast(),
                    DWMWA_TRANSITIONS_FORCEDISABLED as u32,
                    std::ptr::from_ref(&TRUE).cast(),
                    std::mem::size_of_val(&TRUE) as u32,
                )
            };
            if result < 0 {
                eprintln!("could not disable Nexo DWM transitions: {result:#010x}");
            }
            let preference = DWMWCP_DONOTROUND;
            // SAFETY: the HWND is valid and the preference is the DWORD-sized
            // DWM_WINDOW_CORNER_PREFERENCE value required by this attribute.
            let result = unsafe {
                DwmSetWindowAttribute(
                    hwnd.0.cast(),
                    DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                    std::ptr::from_ref(&preference).cast(),
                    std::mem::size_of_val(&preference) as u32,
                )
            };
            if result < 0 {
                eprintln!("could not disable Nexo DWM rounded corners: {result:#010x}");
            }
        }
        Err(error) => eprintln!("could not get Nexo window handle for DWM: {error}"),
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

// A second animation frame follows the first render opportunity. Waiting for
// the mounted panel avoids acknowledging an initial about:blank document.
fn paint_probe_script(generation: u64) -> String {
    format!(
        "(() => {{ if (!document.querySelector('#root > .flyout')) return; \
         requestAnimationFrame(() => requestAnimationFrame(() => {{ \
         if (!document.querySelector('#root > .flyout')) return; \
         const bridge = window.__TAURI_INTERNALS__; \
         if (bridge && bridge.invoke) bridge.invoke('flyout_painted', {{ generation: {generation} }}).catch(() => {{}}); \
         }})); }})()"
    )
}

// Retry across initial navigation and webview reloads. Never reveal a bare
// backdrop on failure; return to the tray if the renderer cannot acknowledge.
fn schedule_paint_probe(window: &WebviewWindow, generation: Option<u64>) {
    let Some(generation) = generation else { return };
    let window = window.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        let active = std::sync::Arc::new(AtomicBool::new(true));
        while active.load(Ordering::Relaxed) {
            let target = window.clone();
            let active_on_main = active.clone();
            let expired = started.elapsed() >= Duration::from_secs(5);
            if let Err(error) = window.run_on_main_thread(move || {
                let state = target.app_handle().state::<MotionState>();
                let Ok(mut motion) = state.0.try_lock() else {
                    return;
                };
                if motion.pending_paint() != Some(generation) {
                    active_on_main.store(false, Ordering::Relaxed);
                } else if expired {
                    eprintln!("Nexo webview did not paint; returning to tray");
                    if let Err(error) = motion.abort(&NativeFlyout(&target)) {
                        eprintln!("could not hide Nexo after paint timeout: {error}");
                    }
                    active_on_main.store(false, Ordering::Relaxed);
                } else {
                    drop(motion);
                    if let Err(error) = target.eval(paint_probe_script(generation)) {
                        eprintln!("could not request Nexo webview paint: {error}");
                    }
                }
            }) {
                eprintln!("could not schedule Nexo paint probe: {error}");
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}

#[tauri::command]
fn flyout_painted(window: WebviewWindow, generation: u64) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let state = target.app_handle().state::<MotionState>();
            let Ok(mut motion) = state.0.try_lock() else {
                return;
            };
            if motion.pending_paint() != Some(generation) {
                return;
            }
            match motion.painted(&NativeFlyout(&target), generation) {
                Ok(animation) => {
                    drop(motion);
                    schedule_motion_timeout(&target, animation);
                }
                Err(error) => {
                    eprintln!("could not reveal Nexo after paint: {error}");
                    if let Err(error) = motion.abort(&NativeFlyout(&target)) {
                        eprintln!("could not hide Nexo after paint failure: {error}");
                    }
                }
            }
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_flyout_motion(state: State<'_, MotionState>) -> Result<MotionSnapshot, String> {
    state
        .0
        .lock()
        .map(|motion| motion.snapshot())
        .map_err(|error| error.to_string())
}

fn finish_motion_on_main(window: &WebviewWindow, generation: u64) {
    let state = window.app_handle().state::<MotionState>();
    if let Ok(mut motion) = state.0.lock()
        && let Err(error) = motion.finish(&NativeFlyout(window), generation)
    {
        eprintln!("could not finish Nexo motion: {error}");
        if let Err(error) = motion.abort(&NativeFlyout(window)) {
            eprintln!("could not hide Nexo after motion failure: {error}");
        }
    }
}

#[tauri::command]
fn flyout_motion_finished(window: WebviewWindow, generation: u64) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    let target = window.clone();
    window
        .run_on_main_thread(move || finish_motion_on_main(&target, generation))
        .map_err(|error| error.to_string())
}

// A stale timeout is harmless: the coordinator checks the generation on the UI thread.
fn schedule_motion_timeout(window: &WebviewWindow, generation: Option<u64>) {
    let Some(generation) = generation else { return };
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(window_motion::TIMEOUT);
        let target = window.clone();
        if let Err(error) =
            window.run_on_main_thread(move || finish_motion_on_main(&target, generation))
        {
            eprintln!("could not schedule Nexo motion timeout: {error}");
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
    schedule_motion_timeout(window, animation);
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

fn show_flyout(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        let target = window.clone();
        return window.run_on_main_thread(move || {
            let app = target.app_handle();
            let result = (|| {
                let state = app.state::<MotionState>();
                let Ok(mut motion) = state.0.try_lock() else {
                    return Ok(());
                };
                let previous_paint = motion.pending_paint();
                let animation = motion.show(&NativeFlyout(&target), reduced_motion())?;
                let pending = motion
                    .pending_paint()
                    .filter(|id| Some(*id) != previous_paint);
                drop(motion);
                schedule_paint_probe(&target, pending);
                schedule_motion_timeout(&target, animation);
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
        let previous_paint = motion.pending_paint();
        let animation = motion.toggle(&NativeFlyout(&window), reduced_motion())?;
        let pending = motion
            .pending_paint()
            .filter(|id| Some(*id) != previous_paint);
        drop(motion);
        schedule_paint_probe(&window, pending);
        schedule_motion_timeout(&window, animation);
        if reopening {
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

// Keep event routing testable without creating a native window.
fn handle_window_event<E>(
    label: &str,
    event: &WindowEvent,
    prevent: impl FnOnce(),
    hide: impl FnOnce() -> Result<(), E>,
) -> Result<(), E> {
    match event {
        WindowEvent::CloseRequested { .. } => handle_close_request(label, prevent, hide),
        _ => Ok(()),
    }
}

// Tauri normally creates configured windows before setup. Defer this one so its
// Windows-only style can be set on the builder before the HWND is created.
fn prepare_main_window(config: &mut tauri::Config) -> Result<(), &'static str> {
    let main = config
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main")
        .ok_or("Nexo main window config missing")?;
    main.create = false;
    main.window_effects = None;
    Ok(())
}

pub fn run() {
    startup_log::log(&format!(
        "starting Nexo {} (pid {})",
        env!("CARGO_PKG_VERSION"),
        std::process::id()
    ));
    let mut context = tauri::generate_context!();
    prepare_main_window(context.config_mut()).unwrap_or_else(|error| startup_log::fail(error));
    let builder = tauri::Builder::default()
        .manage(VisibilityState::default())
        .manage(MotionState::default())
        .manage(config::ConfigLock::default())
        .manage(i18n::Presentation::default())
        .manage(self_update::PendingUpdate::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Nexo")
                .build(),
        );
    #[cfg(windows)]
    let hub = ipc::Hub::new();
    #[cfg(windows)]
    let builder = builder
        .manage(
            install_service::native(hub.clone()).unwrap_or_else(|error| {
                startup_log::fail(&format!("install HTTP client: {error}"))
            }),
        )
        .manage(hub)
        .manage(runtime::Routes::default())
        .manage(local_apps::windows::SelectionState::default())
        .invoke_handler(tauri::generate_handler![
            self_update::app_version,
            self_update::self_update_check,
            self_update::self_update_install,
            backdrop_available,
            set_surface_clip,
            flyout_painted,
            flyout_motion_finished,
            get_flyout_motion,
            get_flyout_state,
            hide_flyout,
            platform::platform_key,
            catalog_cache::read_catalog_v4_cache,
            catalog_cache::write_catalog_cache,
            config::get_settings,
            config::save_settings,
            config::recover_settings,
            config::quit_after_settings,
            apply_saved_language,
            runtime::registry_snapshot,
            apps::installed_apps,
            apps::open_official_app,
            apps::close_official_app,
            apps::close_connected_app,
            apps::activate_connected_menu_item,
            open_external::open_external,
            install_app,
            update_app,
            cancel_install,
            local_apps::windows::local_apps_list,
            local_apps::windows::local_app_pick_executable,
            local_apps::windows::local_app_pick_icon_file,
            local_apps::windows::local_app_cancel_selection,
            local_apps::windows::local_app_create,
            local_apps::windows::local_app_update,
            local_apps::windows::local_app_remove,
            local_apps::windows::local_app_repair,
            local_apps::windows::local_app_pick_icon,
            local_apps::windows::local_app_icon,
            local_apps::windows::local_app_open,
            runtime::hub_only_exit
        ]);
    #[cfg(not(windows))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        self_update::app_version,
        self_update::self_update_check,
        self_update::self_update_install,
        backdrop_available,
        flyout_painted,
        flyout_motion_finished,
        get_flyout_motion,
        get_flyout_state,
        hide_flyout,
        platform::platform_key,
        catalog_cache::read_catalog_v4_cache,
        catalog_cache::write_catalog_cache,
        config::get_settings,
        config::save_settings,
        config::recover_settings,
        config::quit_after_settings,
        apply_saved_language,
        installed_apps,
        open_official_app,
        close_official_app
    ]);
    #[cfg(windows)]
    startup_log::log_handoff();
    let app = builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Err(error) = show_flyout(app) {
                eprintln!("could not show Nexo: {error}");
            }
        }))
        .on_window_event(|window, event| {
            #[cfg(windows)]
            windows_backdrop::on_window_event(window, event);
            let result = handle_window_event(
                window.label(),
                event,
                || {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                    }
                },
                || {
                    if let Some(flyout) = window.app_handle().get_webview_window("main") {
                        hide_window(&flyout)
                    } else {
                        window.hide()
                    }
                },
            );
            if let Err(error) = result {
                eprintln!("could not hide Nexo: {error}");
            }
        })
        .setup(|app| {
            #[cfg(windows)]
            windows_backdrop::initialize_ui_thread();
            if install_workspace::PrivateFactory::system()
                .cleanup_stale()
                .is_err()
            {
                eprintln!("Could not clean stale installer workspaces");
            }
            let window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or(tauri::Error::WindowNotFound)?;
            let window_builder = tauri::WebviewWindowBuilder::from_config(app, window_config)?
                .transparent(true)
                .shadow(false)
                .decorations(false);
            #[cfg(windows)]
            let window_builder = window_builder.no_redirection_bitmap(true);
            let _window = window_builder.build()?;
            #[cfg(windows)]
            configure_dwm_window(&_window);
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
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                        && let Err(error) = toggle_flyout(tray.app_handle())
                    {
                        eprintln!("could not toggle Nexo: {error}");
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
                runtime::start(app.handle())?;
            }
            startup_log::log("setup complete");
            Ok(())
        })
        .build(context)
        .unwrap_or_else(|error| startup_log::fail(&format!("error while building Nexo: {error}")));
    #[cfg(windows)]
    {
        let exit_code = app.run_return(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                windows_backdrop::begin_shutdown();
                if let Some(hub) = app.try_state::<ipc::Hub>() {
                    hub.shutdown();
                }
            }
        });
        windows_backdrop::finish_shutdown();
        if exit_code != 0 {
            std::process::exit(exit_code);
        }
    }
    #[cfg(not(windows))]
    app.run(|_, _| {});
}

#[cfg(test)]
mod close_tests {
    use super::{handle_close_request, paint_probe_script};
    use std::cell::RefCell;

    #[test]
    fn paint_probe_waits_for_a_mounted_panel_and_two_frames() {
        let script = paint_probe_script(42);
        assert_eq!(script.matches("requestAnimationFrame").count(), 2);
        assert!(script.contains("#root > .flyout"));
        assert!(script.contains("bridge.invoke('flyout_painted', { generation: 42 })"));
    }

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
