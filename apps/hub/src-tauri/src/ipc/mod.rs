use std::{
    collections::{BTreeMap, HashMap},
    io,
    sync::{Arc, Mutex},
    time::Duration,
};

use nexo_protocol::{
    AppInfo, Capability, DEFAULT_HEARTBEAT_INTERVAL_MS, MAX_LINE_BYTES, MAX_MENU_ITEMS,
    MISSED_HEARTBEATS_LIMIT, MenuItem, Message, PROTOCOL_VERSION, ProtocolError, QUIT_TIMEOUT_MS,
    QuitReason, RejectCode, VersionRange, decode, encode, negotiate,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    sync::{mpsc, oneshot, watch},
};

#[cfg(test)]
mod tests;
#[cfg(windows)]
pub(crate) mod windows;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct AppSnapshot {
    pub app: AppInfo,
    pub capabilities: Vec<Capability>,
    pub menu: Vec<MenuItem>,
    pub unified: bool,
    pub responsive: bool,
    pub generation: u64,
    pub menu_revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum NoticeOutcome {
    Refused { reason: Option<String> },
    Timeout,
    Unavailable,
    Disconnected,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct NoticeFailure {
    pub app: String,
    pub outcome: NoticeOutcome,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum NoticeDetail {
    Quit {
        all: bool,
        failures: Vec<NoticeFailure>,
    },
    ConnectionClosed,
}

impl NoticeDetail {
    pub(crate) fn message(&self, locale: crate::i18n::Locale) -> String {
        use crate::i18n::text;
        match self {
            Self::ConnectionClosed => text(locale, "connectionClosed").into(),
            Self::Quit { all, failures } => {
                let details = failures
                    .iter()
                    .map(|failure| {
                        let reason = match &failure.outcome {
                            NoticeOutcome::Refused { reason } => {
                                reason.as_deref().unwrap_or_else(|| text(locale, "refused"))
                            }
                            NoticeOutcome::Timeout => text(locale, "timeout"),
                            NoticeOutcome::Unavailable => text(locale, "unavailable"),
                            NoticeOutcome::Disconnected => text(locale, "disconnected"),
                        };
                        format!("{}: {reason}", failure.app)
                    })
                    .collect::<Vec<_>>()
                    .join("; ");
                if *all {
                    text(locale, "staysOpen").replace("{details}", &details)
                } else {
                    details
                }
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct Notice {
    pub message: String,
    pub hub_only_allowed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<NoticeDetail>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub(crate) struct Snapshot {
    pub revision: u64,
    pub apps: Vec<AppSnapshot>,
    pub notice: Option<Notice>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum QuitOutcome {
    Accepted,
    Refused(Option<String>),
    Timeout,
    Unavailable,
    Disconnected,
}

const OUTGOING_CAPACITY: usize = 32;

#[derive(Clone)]
enum Outgoing {
    Show,
    Unified(bool),
    Action {
        revision: u64,
        item_id: String,
    },
    Quit {
        id: u64,
        deadline: tokio::time::Instant,
    },
    HeartbeatAck(u64),
}

struct Entry {
    view: AppSnapshot,
    outgoing: mpsc::Sender<Outgoing>,
    pending: HashMap<u64, oneshot::Sender<(tokio::time::Instant, QuitOutcome)>>,
    last_heartbeat: tokio::time::Instant,
}

#[derive(Default)]
struct Registry {
    apps: BTreeMap<String, Entry>,
    preferences: BTreeMap<String, bool>,
    revision: u64,
    next_generation: u64,
    next_quit: u64,
    exiting: bool,
    require_presentation: bool,
    notice: Option<Notice>,
    launching: Option<(String, watch::Sender<()>)>,
}

#[derive(Clone)]
pub(crate) struct Hub {
    registry: Arc<Mutex<Registry>>,
    // Serializes launches with each other and with synchronous shutdown, not IPC.
    launch_gate: Arc<Mutex<()>>,
    shutdown: watch::Sender<bool>,
    changed: watch::Sender<u64>,
    presented: watch::Sender<u64>,
}

struct Registration {
    hub: Hub,
    id: String,
    generation: u64,
}

struct ExitGuard {
    hub: Hub,
    keep_fenced: bool,
}

struct LaunchGuard<'a> {
    hub: &'a Hub,
}

impl Drop for LaunchGuard<'_> {
    fn drop(&mut self) {
        // Dropping the sender wakes registration and exit waiters even on failure.
        self.hub.registry.lock().unwrap().launching = None;
    }
}

impl Drop for ExitGuard {
    fn drop(&mut self) {
        if !self.keep_fenced {
            self.hub.registry.lock().unwrap().exiting = false;
        }
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        let mut registry = self.hub.registry.lock().unwrap();
        if registry
            .apps
            .get(&self.id)
            .is_some_and(|entry| entry.view.generation == self.generation)
        {
            registry.apps.remove(&self.id);
            self.hub.changed(&mut registry);
        }
    }
}

const VERSIONS: VersionRange = VersionRange {
    min: PROTOCOL_VERSION,
    max: PROTOCOL_VERSION,
};

enum ReceiveError {
    Closed,
    Protocol,
    MalformedRegistration,
}

struct Frames<R> {
    reader: R,
    chunk: [u8; 4096],
    offset: usize,
    end: usize,
    line: Vec<u8>,
}

impl<R: AsyncRead + Unpin> Frames<R> {
    fn new(reader: R) -> Self {
        Self {
            reader,
            chunk: [0; 4096],
            offset: 0,
            end: 0,
            line: Vec::new(),
        }
    }

    async fn receive(&mut self, version: u32) -> Result<Message, ReceiveError> {
        loop {
            if self.offset == self.end {
                self.end = self
                    .reader
                    .read(&mut self.chunk)
                    .await
                    .map_err(|_| ReceiveError::Closed)?;
                self.offset = 0;
                if self.end == 0 {
                    return Err(ReceiveError::Closed);
                }
            }
            let remaining = &self.chunk[self.offset..self.end];
            let newline = remaining.iter().position(|&byte| byte == b'\n');
            let length = newline.unwrap_or(remaining.len());
            let total = self.line.len() + length;
            let last = if length == 0 {
                self.line.last()
            } else {
                remaining.get(length - 1)
            };
            if total > MAX_LINE_BYTES + 1 || (total == MAX_LINE_BYTES + 1 && last != Some(&b'\r')) {
                return Err(ReceiveError::Protocol);
            }
            self.line.extend_from_slice(&remaining[..length]);
            self.offset += length + usize::from(newline.is_some());
            if newline.is_some() {
                let line = std::str::from_utf8(&self.line).map_err(|_| ReceiveError::Protocol)?;
                let result = decode(line, version).map_err(|error| {
                    let registration = matches!(error, ProtocolError::Malformed(_))
                        && serde_json::from_str::<serde_json::Value>(line)
                            .ok()
                            .is_some_and(|value| {
                                value.get("v").and_then(|v| v.as_u64()) == Some(u64::from(version))
                                    && value.get("type").and_then(|v| v.as_str())
                                        == Some("register")
                            });
                    if registration {
                        ReceiveError::MalformedRegistration
                    } else {
                        ReceiveError::Protocol
                    }
                });
                self.line.clear();
                return result;
            }
        }
    }
}

async fn send(
    writer: &mut (impl AsyncWrite + Unpin),
    version: u32,
    message: &Message,
) -> io::Result<()> {
    let line = encode(version, message).map_err(io::Error::other)?;
    writer.write_all(line.as_bytes()).await
}

impl Hub {
    pub(crate) fn new() -> Self {
        let (shutdown, _) = watch::channel(false);
        let (changed, _) = watch::channel(0);
        let (presented, _) = watch::channel(0);
        Self {
            registry: Arc::new(Mutex::new(Registry::default())),
            launch_gate: Arc::new(Mutex::new(())),
            shutdown,
            changed,
            presented,
        }
    }

    fn changed(&self, registry: &mut Registry) {
        registry.revision += 1;
        self.changed.send_replace(registry.revision);
    }

    pub(crate) fn require_presentation(&self) {
        self.registry.lock().unwrap().require_presentation = true;
    }

    pub(crate) fn mark_presented(&self, revision: u64) {
        self.presented.send_if_modified(|current| {
            if *current >= revision {
                false
            } else {
                *current = revision;
                true
            }
        });
    }

    pub(crate) fn subscribe(&self) -> watch::Receiver<u64> {
        self.changed.subscribe()
    }

    pub(crate) fn snapshot(&self) -> Snapshot {
        let registry = self.registry.lock().unwrap();
        Snapshot {
            revision: registry.revision,
            apps: registry
                .apps
                .values()
                .map(|entry| entry.view.clone())
                .collect(),
            notice: registry.notice.clone(),
        }
    }

    async fn register(
        &self,
        app: AppInfo,
        capabilities: Vec<Capability>,
        outgoing: mpsc::Sender<Outgoing>,
    ) -> Result<(Registration, bool, Option<u64>), RejectCode> {
        if app.id.is_empty()
            || !app
                .id
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            || semver::Version::parse(&app.version).is_err()
        {
            return Err(RejectCode::InvalidMessage);
        }
        loop {
            let mut pending = {
                let mut registry = self.registry.lock().unwrap();
                if registry.exiting || *self.shutdown.borrow() {
                    return Err(RejectCode::InvalidMessage);
                }
                if registry.apps.contains_key(&app.id) {
                    return Err(RejectCode::DuplicateApp);
                }
                if let Some((_, finished)) =
                    registry.launching.as_ref().filter(|(id, _)| *id == app.id)
                {
                    finished.subscribe()
                } else {
                    registry.next_generation += 1;
                    let generation = registry.next_generation;
                    let id = app.id.clone();
                    let unified = *registry.preferences.get(&id).unwrap_or(&true);
                    registry.apps.insert(
                        id.clone(),
                        Entry {
                            view: AppSnapshot {
                                app,
                                capabilities,
                                menu: Vec::new(),
                                unified,
                                responsive: true,
                                generation,
                                menu_revision: 0,
                            },
                            outgoing,
                            pending: HashMap::new(),
                            last_heartbeat: tokio::time::Instant::now(),
                        },
                    );
                    self.changed(&mut registry);
                    return Ok((
                        Registration {
                            hub: self.clone(),
                            id,
                            generation,
                        },
                        unified,
                        registry.require_presentation.then_some(registry.revision),
                    ));
                }
            };
            let _ = pending.changed().await;
        }
    }

    pub(crate) fn action(
        &self,
        id: &str,
        generation: u64,
        menu_revision: u64,
        item_id: &str,
    ) -> bool {
        let registry = self.registry.lock().unwrap();
        let Some(entry) = registry.apps.get(id) else {
            return false;
        };
        if entry.view.generation != generation
            || entry.view.menu_revision != menu_revision
            || !entry.view.capabilities.contains(&Capability::Menu)
            || !entry
                .view
                .menu
                .iter()
                .any(|item| item.id == item_id && item.enabled)
        {
            return false;
        }
        entry
            .outgoing
            .try_send(Outgoing::Action {
                revision: menu_revision,
                item_id: item_id.into(),
            })
            .is_ok()
    }

    pub(crate) fn show(&self, id: &str, generation: u64) -> bool {
        self.show_inner(id, generation, false)
    }

    pub(crate) fn show_responsive(&self, id: &str, generation: u64) -> bool {
        self.show_inner(id, generation, true)
    }

    fn show_inner(&self, id: &str, generation: u64, require_responsive: bool) -> bool {
        let registry = self.registry.lock().unwrap();
        registry.apps.get(id).is_some_and(|entry| {
            entry.view.generation == generation
                && (!require_responsive || (!registry.exiting && entry.view.responsive))
                && entry.view.capabilities.contains(&Capability::Show)
                && entry.outgoing.try_send(Outgoing::Show).is_ok()
        })
    }

    pub(crate) fn while_disconnected(
        &self,
        id: &str,
        action: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let _gate = self
            .launch_gate
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        {
            let mut registry = self.registry.lock().unwrap();
            if registry.exiting || *self.shutdown.borrow() || registry.apps.contains_key(id) {
                return Err("nexo.appConnectionChanged".into());
            }
            let (finished, _) = watch::channel(());
            registry.launching = Some((id.into(), finished));
        }
        let _claim = LaunchGuard { hub: self };
        action()
    }

    pub(crate) fn set_unified(&self, id: &str, generation: u64, value: bool) -> bool {
        let mut registry = self.registry.lock().unwrap();
        let Some(entry) = registry.apps.get_mut(id) else {
            return false;
        };
        if entry.view.generation != generation
            || entry.outgoing.try_send(Outgoing::Unified(value)).is_err()
        {
            return false;
        }
        entry.view.unified = value;
        registry.preferences.insert(id.into(), value);
        self.changed(&mut registry);
        true
    }

    pub(crate) async fn quit(&self, id: &str, generation: u64) -> QuitOutcome {
        self.quit_inner(id, generation, false).await
    }

    pub(crate) async fn quit_responsive(&self, id: &str, generation: u64) -> QuitOutcome {
        self.quit_inner(id, generation, true).await
    }

    async fn quit_inner(&self, id: &str, generation: u64, require_responsive: bool) -> QuitOutcome {
        let (request_id, response, deadline) = {
            let mut registry = self.registry.lock().unwrap();
            let supported = registry.apps.get(id).is_some_and(|entry| {
                entry.view.generation == generation
                    && (!require_responsive || entry.view.responsive)
                    && entry.view.capabilities.contains(&Capability::Quit)
            });
            if !supported {
                return QuitOutcome::Unavailable;
            }
            registry.next_quit += 1;
            let request_id = registry.next_quit;
            let entry = registry.apps.get_mut(id).unwrap();
            let (sender, response) = oneshot::channel();
            entry.pending.insert(request_id, sender);
            let deadline =
                tokio::time::Instant::now() + Duration::from_millis(u64::from(QUIT_TIMEOUT_MS));
            if entry
                .outgoing
                .try_send(Outgoing::Quit {
                    id: request_id,
                    deadline,
                })
                .is_err()
            {
                entry.pending.remove(&request_id);
                return QuitOutcome::Unavailable;
            }
            (request_id, response, deadline)
        };
        match tokio::time::timeout_at(deadline, response).await {
            Ok(Ok((received_at, result))) if received_at < deadline => result,
            Ok(Ok(_)) => QuitOutcome::Timeout,
            Ok(Err(_)) if tokio::time::Instant::now() >= deadline => QuitOutcome::Timeout,
            Ok(Err(_)) => QuitOutcome::Disconnected,
            Err(_) => {
                let mut registry = self.registry.lock().unwrap();
                if let Some(entry) = registry.apps.get_mut(id)
                    && entry.view.generation == generation
                {
                    entry.pending.remove(&request_id);
                }
                QuitOutcome::Timeout
            }
        }
    }

    pub(crate) async fn quit_all(&self) -> Vec<(AppInfo, QuitOutcome)> {
        loop {
            let mut pending = {
                let mut registry = self.registry.lock().unwrap();
                if registry.exiting {
                    return vec![(
                        AppInfo {
                            id: "hub".into(),
                            name: "Nexo".into(),
                            version: String::new(),
                        },
                        QuitOutcome::Unavailable,
                    )];
                }
                if let Some((_, finished)) = &registry.launching {
                    finished.subscribe()
                } else {
                    registry.exiting = true;
                    break;
                }
            };
            let _ = pending.changed().await;
        }
        let mut guard = ExitGuard {
            hub: self.clone(),
            keep_fenced: false,
        };
        let snapshot = self.snapshot();
        let mut tasks = tokio::task::JoinSet::new();
        for entry in snapshot.apps {
            let hub = self.clone();
            tasks.spawn(async move {
                let result = hub.quit(&entry.app.id, entry.generation).await;
                (entry.app, entry.generation, result)
            });
        }
        let mut completed = Vec::new();
        while let Some(result) = tasks.join_next().await {
            if let Ok(value) = result {
                completed.push(value);
            } else {
                // A task failure must never be interpreted as a safe hub exit.
                return vec![(
                    AppInfo {
                        id: "hub".into(),
                        name: "Nexo".into(),
                        version: String::new(),
                    },
                    QuitOutcome::Unavailable,
                )];
            }
        }
        // Reconnecting clients are new sessions, even when an earlier quit was accepted.
        for current in self.snapshot().apps {
            if !completed.iter().any(|(app, generation, _)| {
                app.id == current.app.id && *generation == current.generation
            }) {
                completed.push((current.app, current.generation, QuitOutcome::Unavailable));
            }
        }
        completed.sort_by(|a, b| a.0.id.cmp(&b.0.id));
        guard.keep_fenced = completed
            .iter()
            .all(|(_, _, result)| *result == QuitOutcome::Accepted);
        completed
            .into_iter()
            .map(|(app, _, result)| (app, result))
            .collect()
    }

    fn store_notice(&self, notice: Notice) {
        let mut registry = self.registry.lock().unwrap();
        registry.notice = Some(notice);
        self.changed(&mut registry);
    }

    #[cfg(test)]
    pub(crate) fn set_notice(&self, message: String, hub_only_allowed: bool) {
        self.store_notice(Notice {
            message,
            hub_only_allowed,
            detail: None,
        });
    }

    pub(crate) fn set_notice_detail(&self, detail: NoticeDetail, hub_only_allowed: bool) {
        self.store_notice(Notice {
            message: detail.message(crate::i18n::Locale::Es),
            hub_only_allowed,
            detail: Some(detail),
        });
    }

    pub(crate) fn clear_notice(&self) {
        let mut registry = self.registry.lock().unwrap();
        if registry.notice.take().is_some() {
            self.changed(&mut registry);
        }
    }

    pub(crate) fn hub_only_exit(&self) -> bool {
        let mut registry = self.registry.lock().unwrap();
        if !registry
            .notice
            .as_ref()
            .is_some_and(|notice| notice.hub_only_allowed)
        {
            return false;
        }
        registry.exiting = true;
        drop(registry);
        self.shutdown();
        true
    }

    pub(crate) fn shutdown(&self) {
        let _gate = self
            .launch_gate
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut registry = self.registry.lock().unwrap();
        registry.exiting = true;
        self.shutdown.send_replace(true);
        if !registry.apps.is_empty() {
            registry.apps.clear();
            self.changed(&mut registry);
        }
    }

    fn outgoing_message(
        &self,
        registration: &Registration,
        outgoing: &Outgoing,
    ) -> Option<Message> {
        let registry = self.registry.lock().unwrap();
        let entry = registry.apps.get(&registration.id)?;
        if entry.view.generation != registration.generation {
            return None;
        }
        match outgoing {
            Outgoing::Show if entry.view.capabilities.contains(&Capability::Show) => {
                Some(Message::Show)
            }
            Outgoing::Unified(value) if entry.view.unified == *value => {
                Some(Message::Unified { value: *value })
            }
            Outgoing::Action { revision, item_id }
                if entry.view.menu_revision == *revision
                    && entry.view.capabilities.contains(&Capability::Menu)
                    && entry
                        .view
                        .menu
                        .iter()
                        .any(|item| item.id == *item_id && item.enabled) =>
            {
                Some(Message::Action {
                    item_id: item_id.clone(),
                })
            }
            Outgoing::Quit { id, deadline }
                if tokio::time::Instant::now() < *deadline
                    && entry.pending.contains_key(id)
                    && entry.view.capabilities.contains(&Capability::Quit) =>
            {
                Some(Message::Quit {
                    id: *id,
                    reason: QuitReason::User,
                })
            }
            Outgoing::HeartbeatAck(seq) => Some(Message::HeartbeatAck { seq: *seq }),
            _ => None,
        }
    }

    async fn write_outgoing(
        &self,
        writer: &mut (impl AsyncWrite + Unpin),
        registration: &Registration,
        version: u32,
        outgoing: Outgoing,
    ) -> io::Result<()> {
        let mut changed = self.changed.subscribe();
        let Some(message) = self.outgoing_message(registration, &outgoing) else {
            return Ok(());
        };
        let line = encode(version, &message).map_err(io::Error::other)?;
        let deadline = match outgoing {
            Outgoing::Quit { deadline, .. } => deadline,
            _ => tokio::time::Instant::now() + Duration::from_millis(u64::from(QUIT_TIMEOUT_MS)),
        };
        let write = writer.write_all(line.as_bytes());
        tokio::pin!(write);
        loop {
            tokio::select! {
                biased;
                _ = tokio::time::sleep_until(deadline) => return Err(io::Error::new(io::ErrorKind::TimedOut, "outgoing frame deadline")),
                change = changed.changed() => {
                    if change.is_err() || self.outgoing_message(registration, &outgoing).is_none() {
                        return Err(io::Error::new(io::ErrorKind::Interrupted, "outgoing frame became stale"));
                    }
                }
                result = &mut write => return result,
            }
        }
    }

    fn set_responsive(
        &self,
        registration: &Registration,
        responsive: bool,
    ) -> Option<tokio::time::Instant> {
        let mut registry = self.registry.lock().unwrap();
        let entry = registry.apps.get_mut(&registration.id)?;
        if entry.view.generation != registration.generation {
            return None;
        }
        if responsive {
            entry.last_heartbeat = tokio::time::Instant::now();
        }
        let last_heartbeat = entry.last_heartbeat;
        let changed = entry.view.responsive != responsive;
        entry.view.responsive = responsive;
        if changed {
            self.changed(&mut registry);
        }
        Some(last_heartbeat)
    }

    fn replace_menu(&self, registration: &Registration, items: Vec<MenuItem>) -> bool {
        let mut registry = self.registry.lock().unwrap();
        let Some(entry) = registry.apps.get_mut(&registration.id) else {
            return false;
        };
        if entry.view.generation != registration.generation
            || !entry.view.capabilities.contains(&Capability::Menu)
            || items.len() > MAX_MENU_ITEMS
        {
            return false;
        }
        entry.view.menu = items;
        entry.view.menu_revision += 1;
        self.changed(&mut registry);
        true
    }

    fn quit_result(
        &self,
        registration: &Registration,
        id: u64,
        accepted: bool,
        reason: Option<String>,
    ) {
        let mut registry = self.registry.lock().unwrap();
        if let Some(entry) = registry.apps.get_mut(&registration.id)
            && entry.view.generation == registration.generation
            && let Some(sender) = entry.pending.remove(&id)
        {
            let result = if accepted {
                QuitOutcome::Accepted
            } else {
                QuitOutcome::Refused(reason)
            };
            let _ = sender.send((tokio::time::Instant::now(), result));
        }
    }

    pub(crate) async fn serve<S>(&self, stream: S)
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let mut shutdown = self.shutdown.subscribe();
        if *shutdown.borrow() {
            return;
        }
        tokio::select! {
            _ = shutdown.changed() => {},
            _ = self.serve_inner(stream) => {},
        }
    }

    async fn serve_inner<S>(&self, stream: S)
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (reader, mut writer) = tokio::io::split(stream);
        let mut frames = Frames::new(reader);
        let Ok(Message::Hello { protocol }) = frames.receive(PROTOCOL_VERSION).await else {
            return;
        };
        let Some(version) = negotiate(VERSIONS, protocol) else {
            let _ = send(
                &mut writer,
                PROTOCOL_VERSION,
                &Message::Reject {
                    code: RejectCode::UnsupportedProtocol,
                    hub_protocol: Some(VERSIONS),
                },
            )
            .await;
            return;
        };
        if send(
            &mut writer,
            version,
            &Message::Welcome {
                protocol: version,
                unified: true,
                heartbeat_interval_ms: DEFAULT_HEARTBEAT_INTERVAL_MS,
            },
        )
        .await
        .is_err()
        {
            return;
        }
        let (app, capabilities) = match frames.receive(version).await {
            Ok(Message::Register { app, capabilities }) => (app, capabilities),
            Err(ReceiveError::MalformedRegistration) => {
                let _ = send(
                    &mut writer,
                    version,
                    &Message::Reject {
                        code: RejectCode::InvalidMessage,
                        hub_protocol: None,
                    },
                )
                .await;
                return;
            }
            _ => return,
        };
        let (outgoing, mut commands) = mpsc::channel(OUTGOING_CAPACITY);
        let (registration, unified, presentation) =
            match self.register(app, capabilities, outgoing.clone()).await {
                Ok(registration) => registration,
                Err(code) => {
                    let _ = send(
                        &mut writer,
                        version,
                        &Message::Reject {
                            code,
                            hub_protocol: None,
                        },
                    )
                    .await;
                    return;
                }
            };
        if let Some(revision) = presentation {
            let mut presented = self.presented.subscribe();
            while *presented.borrow_and_update() < revision {
                tokio::select! {
                    result = presented.changed() => if result.is_err() { return; },
                    _ = frames.receive(version) => return,
                }
            }
        }
        if send(&mut writer, version, &Message::Registered)
            .await
            .is_err()
        {
            return;
        }
        if !unified
            && send(&mut writer, version, &Message::Unified { value: false })
                .await
                .is_err()
        {
            return;
        }
        let timeout = Duration::from_millis(
            u64::from(DEFAULT_HEARTBEAT_INTERVAL_MS) * u64::from(MISSED_HEARTBEATS_LIMIT),
        );
        let Some(last_heartbeat) = self.set_responsive(&registration, true) else {
            return;
        };
        let mut deadline = last_heartbeat + timeout;
        let mut responsive = true;
        let writes = async {
            while let Some(command) = commands.recv().await {
                self.write_outgoing(&mut writer, &registration, version, command)
                    .await?;
            }
            Ok::<(), io::Error>(())
        };
        tokio::pin!(writes);
        loop {
            tokio::select! {
                _ = tokio::time::sleep_until(deadline), if responsive => {
                    responsive = false;
                    let _ = self.set_responsive(&registration, false);
                }
                _ = &mut writes => return,
                message = frames.receive(version) => match message {
                    Ok(Message::Heartbeat { seq }) => {
                        let Some(last_heartbeat) = self.set_responsive(&registration, true) else { return; };
                        deadline = last_heartbeat + timeout;
                        responsive = true;
                        if outgoing.try_send(Outgoing::HeartbeatAck(seq)).is_err() { return; }
                    }
                    Ok(Message::Menu { items }) => if !self.replace_menu(&registration, items) { return; },
                    Ok(Message::QuitResult { id, accepted, reason }) => self.quit_result(&registration, id, accepted, reason),
                    Ok(Message::Bye) | Err(_) => return,
                    _ => return,
                }
            }
        }
    }
}
