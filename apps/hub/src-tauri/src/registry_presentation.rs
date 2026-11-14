use crate::ipc::{Hub, Snapshot};
use std::fmt::Display;
use tokio::sync::watch;

// The event loop keeps registration fenced until its snapshot is presented.
pub(crate) async fn run<E: Display>(
    hub: Hub,
    mut changes: watch::Receiver<u64>,
    mut rebuild: impl FnMut() -> Result<Snapshot, E>,
    mut emit: impl FnMut(Snapshot),
) {
    while changes.changed().await.is_ok() {
        let snapshot = match rebuild() {
            Ok(snapshot) => snapshot,
            Err(error) => {
                // Retain the last presented menu and retry only on a later registry change.
                eprintln!("could not update Nexo tray; retaining previous menu: {error}");
                continue;
            }
        };
        hub.mark_presented(snapshot.revision);
        emit(snapshot);
    }
}
