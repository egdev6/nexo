mod catalog_cache;
mod position;

use position::{WorkArea, flyout_bounds};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WindowEvent,
};

#[derive(Default)]
struct BackdropState(AtomicBool);

#[tauri::command]
fn backdrop_available(state: State<'_, BackdropState>) -> bool {
    state.0.load(Ordering::Relaxed)
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
        place_flyout(&window)?;
        window.show()?;
        window.set_focus()?;
    }
    Ok(())
}

fn toggle_flyout(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible()? {
            window.hide()?;
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
    tauri::Builder::default()
        .manage(FocusState::default())
        .manage(BackdropState::default())
        .invoke_handler(tauri::generate_handler![
            backdrop_available,
            catalog_cache::read_catalog_cache,
            catalog_cache::write_catalog_cache
        ])
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
                if let Err(error) = window.hide() {
                    eprintln!("could not hide Nexo: {error}");
                }
            }
        })
        .setup(|app| {
            // Tauri applies its configured effect without reporting failure. Try
            // Mica, then acrylic, and keep the CSS fallback opaque if both fail.
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                let applied = window_vibrancy::apply_mica(&window, None)
                    .or_else(|_| window_vibrancy::apply_acrylic(&window, None))
                    .is_ok();
                app.state::<BackdropState>()
                    .0
                    .store(applied, Ordering::Relaxed);
            }
            let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            let icon = app.default_window_icon().cloned().ok_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::NotFound, "missing Nexo icon")
            })?;

            TrayIconBuilder::new()
                .icon(icon)
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
                    if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Nexo");
}
