use std::{
    future::Future,
    io,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};

use nexo_protocol::{
    AppInfo, Capability, HEARTBEAT_INTERVAL_RANGE_MS, MAX_LINE_BYTES, MAX_MENU_ITEMS,
    MISSED_HEARTBEATS_LIMIT, MenuItem, Message, PROTOCOL_VERSION, ProtocolError, RejectCode,
    VersionRange, decode, encode,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::{mpsc, watch},
};

pub(crate) trait Stream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Stream for T {}
pub(crate) type Connection = Box<dyn Stream>;
pub(crate) type Connect =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = io::Result<Connection>> + Send>> + Send + Sync>;
pub(crate) type Job = Box<dyn FnOnce() + Send>;

pub(crate) trait Icon: Send {
    fn set_visible(&self, visible: bool) -> Result<(), String>;
}
pub(crate) trait Host: Send + Sync {
    fn dispatch(&self, job: Job) -> Result<(), String>;
    fn create_icon(&self) -> Result<Box<dyn Icon>, String>;
    fn action(&self, item_id: String);
}

pub(crate) struct Config {
    pub app: AppInfo,
    pub menu: Option<Vec<MenuItem>>,
}

enum Command {
    Menu(Vec<MenuItem>),
}

/// A handle for menu replacement, mediated tray visibility and shutdown.
#[derive(Clone)]
pub struct Handle {
    commands: mpsc::UnboundedSender<Command>,
    shutdown: watch::Sender<bool>,
    visual: Arc<Visual>,
    has_menu: bool,
}

impl Handle {
    /// Replace the app's complete hub menu. A menu must have been configured at startup.
    pub fn replace_menu(&self, items: Vec<MenuItem>) -> Result<(), &'static str> {
        if !self.has_menu {
            return Err("menu capability was not configured");
        }
        validate_menu(&items)?;
        self.visual.replace_menu(items, &self.commands)
    }
    /// Request personal-icon visibility. The hub's setting wins while connected.
    pub fn set_visible(&self, visible: bool) {
        self.visual.request(visible);
    }
    /// Stop the client when the application is exiting; sends `bye` when possible.
    pub fn shutdown(&self) {
        self.visual.stop();
        self.shutdown.send_replace(true);
    }
}

pub(crate) fn validate_menu(items: &[MenuItem]) -> Result<(), &'static str> {
    if items.len() > MAX_MENU_ITEMS
        || encode(
            PROTOCOL_VERSION,
            &Message::Menu {
                items: items.to_vec(),
            },
        )
        .is_err()
    {
        return Err("menu exceeds protocol limits");
    }
    Ok(())
}

fn menu_ids(items: &[MenuItem]) -> Vec<String> {
    items.iter().map(|item| item.id.clone()).collect()
}

struct VisualState {
    revision: u64,
    session: u64,
    active: bool,
    standalone: bool,
    initial_pending: bool,
    initial_preference: Option<bool>,
    busy: bool,
    desired: Option<bool>,
    applied: Option<bool>,
    scheduled: Option<u64>,
    menu: Vec<String>,
    icon: Option<Box<dyn Icon>>,
}
struct Visual {
    host: Arc<dyn Host>,
    state: Mutex<VisualState>,
}
impl Visual {
    fn update(self: &Arc<Self>, transition: impl FnOnce(&mut VisualState) -> Option<bool>) {
        let next = {
            let mut state = self.state.lock().unwrap();
            if !state.active {
                return;
            }
            let Some(visible) = transition(&mut state) else {
                return;
            };
            if state.desired != Some(visible) {
                state.desired = Some(visible);
                state.revision += 1;
                state.scheduled = None;
            } else if state.busy || state.scheduled == Some(state.revision) {
                return;
            }
            if !state.busy && state.applied == Some(visible) {
                return;
            }
            state.scheduled = Some(state.revision);
            (state.revision, visible)
        };
        self.schedule(next.0, next.1);
    }
    fn schedule(self: &Arc<Self>, revision: u64, visible: bool) {
        let visual = self.clone();
        if let Err(error) = self.host.dispatch(Box::new(move || {
            let icon = {
                let mut state = visual.state.lock().unwrap();
                if !state.active || state.revision != revision || state.scheduled != Some(revision)
                {
                    return;
                }
                state.scheduled = None;
                if state.busy {
                    return;
                }
                state.busy = true;
                state.icon.take()
            };
            let (icon, applied) = match icon {
                Some(icon) => match icon.set_visible(visible) {
                    Ok(()) => (Some(icon), Some(visible)),
                    Err(error) => {
                        log::error!("tray visibility: {error}");
                        (Some(icon), None)
                    }
                },
                None if visible => match visual.host.create_icon() {
                    Ok(icon) => (Some(icon), Some(true)),
                    Err(error) => {
                        log::error!("tray creation: {error}");
                        (None, None)
                    }
                },
                None => (None, Some(false)),
            };
            let next = {
                let mut state = visual.state.lock().unwrap();
                state.icon = icon;
                state.applied = applied;
                state.busy = false;
                if state.active
                    && state.revision != revision
                    && state.scheduled != Some(state.revision)
                {
                    state.scheduled = Some(state.revision);
                    state.desired.map(|desired| (state.revision, desired))
                } else {
                    None
                }
            };
            if let Some((revision, visible)) = next {
                visual.schedule(revision, visible);
            }
        })) {
            let mut state = self.state.lock().unwrap();
            if state.scheduled == Some(revision) {
                state.scheduled = None;
            }
            drop(state);
            log::error!("tray dispatch: {error}");
        }
    }
    fn connected(self: &Arc<Self>, visible: bool) {
        self.update(|state| {
            state.standalone = false;
            state.initial_pending = false;
            state.initial_preference = None;
            state.session += 1;
            Some(visible)
        });
    }
    fn disconnected(self: &Arc<Self>) {
        self.update(|state| {
            let visible = if state.initial_pending {
                state.initial_pending = false;
                state.initial_preference.take().unwrap_or(true)
            } else if state.standalone {
                state.desired.unwrap_or(true)
            } else {
                // A lost established session must actively restore access even when
                // the last completed UI operation already left the icon visible.
                state.applied = None;
                true
            };
            state.standalone = true;
            state.session += 1;
            Some(visible)
        });
    }
    fn request(self: &Arc<Self>, visible: bool) {
        self.update(|state| {
            if state.initial_pending {
                state.initial_preference = Some(visible);
                None
            } else {
                state.standalone.then_some(visible)
            }
        });
    }
    fn unified(self: &Arc<Self>, visible: bool) {
        self.update(|state| (!state.standalone).then_some(visible));
    }
    fn replace_menu(
        &self,
        items: Vec<MenuItem>,
        commands: &mpsc::UnboundedSender<Command>,
    ) -> Result<(), &'static str> {
        let mut state = self.state.lock().unwrap();
        if !state.active {
            return Err("client stopped");
        }
        commands
            .send(Command::Menu(items.clone()))
            .map_err(|_| "client stopped")?;
        state.menu = menu_ids(&items);
        Ok(())
    }
    fn action(self: &Arc<Self>, item_id: String) {
        let session = {
            let state = self.state.lock().unwrap();
            if !state.active || !state.menu.contains(&item_id) {
                return;
            }
            state.session
        };
        let visual = self.clone();
        if let Err(error) = self.host.dispatch(Box::new(move || {
            let valid = {
                let state = visual.state.lock().unwrap();
                state.active && state.session == session && state.menu.contains(&item_id)
            };
            if valid {
                visual.host.action(item_id);
            }
        })) {
            log::error!("action dispatch: {error}");
        }
    }
    fn stop(&self) {
        let mut state = self.state.lock().unwrap();
        state.active = false;
        state.revision += 1;
        state.session += 1;
    }
}

#[derive(Debug)]
enum Failure {
    Io(io::Error),
    Protocol(ProtocolError),
    Reject(RejectCode),
    Timeout,
    Shutdown,
}
impl From<io::Error> for Failure {
    fn from(value: io::Error) -> Self {
        Self::Io(value)
    }
}
impl From<ProtocolError> for Failure {
    fn from(value: ProtocolError) -> Self {
        Self::Protocol(value)
    }
}
impl Failure {
    fn permanent(&self) -> bool {
        matches!(
            self,
            Self::Reject(RejectCode::UnsupportedProtocol | RejectCode::DuplicateApp)
        )
    }
    fn report(&self) {
        match self {
            Self::Io(error) => log::debug!("hub connection: {error}"),
            Self::Protocol(error) => log::error!("hub protocol error: {error}"),
            Self::Reject(RejectCode::InvalidMessage) => {
                log::error!("hub rejected registration: invalid_message")
            }
            Self::Reject(RejectCode::UnsupportedProtocol) => {
                log::warn!("hub rejected connection: unsupported_protocol")
            }
            Self::Reject(RejectCode::DuplicateApp) => {
                log::warn!("hub rejected connection: duplicate_app")
            }
            Self::Reject(RejectCode::Other(_)) => {
                log::warn!("hub rejected connection with an unknown code")
            }
            Self::Timeout => log::debug!("hub connection timed out"),
            Self::Shutdown => {}
        }
    }
}

struct Frames {
    stream: Connection,
    chunk: [u8; 4096],
    offset: usize,
    end: usize,
    line: Vec<u8>,
}
impl Frames {
    fn new(stream: Connection) -> Self {
        Self {
            stream,
            chunk: [0; 4096],
            offset: 0,
            end: 0,
            line: Vec::new(),
        }
    }
    async fn send(&mut self, message: &Message) -> Result<(), Failure> {
        let line = encode(PROTOCOL_VERSION, message)?;
        self.stream.write_all(line.as_bytes()).await?;
        Ok(())
    }
    async fn receive(&mut self) -> Result<Message, Failure> {
        loop {
            if self.offset == self.end {
                self.end = self.stream.read(&mut self.chunk).await?;
                self.offset = 0;
                if self.end == 0 {
                    return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "pipe closed").into());
                }
            }
            let remaining = &self.chunk[self.offset..self.end];
            let newline = remaining.iter().position(|&b| b == b'\n');
            let length = newline.unwrap_or(remaining.len());
            let total = self.line.len() + length;
            let last = if length == 0 {
                self.line.last()
            } else {
                remaining.get(length - 1)
            };
            if total > MAX_LINE_BYTES + 1 || (total == MAX_LINE_BYTES + 1 && last != Some(&b'\r')) {
                return Err(ProtocolError::TooLarge { len: total }.into());
            }
            self.line.extend_from_slice(&remaining[..length]);
            self.offset += length + usize::from(newline.is_some());
            if newline.is_some() {
                let text = std::str::from_utf8(&self.line)
                    .map_err(|error| ProtocolError::Malformed(error.to_string()))?;
                let result = decode(text, PROTOCOL_VERSION).map_err(Failure::from);
                self.line.clear();
                return result;
            }
        }
    }
}

async fn handshake(
    connect: Connect,
    app: AppInfo,
    has_menu: bool,
) -> Result<(Frames, bool, Duration), Failure> {
    let mut frames = Frames::new(connect().await?);
    frames
        .send(&Message::Hello {
            protocol: VersionRange {
                min: PROTOCOL_VERSION,
                max: PROTOCOL_VERSION,
            },
        })
        .await?;
    let (unified, heartbeat) = match frames.receive().await? {
        Message::Welcome {
            protocol,
            unified,
            heartbeat_interval_ms,
        } => {
            if protocol != PROTOCOL_VERSION {
                return Err(ProtocolError::UnsupportedVersion {
                    found: protocol,
                    expected: PROTOCOL_VERSION,
                }
                .into());
            }
            (unified, heartbeat_interval_ms)
        }
        Message::Reject { code, .. } => return Err(Failure::Reject(code)),
        _ => return Err(ProtocolError::Malformed("expected welcome".into()).into()),
    };
    if !HEARTBEAT_INTERVAL_RANGE_MS.contains(&heartbeat) {
        return Err(ProtocolError::Malformed("invalid heartbeat interval".into()).into());
    }
    let capabilities = if has_menu {
        vec![Capability::Menu]
    } else {
        Vec::new()
    };
    frames
        .send(&Message::Register { app, capabilities })
        .await?;
    match frames.receive().await? {
        Message::Registered => Ok((frames, unified, Duration::from_millis(heartbeat.into()))),
        Message::Reject { code, .. } => Err(Failure::Reject(code)),
        _ => Err(ProtocolError::Malformed("expected registered".into()).into()),
    }
}

async fn write_frame(
    frames: &mut Frames,
    message: &Message,
    shutdown: &mut watch::Receiver<bool>,
    limit: Duration,
) -> Result<(), Failure> {
    tokio::select! {
        _ = shutdown.changed() => Err(Failure::Shutdown),
        result = tokio::time::timeout(limit, frames.send(message)) => result.map_err(|_| Failure::Timeout)?,
    }
}

async fn session(
    mut frames: Frames,
    interval: Duration,
    menu: &mut Option<Vec<MenuItem>>,
    visual: &Arc<Visual>,
    commands: &mut mpsc::UnboundedReceiver<Command>,
    shutdown: &mut watch::Receiver<bool>,
) -> Failure {
    let write_limit = interval * MISSED_HEARTBEATS_LIMIT;
    if let Some(items) = menu.as_ref()
        && let Err(error) = write_frame(
            &mut frames,
            &Message::Menu {
                items: items.clone(),
            },
            shutdown,
            write_limit,
        )
        .await
    {
        return error;
    }
    let mut timer = tokio::time::interval_at(tokio::time::Instant::now() + interval, interval);
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut seq = 0_u64;
    let mut acknowledged = 0_u64;
    let mut missed = 0_u32;
    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                visual.stop();
                let _ = tokio::time::timeout(Duration::from_secs(1), frames.send(&Message::Bye)).await;
                return Failure::Shutdown;
            }
            command = commands.recv() => match command {
                Some(Command::Menu(items)) if menu.is_some() => {
                    *menu = Some(items.clone());
                    if let Err(error) = write_frame(&mut frames, &Message::Menu { items }, shutdown, write_limit).await { return error; }
                }
                Some(Command::Menu(_)) => {},
                None => return Failure::Shutdown,
            },
            incoming = frames.receive() => match incoming {
                Ok(Message::Unified { value }) => visual.unified(!value),
                Ok(Message::Action { item_id }) if menu.is_some() => visual.action(item_id),
                Ok(Message::HeartbeatAck { seq: ack }) => {
                    if ack > acknowledged && ack <= seq {
                        acknowledged = ack;
                        missed = 0;
                    }
                }
                Ok(_) => return Failure::Protocol(ProtocolError::Malformed("unexpected hub message".into())),
                Err(error) => return error,
            },
            _ = timer.tick() => {
                if seq > acknowledged {
                    missed += 1;
                    if missed >= MISSED_HEARTBEATS_LIMIT { return Failure::Timeout; }
                }
                seq = match seq.checked_add(1) {
                    Some(next) => next,
                    None => return Failure::Protocol(ProtocolError::Malformed("heartbeat sequence exhausted".into())),
                };
                if let Err(error) = write_frame(&mut frames, &Message::Heartbeat { seq }, shutdown, write_limit).await { return error; }
            }
        }
    }
}

async fn supervise(
    config: Config,
    visual: Arc<Visual>,
    connect: Connect,
    mut commands: mpsc::UnboundedReceiver<Command>,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut menu = config.menu;
    let mut backoff = 1_u64;
    loop {
        let result = {
            let attempt = tokio::time::timeout(
                Duration::from_secs(1),
                handshake(connect.clone(), config.app.clone(), menu.is_some()),
            );
            tokio::pin!(attempt);
            loop {
                tokio::select! {
                    _ = shutdown.changed() => { visual.stop(); return; }
                    command = commands.recv() => match command {
                        Some(Command::Menu(items)) if menu.is_some() => { menu = Some(items); }
                        Some(_) => {},
                        None => { visual.stop(); return; }
                    },
                    result = &mut attempt => break result.map_err(|_| Failure::Timeout).and_then(|value| value),
                }
            }
        };
        let failure = match result {
            Ok((frames, unified, interval)) => {
                backoff = 1;
                visual.connected(!unified);
                session(
                    frames,
                    interval,
                    &mut menu,
                    &visual,
                    &mut commands,
                    &mut shutdown,
                )
                .await
            }
            Err(error) => error,
        };
        if matches!(failure, Failure::Shutdown) {
            visual.stop();
            return;
        }
        failure.report();
        let permanent = failure.permanent();
        visual.disconnected();
        let delay = tokio::time::sleep(Duration::from_secs(backoff));
        tokio::pin!(delay);
        loop {
            tokio::select! {
                _ = shutdown.changed() => { visual.stop(); return; }
                command = commands.recv() => match command {
                    Some(Command::Menu(items)) if menu.is_some() => { menu = Some(items); }
                    Some(_) => {},
                    None => { visual.stop(); return; }
                },
                _ = &mut delay, if !permanent => break,
            }
        }
        backoff = (backoff * 2).min(10);
    }
}

pub(crate) fn start(config: Config, host: Arc<dyn Host>, connect: Connect) -> Handle {
    let (commands, receiver) = mpsc::unbounded_channel();
    let (shutdown, shutdown_receiver) = watch::channel(false);
    let has_menu = config.menu.is_some();
    let initial_menu = menu_ids(config.menu.as_deref().unwrap_or_default());
    let visual = Arc::new(Visual {
        host,
        state: Mutex::new(VisualState {
            revision: 0,
            session: 0,
            active: true,
            standalone: false,
            initial_pending: true,
            initial_preference: None,
            busy: false,
            desired: None,
            applied: None,
            scheduled: None,
            menu: initial_menu,
            icon: None,
        }),
    });
    let task = supervise(config, visual.clone(), connect, receiver, shutdown_receiver);
    #[cfg(test)]
    tokio::spawn(task);
    #[cfg(not(test))]
    tauri::async_runtime::spawn(task);
    Handle {
        commands,
        shutdown,
        visual,
        has_menu,
    }
}
