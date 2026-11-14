use crate::install_download::Limits;
use crate::install_launcher::{self, INSTALL_TIMEOUT, LaunchError, Process, ProcessLauncher};
use crate::install_workspace::VerifiedInstaller;
use crate::install_workspace_tests::{FakeNetwork, Scratch, app, prepare};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};

#[derive(Default)]
struct State {
    paths: Mutex<Vec<PathBuf>>,
    result: Mutex<Option<Option<i32>>>,
    ready: Condvar,
    waits: Mutex<usize>,
}
impl State {
    fn exit(&self, code: Option<i32>) {
        *self.result.lock().unwrap() = Some(code);
        self.ready.notify_all();
    }
}
struct FakeLauncher {
    state: Arc<State>,
    elevation: Result<bool, ()>,
    fail_spawn: bool,
}
impl FakeLauncher {
    fn new(state: &Arc<State>) -> Self {
        Self {
            state: state.clone(),
            elevation: Ok(false),
            fail_spawn: false,
        }
    }
}
struct FakeProcess(Arc<State>);
impl Process for FakeProcess {
    fn wait(&mut self) -> Result<Option<i32>, ()> {
        *self.0.waits.lock().unwrap() += 1;
        let mut result = self.0.result.lock().unwrap();
        while result.is_none() {
            result = self.0.ready.wait(result).unwrap();
        }
        Ok(result.take().unwrap())
    }
}
impl ProcessLauncher for FakeLauncher {
    type Child = FakeProcess;
    fn elevated(&self) -> Result<bool, ()> {
        self.elevation
    }
    fn spawn(&self, installer: &VerifiedInstaller) -> Result<Self::Child, ()> {
        self.state
            .paths
            .lock()
            .unwrap()
            .push(installer.executable_path().to_owned());
        if self.fail_spawn {
            Err(())
        } else {
            Ok(FakeProcess(self.state.clone()))
        }
    }
}
async fn verified(scratch: &Scratch) -> VerifiedInstaller {
    prepare(
        &FakeNetwork::valid(),
        &scratch.factory(),
        &app(),
        Limits::default(),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn command_uses_only_the_verified_executable_and_one_silent_argument() {
    let scratch = Scratch::new();
    let installer = verified(&scratch).await;
    let command = install_launcher::installer_command(&installer);
    assert_eq!(command.get_program(), installer.executable_path());
    assert_eq!(command.get_args().collect::<Vec<_>>(), ["/S"]);
    drop(installer);
    assert!(scratch.workspaces().is_empty());
}

#[tokio::test]
async fn successful_exit_retains_verified_file_until_the_process_exits() {
    let scratch = Scratch::new();
    let installer = verified(&scratch).await;
    let path = installer.executable_path().to_owned();
    let state = Arc::new(State::default());
    let mut running = install_launcher::start(&installer, FakeLauncher::new(&state)).unwrap();
    assert_eq!(
        state.paths.lock().unwrap().as_slice(),
        std::slice::from_ref(&path)
    );
    drop(installer);
    assert!(path.exists());
    state.exit(Some(0));
    assert_eq!(running.wait().await, Ok(()));
    assert_eq!(running.wait_until_exit().await, Ok(()));
    assert!(!path.exists());
    assert!(scratch.workspaces().is_empty());
}

#[tokio::test(start_paused = true)]
async fn timeout_returns_after_ten_minutes_without_killing_or_releasing_the_verified_file() {
    let scratch = Scratch::new();
    let installer = verified(&scratch).await;
    let path = installer.executable_path().to_owned();
    let state = Arc::new(State::default());
    let mut running = install_launcher::start(&installer, FakeLauncher::new(&state)).unwrap();
    drop(installer);
    let before = tokio::time::Instant::now();
    assert_eq!(running.wait().await, Err(LaunchError::Timeout));
    assert_eq!(before.elapsed(), INSTALL_TIMEOUT);
    assert!(path.exists());
    assert_eq!(
        state.paths.lock().unwrap().as_slice(),
        std::slice::from_ref(&path)
    );
    state.exit(Some(0));
    assert_eq!(running.wait_until_exit().await, Ok(()));
    assert!(!path.exists());
    assert!(scratch.workspaces().is_empty());
}

#[tokio::test(start_paused = true)]
async fn timeout_deadline_does_not_restart_when_waiting_begins_late() {
    let scratch = Scratch::new();
    let installer = verified(&scratch).await;
    let state = Arc::new(State::default());
    let mut running = install_launcher::start(&installer, FakeLauncher::new(&state)).unwrap();
    tokio::time::advance(std::time::Duration::from_secs(9 * 60)).await;
    let before = tokio::time::Instant::now();
    let outcome = running.wait().await;
    let elapsed = before.elapsed();
    state.exit(Some(0));
    assert_eq!(running.wait_until_exit().await, Ok(()));
    drop(installer);
    assert!(scratch.workspaces().is_empty());
    assert_eq!(outcome, Err(LaunchError::Timeout));
    assert_eq!(elapsed, std::time::Duration::from_secs(60));
}

#[tokio::test]
async fn nonzero_and_missing_exit_codes_are_errors() {
    for (code, expected) in [
        (Some(42), LaunchError::Exit(42)),
        (None, LaunchError::NoExitCode),
    ] {
        let scratch = Scratch::new();
        let installer = verified(&scratch).await;
        let state = Arc::new(State::default());
        let mut running = install_launcher::start(&installer, FakeLauncher::new(&state)).unwrap();
        state.exit(code);
        assert_eq!(running.wait().await, Err(expected));
        assert_eq!(running.wait_until_exit().await, Err(expected));
        assert_eq!(
            *state.paths.lock().unwrap(),
            [installer.executable_path().to_owned()]
        );
        drop(installer);
        assert!(scratch.workspaces().is_empty());
    }
}

#[tokio::test]
async fn elevated_or_uncheckable_hub_never_spawns_and_spawn_failure_is_reported() {
    for (elevation, fail_spawn, expected, attempts) in [
        (Ok(true), false, LaunchError::Elevated, 0),
        (Err(()), false, LaunchError::ElevationCheck, 0),
        (Ok(false), true, LaunchError::Spawn, 1),
    ] {
        let scratch = Scratch::new();
        let installer = verified(&scratch).await;
        let state = Arc::new(State::default());
        let launcher = FakeLauncher {
            state: state.clone(),
            elevation,
            fail_spawn,
        };
        assert!(
            matches!(install_launcher::start(&installer, launcher), Err(error) if error == expected)
        );
        assert_eq!(state.paths.lock().unwrap().len(), attempts);
        assert_eq!(*state.waits.lock().unwrap(), 0);
        drop(installer);
        assert!(scratch.workspaces().is_empty());
    }
}

#[tokio::test]
async fn dropping_the_tracking_handle_never_releases_the_file_while_process_runs() {
    let scratch = Scratch::new();
    let installer = verified(&scratch).await;
    let path = installer.executable_path().to_owned();
    let state = Arc::new(State::default());
    let running = install_launcher::start(&installer, FakeLauncher::new(&state)).unwrap();
    drop(installer);
    drop(running);
    assert!(path.exists());
    state.exit(Some(0));
    // Cleanup runs on the monitor thread even if the async tracker was dropped.
    for _ in 0..100 {
        if !path.exists() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
    assert!(!path.exists());
    assert!(scratch.workspaces().is_empty());
}
