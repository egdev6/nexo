# Nexo Tauri plugin

On Windows, the configured plugin connects an app to the Nexo hub and coordinates the app's own
tray icon. The original `init::<R>()` remains an unconfigured no-op for existing callers.

## Configure the app

Give the plugin a **lazy factory** for the app's normal, initially visible icon. Do not also create
that icon during app startup: when the hub accepts a unified app, the factory is not called at all.
The factory and menu callback run on Tauri's main thread. This example forwards menu actions to a
host event; the host remains responsible for performing them.

```rust
use tauri::{Emitter, Runtime, tray::TrayIconBuilder};
use tauri_plugin_nexo::{AppInfo, MenuItem, Options, configured};

fn nexo_plugin<R: Runtime>() -> Result<tauri::plugin::TauriPlugin<R>, &'static str> {
    let options = Options::new(
        AppInfo {
            id: "sample-app".into(), // stable catalog id: lowercase [a-z0-9-]
            name: "Sample".into(),
            version: "1.0.0".into(),
        },
        |app| {
            let icon = app.default_window_icon().expect("supply the app's icon").clone();
            TrayIconBuilder::new().icon(icon).build(app)
        },
    )
    .menu(
        vec![MenuItem {
            id: "pause".into(),
            label: "Pause".into(),
            enabled: true,
            checked: Some(false),
        }],
        |app, id| { let _ = app.emit("nexo-menu-action", id.to_owned()); },
    )?;
    Ok(configured(options))
}
```

Install the returned plugin with the host's `tauri::Builder::plugin`. Use a stable app id, localized
name and installed semver version as defined by the [protocol](../../docs/protocol.md). The host
owns its tray design, normal menu, icon and window behavior; the plugin retains the factory's icon
handle and does not intercept window-close or minimize-to-tray events.

## Coordinate visibility and menu changes

After plugin setup, obtain a cloneable handle with `tauri_plugin_nexo::handle(&app_handle)`.
Route **all** subsequent personal-icon visibility requests through `handle.set_visible(visible)`
instead of calling `TrayIcon::set_visible` directly. While connected, the hub's unified setting
wins. A request made during the initial handshake is remembered without creating an icon; if that
attempt falls back, the latest request is honored and retained across failed retries. While
standalone, the host may again request its own visibility. A lost established session first
restores access, creating the normal icon if necessary; later sessions reuse it.

Use `handle.replace_menu(items)` to replace the entire hub menu. At most 20 items and one 64 KiB
encoded frame are accepted; rejection leaves the previous menu unchanged. Exclude the hub's own
Open and Quit entries. Only known current item IDs reach the supplied action callback. Omit
`.menu(...)` entirely if the app does not implement menu actions; no menu capability is advertised
in that case.

The client does not currently advertise or handle `show` or `quit`: those host actions, refusal and
final-exit coordination are T3, not implemented here. On normal Tauri exit or plugin removal the
client is signalled to stop and sends `bye` when possible. A host coordinating its own final exit
can call `handle.shutdown()`; it invalidates queued UI work immediately and stops the session
asynchronously. Do not use it merely to hide the tray or temporarily disconnect.

## Connection behavior and verification

- Missing pipe: create the normal icon immediately, then retry in the background. The first
  connect/hello/welcome/register/registered attempt has a single one-second budget; a timed-out
  attempt is closed before retry. No startup wait runs on the UI thread.
- Loss or protocol error: restore access, then retry after 1, 2, 4 … seconds, capped at 10 seconds.
  `unsupported_protocol` and `duplicate_app` stop retries until restart. `invalid_message` is
  logged and retried; unknown rejection codes also retry.
- Production discovery uses the current Windows user SID. The plugin exposes no endpoint override;
  scripted pipe names exist only inside crate tests. Factory, dispatch and icon errors are logged;
  a later identical request or lifecycle transition can retry a failed operation. The host must
  supply a functioning normal tray factory.

Run `cargo test -p tauri-plugin-nexo --locked` for deterministic client tests. Run that package's
tests on native Windows as well to exercise isolated scripted named pipes. These tests do not open
an actual tray or verify a real app window. Real Windows tray/window checks remain T4.
