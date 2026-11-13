use tauri::{Runtime, plugin::Builder, plugin::TauriPlugin};

/// Plugin behavior will arrive in issue #3.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("nexo").build()
}
