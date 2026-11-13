use std::{
    collections::VecDeque,
    io,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use nexo_protocol::{
    AppInfo, Capability, MAX_LINE_BYTES, MAX_MENU_ITEMS, MenuItem, Message, RejectCode,
    VersionRange, decode, encode,
};
use tokio::io::{
    AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader, ReadHalf, WriteHalf,
};

use crate::client::{self, Config, Connect, Connection, Host, Icon, Job};

#[derive(Default)]
struct FakeHost {
    jobs: Mutex<VecDeque<Job>>,
    on_create: Mutex<Option<Job>>,
    events: Arc<Mutex<Vec<String>>>,
    fail_create: AtomicBool,
    fail_show: Arc<AtomicBool>,
    fail_dispatch: AtomicBool,
    #[cfg(windows)]
    ready: tokio::sync::Notify,
}

struct FakeIcon {
    events: Arc<Mutex<Vec<String>>>,
    fail_show: Arc<AtomicBool>,
}
impl Icon for FakeIcon {
    fn set_visible(&self, visible: bool) -> Result<(), String> {
        if visible && self.fail_show.swap(false, Ordering::SeqCst) {
            self.events.lock().unwrap().push("show-error".into());
            return Err("transient show error".into());
        }
        self.events
            .lock()
            .unwrap()
            .push(format!("visible:{visible}"));
        Ok(())
    }
}
impl Host for FakeHost {
    fn dispatch(&self, job: Job) -> Result<(), String> {
        if self.fail_dispatch.swap(false, Ordering::SeqCst) {
            self.events.lock().unwrap().push("dispatch-error".into());
            return Err("transient dispatch error".into());
        }
        self.jobs.lock().unwrap().push_back(job);
        #[cfg(windows)]
        self.ready.notify_one();
        Ok(())
    }
    fn create_icon(&self) -> Result<Box<dyn Icon>, String> {
        if self.fail_create.swap(false, Ordering::SeqCst) {
            self.events.lock().unwrap().push("create-error".into());
            return Err("transient factory error".into());
        }
        self.events.lock().unwrap().push("create".into());
        let hook = self.on_create.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
        Ok(Box::new(FakeIcon {
            events: self.events.clone(),
            fail_show: self.fail_show.clone(),
        }))
    }
    fn action(&self, item_id: String) {
        self.events
            .lock()
            .unwrap()
            .push(format!("action:{item_id}"));
    }
}
impl FakeHost {
    fn pump(&self) {
        loop {
            let job = self.jobs.lock().unwrap().pop_front();
            match job {
                Some(job) => job(),
                None => return,
            }
        }
    }
    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }
    #[cfg(windows)]
    async fn wait_events(&self, count: usize) {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                self.pump();
                if self.events().len() >= count {
                    break;
                }
                self.ready.notified().await;
            }
        })
        .await
        .expect("expected host callbacks");
    }
}

#[derive(Default)]
struct ScriptedConnector {
    streams: Mutex<VecDeque<Connection>>,
    attempts: Mutex<usize>,
}
impl ScriptedConnector {
    fn add(&self) -> Hub {
        self.add_with_capacity(256 * 1024)
    }
    fn add_with_capacity(&self, capacity: usize) -> Hub {
        let (client, server) = tokio::io::duplex(capacity);
        self.streams.lock().unwrap().push_back(Box::new(client));
        Hub::new(server)
    }
    fn connector(self: &Arc<Self>) -> Connect {
        let this = self.clone();
        Arc::new(move || {
            *this.attempts.lock().unwrap() += 1;
            let stream = this.streams.lock().unwrap().pop_front();
            Box::pin(async move {
                stream.ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "missing pipe"))
            })
        })
    }
}

struct Hub {
    reader: BufReader<ReadHalf<Connection>>,
    writer: WriteHalf<Connection>,
}
impl Hub {
    fn new(stream: impl AsyncRead + AsyncWrite + Unpin + Send + 'static) -> Self {
        let stream: Connection = Box::new(stream);
        let (reader, writer) = tokio::io::split(stream);
        Self {
            reader: BufReader::new(reader),
            writer,
        }
    }
    async fn receive(&mut self) -> Message {
        let mut line = String::new();
        let n = tokio::time::timeout(Duration::from_secs(5), self.reader.read_line(&mut line))
            .await
            .expect("client should send a frame")
            .expect("read frame");
        assert_ne!(n, 0, "client closed before sending a frame");
        decode(&line, 1).expect("valid protocol frame")
    }
    async fn send(&mut self, message: Message) {
        self.writer
            .write_all(encode(1, &message).unwrap().as_bytes())
            .await
            .unwrap();
    }
    async fn raw(&mut self, bytes: &[u8]) {
        self.writer.write_all(bytes).await.unwrap();
    }
    async fn handshake(&mut self, unified: bool, menu: &[MenuItem]) {
        self.handshake_with_interval(unified, menu, 5_000).await;
    }
    async fn handshake_with_interval(&mut self, unified: bool, menu: &[MenuItem], interval: u32) {
        assert_eq!(
            self.receive().await,
            Message::Hello {
                protocol: VersionRange { min: 1, max: 1 }
            }
        );
        self.send(Message::Welcome {
            protocol: 1,
            unified,
            heartbeat_interval_ms: interval,
        })
        .await;
        assert_eq!(
            self.receive().await,
            Message::Register {
                app: app(),
                capabilities: vec![Capability::Menu],
            }
        );
        self.send(Message::Registered).await;
        assert_eq!(
            self.receive().await,
            Message::Menu {
                items: menu.to_vec()
            }
        );
    }
}

fn app() -> AppInfo {
    AppInfo {
        id: "sample-app".into(),
        name: "Sample".into(),
        version: "1.0.0".into(),
    }
}
fn item(id: &str) -> MenuItem {
    MenuItem {
        id: id.into(),
        label: id.into(),
        enabled: true,
        checked: None,
    }
}
fn start(host: &Arc<FakeHost>, connector: &Arc<ScriptedConnector>) -> client::Handle {
    client::start(
        Config {
            app: app(),
            menu: Some(vec![item("capture")]),
        },
        host.clone(),
        connector.connector(),
    )
}
async fn settle() {
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
}

#[test]
fn original_noop_init_remains_available() {
    use tauri::plugin::Plugin;
    let plugin = crate::init::<tauri::test::MockRuntime>();
    assert_eq!(plugin.name(), "nexo");
}

#[tokio::test(start_paused = true)]
async fn missing_pipe_creates_standalone_icon_without_waiting() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let _handle = start(&host, &connector);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    assert_eq!(*connector.attempts.lock().unwrap(), 1);
}

#[tokio::test(start_paused = true)]
async fn unified_start_registers_menu_without_creating_an_icon() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let _handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), Vec::<String>::new());
}

#[tokio::test(start_paused = true)]
async fn non_unified_start_registers_and_creates_one_icon() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let _handle = start(&host, &connector);
    hub.handshake(false, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
}

#[tokio::test(start_paused = true)]
async fn correction_b1_initial_hidden_preference_survives_stalled_handshake() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    assert!(matches!(hub.receive().await, Message::Hello { .. }));
    handle.set_visible(true);
    handle.set_visible(false);
    host.pump();
    assert!(host.events().is_empty());
    tokio::time::advance(Duration::from_secs(1)).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), Vec::<String>::new());
    tokio::time::advance(Duration::from_secs(1)).await;
    settle().await;
    host.pump();
    assert_eq!(*connector.attempts.lock().unwrap(), 2);
    assert_eq!(host.events(), Vec::<String>::new());
    handle.set_visible(true);
    host.pump();
    assert_eq!(host.events(), ["create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn correction_b1_pending_preference_never_creates_icon_for_unified_start() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    handle.set_visible(true);
    handle.set_visible(false);
    handle.set_visible(true);
    hub.handshake(true, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert!(host.events().is_empty());
    hub.send(Message::Unified { value: false }).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn correction_b2_failed_factory_retries_on_same_visible_request() {
    let host = Arc::new(FakeHost::default());
    host.fail_create.store(true, Ordering::SeqCst);
    let connector = Arc::new(ScriptedConnector::default());
    let handle = start(&host, &connector);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create-error"]);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create-error"]);
    handle.set_visible(true);
    host.pump();
    assert_eq!(host.events(), ["create-error", "create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn correction_b2_lifecycle_transition_retries_failed_factory() {
    let host = Arc::new(FakeHost::default());
    host.fail_create.store(true, Ordering::SeqCst);
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(false, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create-error"]);
    hub.send(Message::Unified { value: false }).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create-error", "create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn correction_b2_failed_show_retries_on_same_visible_request() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let handle = start(&host, &connector);
    settle().await;
    host.pump();
    handle.set_visible(false);
    host.pump();
    host.fail_show.store(true, Ordering::SeqCst);
    handle.set_visible(true);
    host.pump();
    assert_eq!(host.events(), ["create", "visible:false", "show-error"]);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create", "visible:false", "show-error"]);
    handle.set_visible(true);
    host.pump();
    assert_eq!(
        host.events(),
        ["create", "visible:false", "show-error", "visible:true"]
    );
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn correction_b2_failed_dispatch_retries_on_same_visible_request() {
    let host = Arc::new(FakeHost::default());
    host.fail_dispatch.store(true, Ordering::SeqCst);
    let connector = Arc::new(ScriptedConnector::default());
    let handle = start(&host, &connector);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["dispatch-error"]);
    handle.set_visible(true);
    host.pump();
    assert_eq!(host.events(), ["dispatch-error", "create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn correction_preserves_last_handle_drop_cleanup() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let handle = start(&host, &connector);
    settle().await;
    assert_eq!(*connector.attempts.lock().unwrap(), 1);
    drop(handle);
    settle().await;
    host.pump();
    assert!(host.events().is_empty());
    tokio::time::advance(Duration::from_secs(30)).await;
    settle().await;
    host.pump();
    assert!(host.events().is_empty());
    assert_eq!(*connector.attempts.lock().unwrap(), 1);
}

#[tokio::test(start_paused = true)]
async fn oversized_menu_is_rejected_without_changing_the_registered_menu() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    assert!(
        handle
            .replace_menu(vec![item("too-many"); MAX_MENU_ITEMS + 1])
            .is_err()
    );
    hub.handshake(true, &[item("capture")]).await;
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn menu_replacement_dispatches_known_actions_only() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    let items: Vec<_> = (0..MAX_MENU_ITEMS)
        .map(|i| item(&format!("item-{i}")))
        .collect();
    handle.replace_menu(items.clone()).unwrap();
    assert_eq!(hub.receive().await, Message::Menu { items });
    hub.send(Message::Action {
        item_id: "item-3".into(),
    })
    .await;
    hub.send(Message::Action {
        item_id: "capture".into(),
    })
    .await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["action:item-3"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn unified_changes_win_over_host_preferences_and_reuse_the_icon() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    hub.send(Message::Unified { value: false }).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    handle.set_visible(false);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    hub.send(Message::Unified { value: true }).await;
    settle().await;
    host.pump();
    hub.send(Message::Unified { value: false }).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create", "visible:false", "visible:true"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn loss_restores_access_then_reconnect_hides_without_duplicate_icons() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    drop(hub);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    let mut replacement = connector.add();
    tokio::time::advance(Duration::from_secs(1)).await;
    replacement.handshake(true, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create", "visible:false"]);
    drop(replacement);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create", "visible:false", "visible:true"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn stale_queued_creation_is_fenced_at_execution() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let handle = start(&host, &connector);
    settle().await;
    let mut hub = connector.add();
    tokio::time::advance(Duration::from_secs(1)).await;
    hub.handshake(true, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), Vec::<String>::new());
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn initial_deadline_cancels_stalled_attempt_before_retry() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut stalled = connector.add();
    let handle = start(&host, &connector);
    assert!(matches!(stalled.receive().await, Message::Hello { .. }));
    tokio::time::advance(Duration::from_secs(1)).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    let late = encode(
        1,
        &Message::Welcome {
            protocol: 1,
            unified: true,
            heartbeat_interval_ms: 5000,
        },
    )
    .unwrap();
    assert!(stalled.writer.write_all(late.as_bytes()).await.is_err());
    let mut next = connector.add();
    tokio::time::advance(Duration::from_secs(1)).await;
    next.handshake(true, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create", "visible:false"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn initial_deadline_is_shared_across_welcome_and_registration() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    assert!(matches!(hub.receive().await, Message::Hello { .. }));
    tokio::time::advance(Duration::from_millis(500)).await;
    hub.send(Message::Welcome {
        protocol: 1,
        unified: true,
        heartbeat_interval_ms: 5000,
    })
    .await;
    assert!(matches!(hub.receive().await, Message::Register { .. }));
    tokio::time::advance(Duration::from_millis(500)).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    assert!(
        hub.writer
            .write_all(encode(1, &Message::Registered).unwrap().as_bytes())
            .await
            .is_err()
    );
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn failed_attempts_use_capped_exponential_backoff_and_shutdown_stops_them() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let handle = start(&host, &connector);
    settle().await;
    assert_eq!(*connector.attempts.lock().unwrap(), 1);
    for (n, seconds) in [1, 2, 4, 8, 10, 10].into_iter().enumerate() {
        tokio::time::advance(Duration::from_secs(seconds) - Duration::from_millis(1)).await;
        settle().await;
        assert_eq!(*connector.attempts.lock().unwrap(), n + 1);
        tokio::time::advance(Duration::from_millis(1)).await;
        settle().await;
        assert_eq!(*connector.attempts.lock().unwrap(), n + 2);
    }
    host.pump();
    assert_eq!(host.events().iter().filter(|e| *e == "create").count(), 1);
    handle.shutdown();
    settle().await;
    tokio::time::advance(Duration::from_secs(30)).await;
    settle().await;
    assert_eq!(*connector.attempts.lock().unwrap(), 7);
}

#[tokio::test(start_paused = true)]
async fn rejection_policy_distinguishes_permanent_and_retryable_codes() {
    for (code, retry) in [
        (RejectCode::UnsupportedProtocol, false),
        (RejectCode::DuplicateApp, false),
        (RejectCode::InvalidMessage, true),
        (RejectCode::Other("maintenance".into()), true),
    ] {
        let host = Arc::new(FakeHost::default());
        let connector = Arc::new(ScriptedConnector::default());
        let mut hub = connector.add();
        let handle = start(&host, &connector);
        assert!(matches!(hub.receive().await, Message::Hello { .. }));
        hub.send(Message::Reject {
            code,
            hub_protocol: None,
        })
        .await;
        settle().await;
        host.pump();
        assert_eq!(host.events(), ["create"]);
        tokio::time::advance(Duration::from_secs(1)).await;
        settle().await;
        assert_eq!(
            *connector.attempts.lock().unwrap(),
            if retry { 2 } else { 1 }
        );
        handle.shutdown();
    }
}

#[tokio::test(start_paused = true)]
async fn malformed_oversized_wrong_version_and_wrong_order_restore_access() {
    let frames = vec![
        b"not json\n".to_vec(),
        format!("{}\n", "x".repeat(MAX_LINE_BYTES + 1)).into_bytes(),
        b"{\"v\":2,\"type\":\"unified\",\"value\":false}\n".to_vec(),
        b"{\"v\":1,\"type\":\"registered\"}\n".to_vec(),
        vec![0xff, b'\n'],
    ];
    for bad in frames {
        let host = Arc::new(FakeHost::default());
        let connector = Arc::new(ScriptedConnector::default());
        let mut hub = connector.add();
        let handle = start(&host, &connector);
        hub.handshake(true, &[item("capture")]).await;
        hub.raw(&bad).await;
        settle().await;
        host.pump();
        assert_eq!(host.events(), ["create"]);
        handle.shutdown();
    }
}

#[tokio::test(start_paused = true)]
async fn fragmented_utf8_crlf_frame_is_retained_across_control_events() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    let frame = "{\"v\":1,\"type\":\"unified\",\"value\":false,\"future\":\"ñ\"}\r\n".as_bytes();
    let split = frame.iter().position(|b| *b == 0xc3).unwrap() + 1;
    hub.raw(&frame[..split]).await;
    settle().await;
    handle.replace_menu(vec![item("updated")]).unwrap();
    assert_eq!(
        hub.receive().await,
        Message::Menu {
            items: vec![item("updated")]
        }
    );
    hub.raw(&frame[split..]).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn maximum_sized_crlf_frame_is_accepted() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    let prefix = "{\"v\":1,\"type\":\"unified\",\"value\":false,\"future\":\"";
    let suffix = "\"}";
    let frame = format!(
        "{prefix}{}{suffix}",
        "x".repeat(MAX_LINE_BYTES - prefix.len() - suffix.len())
    );
    assert_eq!(frame.len(), MAX_LINE_BYTES);
    hub.raw(format!("{frame}\r\n").as_bytes()).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn heartbeat_ack_and_three_missed_intervals_control_recovery() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    tokio::time::advance(Duration::from_secs(5)).await;
    assert_eq!(hub.receive().await, Message::Heartbeat { seq: 1 });
    hub.send(Message::HeartbeatAck { seq: 1 }).await;
    settle().await;
    for seq in 2..=4 {
        tokio::time::advance(Duration::from_secs(5)).await;
        assert_eq!(hub.receive().await, Message::Heartbeat { seq });
        host.pump();
        assert!(host.events().is_empty());
    }
    tokio::time::advance(Duration::from_secs(5)).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn delayed_valid_heartbeat_ack_resets_the_consecutive_miss_count() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    for seq in 1..=3 {
        tokio::time::advance(Duration::from_secs(5)).await;
        assert_eq!(hub.receive().await, Message::Heartbeat { seq });
    }
    hub.send(Message::HeartbeatAck { seq: 1 }).await;
    settle().await;
    for seq in 4..=5 {
        tokio::time::advance(Duration::from_secs(5)).await;
        assert_eq!(hub.receive().await, Message::Heartbeat { seq });
        host.pump();
        assert!(host.events().is_empty());
    }
    tokio::time::advance(Duration::from_secs(5)).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn shutdown_sends_bye_and_cancels_stale_queued_work() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(false, &[item("capture")]).await;
    handle.shutdown();
    assert_eq!(hub.receive().await, Message::Bye);
    settle().await;
    host.pump();
    assert!(host.events().is_empty());
    tokio::time::advance(Duration::from_secs(20)).await;
    settle().await;
    assert_eq!(*connector.attempts.lock().unwrap(), 1);
}

#[tokio::test(start_paused = true)]
async fn standalone_visibility_request_immediately_fences_queued_creation() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let handle = start(&host, &connector);
    settle().await;
    handle.set_visible(false);
    host.pump();
    assert!(host.events().is_empty());
    handle.set_visible(true);
    host.pump();
    assert_eq!(host.events(), ["create"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn reentrant_factory_never_creates_a_second_icon_or_deadlocks() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let handle = start(&host, &connector);
    let nested_host = host.clone();
    let nested_handle = handle.clone();
    *host.on_create.lock().unwrap() = Some(Box::new(move || {
        nested_handle.set_visible(false);
        nested_host.pump();
        nested_handle.set_visible(true);
        nested_host.pump();
    }));
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create", "visible:true"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn canceled_partial_write_closes_the_session_instead_of_sending_bye() {
    use tokio::io::AsyncReadExt;
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add_with_capacity(128);
    let handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    let mut large = item("large");
    large.label = "x".repeat(60_000);
    let expected = encode(
        1,
        &Message::Menu {
            items: vec![large.clone()],
        },
    )
    .unwrap();
    handle.replace_menu(vec![large]).unwrap();
    settle().await;
    handle.shutdown();
    settle().await;
    let mut bytes = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), hub.reader.read_to_end(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    assert!(!bytes.is_empty() && bytes.len() < expected.len());
    assert!(!bytes.contains(&b'\n'));
}

#[tokio::test(start_paused = true)]
async fn shutdown_immediately_fences_a_queued_icon_creation() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(false, &[item("capture")]).await;
    handle.shutdown();
    host.pump();
    assert!(host.events().is_empty());
    assert_eq!(hub.receive().await, Message::Bye);
}

#[tokio::test(start_paused = true)]
async fn menu_replacement_immediately_fences_a_queued_old_action() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(true, &[item("capture")]).await;
    hub.send(Message::Action {
        item_id: "capture".into(),
    })
    .await;
    settle().await;
    handle.replace_menu(vec![item("updated")]).unwrap();
    host.pump();
    assert!(host.events().is_empty());
    assert_eq!(
        hub.receive().await,
        Message::Menu {
            items: vec![item("updated")]
        }
    );
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn stale_action_and_hide_from_a_lost_session_never_execute() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(false, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    hub.send(Message::Action {
        item_id: "capture".into(),
    })
    .await;
    hub.send(Message::Unified { value: true }).await;
    settle().await;
    drop(hub);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create", "visible:true"]);
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn welcome_checks_version_interval_boundaries_and_order() {
    for (protocol, interval) in [(2, 5000), (1, 999), (1, 60001)] {
        let host = Arc::new(FakeHost::default());
        let connector = Arc::new(ScriptedConnector::default());
        let mut hub = connector.add();
        let handle = start(&host, &connector);
        assert!(matches!(hub.receive().await, Message::Hello { .. }));
        hub.send(Message::Welcome {
            protocol,
            unified: true,
            heartbeat_interval_ms: interval,
        })
        .await;
        settle().await;
        host.pump();
        assert_eq!(host.events(), ["create"]);
        handle.shutdown();
    }
    for interval in [1000, 60000] {
        let host = Arc::new(FakeHost::default());
        let connector = Arc::new(ScriptedConnector::default());
        let mut hub = connector.add();
        let handle = start(&host, &connector);
        assert!(matches!(hub.receive().await, Message::Hello { .. }));
        hub.send(Message::Welcome {
            protocol: 1,
            unified: true,
            heartbeat_interval_ms: interval,
        })
        .await;
        assert!(matches!(hub.receive().await, Message::Register { .. }));
        hub.send(Message::Registered).await;
        assert_eq!(
            hub.receive().await,
            Message::Menu {
                items: vec![item("capture")]
            }
        );
        handle.shutdown();
    }
    for wrong in [Message::Registered, Message::Unified { value: false }] {
        let host = Arc::new(FakeHost::default());
        let connector = Arc::new(ScriptedConnector::default());
        let mut hub = connector.add();
        let handle = start(&host, &connector);
        assert!(matches!(hub.receive().await, Message::Hello { .. }));
        hub.send(wrong).await;
        settle().await;
        host.pump();
        assert_eq!(host.events(), ["create"]);
        handle.shutdown();
    }
}

#[tokio::test(start_paused = true)]
async fn no_menu_configuration_advertises_no_unimplemented_capability() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = client::start(
        Config {
            app: app(),
            menu: None,
        },
        host.clone(),
        connector.connector(),
    );
    assert!(matches!(hub.receive().await, Message::Hello { .. }));
    hub.send(Message::Welcome {
        protocol: 1,
        unified: true,
        heartbeat_interval_ms: 5000,
    })
    .await;
    assert_eq!(
        hub.receive().await,
        Message::Register {
            app: app(),
            capabilities: vec![]
        }
    );
    hub.send(Message::Registered).await;
    settle().await;
    assert!(handle.replace_menu(vec![item("capture")]).is_err());
    handle.shutdown();
    assert_eq!(hub.receive().await, Message::Bye);
    host.pump();
    assert!(host.events().is_empty());
}

struct TestLogger;
static TEST_LOGGER: TestLogger = TestLogger;
static LOGS: Mutex<Vec<String>> = Mutex::new(Vec::new());
impl log::Log for TestLogger {
    fn enabled(&self, _: &log::Metadata<'_>) -> bool {
        true
    }
    fn log(&self, record: &log::Record<'_>) {
        LOGS.lock().unwrap().push(format!("{}", record.args()));
    }
    fn flush(&self) {}
}

#[tokio::test(start_paused = true)]
async fn invalid_registration_is_logged_falls_back_and_retries() {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        log::set_logger(&TEST_LOGGER).unwrap();
        log::set_max_level(log::LevelFilter::Trace);
    });
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    assert!(matches!(hub.receive().await, Message::Hello { .. }));
    hub.send(Message::Welcome {
        protocol: 1,
        unified: true,
        heartbeat_interval_ms: 5000,
    })
    .await;
    assert!(matches!(hub.receive().await, Message::Register { .. }));
    hub.send(Message::Reject {
        code: RejectCode::InvalidMessage,
        hub_protocol: None,
    })
    .await;
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create"]);
    assert!(
        LOGS.lock()
            .unwrap()
            .iter()
            .any(|message| message.contains("invalid_message"))
    );
    tokio::time::advance(Duration::from_secs(1)).await;
    settle().await;
    assert_eq!(*connector.attempts.lock().unwrap(), 2);
    handle.shutdown();
}

#[cfg(windows)]
fn unique_pipe() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        r"\\.\pipe\nexo-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(windows)]
#[tokio::test]
async fn windows_scripted_pipe_handshake_menu_action_and_shutdown() {
    use tokio::net::windows::named_pipe::ServerOptions;
    let endpoint = unique_pipe();
    let server = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&endpoint)
        .unwrap();
    let host = Arc::new(FakeHost::default());
    let handle = client::start(
        Config {
            app: app(),
            menu: Some(vec![item("capture")]),
        },
        host.clone(),
        crate::windows::test_connector(endpoint),
    );
    tokio::time::timeout(Duration::from_secs(5), server.connect())
        .await
        .expect("client should open the test pipe")
        .unwrap();
    let mut hub = Hub::new(server);
    hub.handshake(true, &[item("capture")]).await;
    handle.replace_menu(vec![item("next")]).unwrap();
    assert_eq!(
        hub.receive().await,
        Message::Menu {
            items: vec![item("next")]
        }
    );
    hub.send(Message::Action {
        item_id: "next".into(),
    })
    .await;
    hub.send(Message::Unified { value: false }).await;
    host.wait_events(2).await;
    assert_eq!(host.events(), ["action:next", "create"]);
    handle.shutdown();
    assert_eq!(hub.receive().await, Message::Bye);
}

#[cfg(windows)]
#[tokio::test]
async fn windows_scripted_pipe_disconnect_reconnect_and_heartbeat() {
    use tokio::net::windows::named_pipe::ServerOptions;
    let endpoint = unique_pipe();
    let first = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&endpoint)
        .unwrap();
    let second = ServerOptions::new().create(&endpoint).unwrap();
    let host = Arc::new(FakeHost::default());
    let handle = client::start(
        Config {
            app: app(),
            menu: Some(vec![item("capture")]),
        },
        host.clone(),
        crate::windows::test_connector(endpoint),
    );
    tokio::time::timeout(Duration::from_secs(5), first.connect())
        .await
        .unwrap()
        .unwrap();
    let mut hub = Hub::new(first);
    hub.handshake(true, &[item("capture")]).await;
    drop(hub);
    host.wait_events(1).await;
    assert_eq!(host.events(), ["create"]);
    tokio::time::timeout(Duration::from_secs(5), second.connect())
        .await
        .unwrap()
        .unwrap();
    let mut next = Hub::new(second);
    next.handshake_with_interval(false, &[item("capture")], 1000)
        .await;
    next.send(Message::Unified { value: true }).await;
    host.wait_events(2).await;
    assert_eq!(host.events(), ["create", "visible:false"]);
    assert_eq!(next.receive().await, Message::Heartbeat { seq: 1 });
    next.send(Message::HeartbeatAck { seq: 1 }).await;
    handle.shutdown();
    assert_eq!(next.receive().await, Message::Bye);
}

#[cfg(windows)]
#[tokio::test]
async fn windows_scripted_pipe_protocol_errors_restore_access() {
    use tokio::net::windows::named_pipe::ServerOptions;
    let bad_frames = vec![
        b"not-json\n".to_vec(),
        b"{\"v\":2,\"type\":\"unified\",\"value\":false}\n".to_vec(),
        format!("{}\n", "x".repeat(MAX_LINE_BYTES + 1)).into_bytes(),
    ];
    for bad in bad_frames {
        let endpoint = unique_pipe();
        let server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&endpoint)
            .unwrap();
        let host = Arc::new(FakeHost::default());
        let handle = client::start(
            Config {
                app: app(),
                menu: Some(vec![item("capture")]),
            },
            host.clone(),
            crate::windows::test_connector(endpoint),
        );
        tokio::time::timeout(Duration::from_secs(5), server.connect())
            .await
            .unwrap()
            .unwrap();
        let mut hub = Hub::new(server);
        hub.handshake(true, &[item("capture")]).await;
        let _ = hub.writer.write_all(&bad).await;
        host.wait_events(1).await;
        assert_eq!(host.events(), ["create"]);
        handle.shutdown();
    }
}

#[cfg(windows)]
#[tokio::test]
async fn windows_scripted_pipe_permanent_rejection_does_not_reconnect() {
    use tokio::net::windows::named_pipe::ServerOptions;
    for code in [RejectCode::UnsupportedProtocol, RejectCode::DuplicateApp] {
        let endpoint = unique_pipe();
        let first = ServerOptions::new()
            .first_pipe_instance(true)
            .create(&endpoint)
            .unwrap();
        let second = ServerOptions::new().create(&endpoint).unwrap();
        let host = Arc::new(FakeHost::default());
        let handle = client::start(
            Config {
                app: app(),
                menu: Some(vec![item("capture")]),
            },
            host.clone(),
            crate::windows::test_connector(endpoint),
        );
        tokio::time::timeout(Duration::from_secs(5), first.connect())
            .await
            .unwrap()
            .unwrap();
        let mut hub = Hub::new(first);
        assert!(matches!(hub.receive().await, Message::Hello { .. }));
        hub.send(Message::Reject {
            code,
            hub_protocol: None,
        })
        .await;
        host.wait_events(1).await;
        assert_eq!(host.events(), ["create"]);
        assert!(
            tokio::time::timeout(Duration::from_millis(1250), second.connect())
                .await
                .is_err()
        );
        handle.shutdown();
    }
}

#[tokio::test(start_paused = true)]
async fn verifier_recheck_initial_hidden_and_stale_zero_icon() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut stalled = connector.add();
    let handle = start(&host, &connector);
    assert!(matches!(stalled.receive().await, Message::Hello { .. }));
    handle.set_visible(false);
    tokio::time::advance(Duration::from_secs(1)).await;
    settle().await;
    host.pump();
    assert!(host.events().is_empty());
    // Queue a standalone creation but let a new unified session fence it first.
    handle.set_visible(true);
    let mut new_hub = connector.add();
    tokio::time::advance(Duration::from_secs(1)).await;
    new_hub.handshake(true, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert!(host.events().is_empty());
    handle.shutdown();
}

#[tokio::test(start_paused = true)]
async fn verifier_recheck_stale_show_retry_fenced_by_unified_return() {
    let host = Arc::new(FakeHost::default());
    let connector = Arc::new(ScriptedConnector::default());
    let mut hub = connector.add();
    let handle = start(&host, &connector);
    hub.handshake(false, &[item("capture")]).await;
    settle().await;
    host.pump();
    hub.send(Message::Unified { value: true }).await;
    settle().await;
    host.pump();
    host.fail_show.store(true, Ordering::SeqCst);
    drop(hub);
    settle().await;
    host.pump();
    assert_eq!(host.events(), ["create", "visible:false", "show-error"]);
    handle.set_visible(true);
    let mut replacement = connector.add();
    tokio::time::advance(Duration::from_secs(1)).await;
    replacement.handshake(true, &[item("capture")]).await;
    settle().await;
    host.pump();
    assert!(!host.events().iter().any(|event| event == "visible:true"));
    assert_eq!(
        host.events()
            .iter()
            .filter(|event| *event == "create")
            .count(),
        1
    );
    handle.shutdown();
}
