use std::time::Duration;

use nexo_protocol::{
    AppInfo, Capability, DEFAULT_HEARTBEAT_INTERVAL_MS, MAX_LINE_BYTES, MAX_MENU_ITEMS, MenuItem,
    Message, PROTOCOL_VERSION, RejectCode, VersionRange, decode, encode,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream, ReadHalf, WriteHalf};

use super::{Hub, QuitOutcome};

struct Client {
    reader: BufReader<ReadHalf<DuplexStream>>,
    writer: WriteHalf<DuplexStream>,
}

impl Client {
    fn connect(hub: &Hub) -> Self {
        Self::with_capacity(hub, 128 * 1024)
    }

    fn with_capacity(hub: &Hub, capacity: usize) -> Self {
        let (client, server) = tokio::io::duplex(capacity);
        let hub = hub.clone();
        tokio::spawn(async move { hub.serve(server).await });
        let (reader, writer) = tokio::io::split(client);
        Self {
            reader: BufReader::new(reader),
            writer,
        }
    }

    async fn send(&mut self, message: Message) {
        self.writer
            .write_all(encode(PROTOCOL_VERSION, &message).unwrap().as_bytes())
            .await
            .unwrap();
    }

    async fn hello(&mut self) {
        self.send(Message::Hello {
            protocol: VersionRange { min: 1, max: 1 },
        })
        .await;
        assert_eq!(
            self.receive().await,
            Message::Welcome {
                protocol: 1,
                unified: true,
                heartbeat_interval_ms: DEFAULT_HEARTBEAT_INTERVAL_MS,
            }
        );
    }

    async fn register(&mut self, id: &str) {
        self.send(registration(id, "1.2.3")).await;
        assert_eq!(self.receive().await, Message::Registered);
    }

    async fn raw(&mut self, bytes: &[u8]) {
        self.writer.write_all(bytes).await.unwrap();
    }

    async fn closed(&mut self) {
        let mut line = String::new();
        let count = tokio::time::timeout(Duration::from_secs(1), self.reader.read_line(&mut line))
            .await
            .expect("server should close")
            .unwrap();
        assert_eq!(count, 0, "unexpected data: {line}");
    }

    async fn receive(&mut self) -> Message {
        let mut line = String::new();
        let count = tokio::time::timeout(Duration::from_secs(1), self.reader.read_line(&mut line))
            .await
            .expect("server should reply")
            .expect("read reply");
        assert_ne!(count, 0, "server closed before sending the expected reply");
        decode(&line, PROTOCOL_VERSION).expect("valid protocol reply")
    }
}

fn registration(id: &str, version: &str) -> Message {
    Message::Register {
        app: AppInfo {
            id: id.into(),
            name: format!("App {id}"),
            version: version.into(),
        },
        capabilities: vec![
            Capability::Show,
            Capability::Quit,
            Capability::Menu,
            Capability::Other("future".into()),
        ],
    }
}

#[tokio::test]
async fn registered_waits_until_the_app_has_a_tray_menu() {
    let hub = Hub::new();
    hub.require_presentation();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.send(registration("alpha", "1.2.3")).await;
    settle().await;
    let snapshot = hub.snapshot();
    assert_eq!(snapshot.apps.len(), 1);
    let mut line = String::new();
    assert!(
        tokio::time::timeout(
            Duration::from_millis(10),
            client.reader.read_line(&mut line)
        )
        .await
        .is_err(),
        "registered before tray presentation"
    );
    hub.mark_presented(snapshot.revision);
    assert_eq!(client.receive().await, Message::Registered);
    client.send(Message::Heartbeat { seq: 7 }).await;
    assert_eq!(client.receive().await, Message::HeartbeatAck { seq: 7 });
}

#[tokio::test]
async fn disconnect_while_waiting_for_tray_presentation_cleans_up() {
    let hub = Hub::new();
    hub.require_presentation();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.send(registration("alpha", "1.2.3")).await;
    settle().await;
    assert_eq!(hub.snapshot().apps.len(), 1);
    drop(client);
    settle().await;
    assert!(hub.snapshot().apps.is_empty());
}

#[tokio::test]
async fn registers_identity_and_capabilities() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    let snapshot = hub.snapshot();
    assert_eq!(snapshot.apps.len(), 1);
    let entry = &snapshot.apps[0];
    assert_eq!(
        entry.app,
        AppInfo {
            id: "alpha".into(),
            name: "App alpha".into(),
            version: "1.2.3".into()
        }
    );
    assert_eq!(
        entry.capabilities,
        vec![
            Capability::Show,
            Capability::Quit,
            Capability::Menu,
            Capability::Other("future".into())
        ]
    );
    assert!(entry.unified && entry.responsive);
    assert!(entry.menu.is_empty());
}

#[tokio::test]
async fn duplicate_id_is_rejected_without_removing_original() {
    let hub = Hub::new();
    let mut first = Client::connect(&hub);
    first.hello().await;
    first.register("alpha").await;
    let before = hub.snapshot();
    let mut duplicate = Client::connect(&hub);
    duplicate.hello().await;
    duplicate.send(registration("alpha", "9.0.0")).await;
    assert_eq!(
        duplicate.receive().await,
        Message::Reject {
            code: RejectCode::DuplicateApp,
            hub_protocol: None
        }
    );
    let mut rest = String::new();
    assert_eq!(duplicate.reader.read_line(&mut rest).await.unwrap(), 0);
    assert_eq!(hub.snapshot(), before);
    first.send(Message::Heartbeat { seq: 42 }).await;
    assert_eq!(first.receive().await, Message::HeartbeatAck { seq: 42 });
}

#[tokio::test]
async fn invalid_identity_or_semver_is_rejected_without_registration() {
    let hub = Hub::new();
    for (id, version) in [("", "1.2.3"), ("Bad ID", "1.2.3"), ("valid", "v1.2.3")] {
        let mut client = Client::connect(&hub);
        client.hello().await;
        client.send(registration(id, version)).await;
        assert_eq!(
            client.receive().await,
            Message::Reject {
                code: RejectCode::InvalidMessage,
                hub_protocol: None
            }
        );
        let mut rest = String::new();
        assert_eq!(client.reader.read_line(&mut rest).await.unwrap(), 0);
        assert!(hub.snapshot().apps.is_empty());
    }
}

fn item(id: &str, enabled: bool, checked: Option<bool>) -> MenuItem {
    MenuItem {
        id: id.into(),
        label: format!("Label {id}"),
        enabled,
        checked,
    }
}

async fn settle() {
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn menu_replaces_previous_items_and_enforces_limit() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    let first = vec![
        item("capture", true, None),
        item("pause", false, Some(true)),
    ];
    client
        .send(Message::Menu {
            items: first.clone(),
        })
        .await;
    client.send(Message::Heartbeat { seq: 1 }).await;
    assert_eq!(client.receive().await, Message::HeartbeatAck { seq: 1 });
    assert_eq!(hub.snapshot().apps[0].menu, first);
    let replacement: Vec<_> = (0..MAX_MENU_ITEMS)
        .map(|n| item(&format!("{n}"), true, Some(false)))
        .collect();
    client
        .send(Message::Menu {
            items: replacement.clone(),
        })
        .await;
    client.send(Message::Heartbeat { seq: 2 }).await;
    assert_eq!(client.receive().await, Message::HeartbeatAck { seq: 2 });
    assert_eq!(hub.snapshot().apps[0].menu, replacement);
    client
        .send(Message::Menu {
            items: vec![item("extra", true, None); MAX_MENU_ITEMS + 1],
        })
        .await;
    client.closed().await;
    assert!(hub.snapshot().apps.is_empty());
}

#[tokio::test(start_paused = true)]
async fn heartbeat_marks_unresponsive_at_three_intervals_and_recovers() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    tokio::time::advance(Duration::from_millis(14_999)).await;
    settle().await;
    assert!(hub.snapshot().apps[0].responsive);
    tokio::time::advance(Duration::from_millis(1)).await;
    settle().await;
    let entry = hub.snapshot().apps[0].clone();
    assert!(!entry.responsive);
    assert!(!hub.show_responsive("alpha", entry.generation));
    assert_eq!(
        hub.quit_responsive("alpha", entry.generation).await,
        QuitOutcome::Unavailable
    );
    assert!(hub.while_disconnected("alpha", || Ok(())).is_err());
    client.send(Message::Heartbeat { seq: 42 }).await;
    assert_eq!(client.receive().await, Message::HeartbeatAck { seq: 42 });
    assert!(hub.snapshot().apps[0].responsive);
}

#[tokio::test(start_paused = true)]
async fn liveness_deadline_tracks_the_most_recent_heartbeat() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    tokio::time::advance(Duration::from_secs(14)).await;
    client.send(Message::Heartbeat { seq: 8 }).await;
    assert_eq!(client.receive().await, Message::HeartbeatAck { seq: 8 });
    tokio::time::advance(Duration::from_millis(14_999)).await;
    settle().await;
    assert!(hub.snapshot().apps[0].responsive);
    tokio::time::advance(Duration::from_millis(1)).await;
    settle().await;
    assert!(!hub.snapshot().apps[0].responsive);
}

#[tokio::test]
async fn bye_and_unexpected_eof_remove_only_the_owner_and_allow_reconnect() {
    let hub = Hub::new();
    let mut first = Client::connect(&hub);
    first.hello().await;
    first.register("alpha").await;
    let mut second = Client::connect(&hub);
    second.hello().await;
    second.register("beta").await;
    first.send(Message::Bye).await;
    first.closed().await;
    assert_eq!(
        hub.snapshot()
            .apps
            .iter()
            .map(|app| app.app.id.as_str())
            .collect::<Vec<_>>(),
        ["beta"]
    );
    let mut reconnected = Client::connect(&hub);
    reconnected.hello().await;
    reconnected.register("alpha").await;
    drop(second);
    settle().await;
    assert_eq!(
        hub.snapshot()
            .apps
            .iter()
            .map(|app| app.app.id.as_str())
            .collect::<Vec<_>>(),
        ["alpha"]
    );
    reconnected.send(Message::Heartbeat { seq: 9 }).await;
    assert_eq!(
        reconnected.receive().await,
        Message::HeartbeatAck { seq: 9 }
    );
}

#[tokio::test]
async fn malformed_registration_is_rejected() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client
        .raw(b"{\"v\":1,\"type\":\"register\",\"app\":{}}\n")
        .await;
    assert_eq!(
        client.receive().await,
        Message::Reject {
            code: RejectCode::InvalidMessage,
            hub_protocol: None
        }
    );
    client.closed().await;
    assert!(hub.snapshot().apps.is_empty());
}

#[tokio::test]
async fn frames_accept_fragmented_maximum_crlf_and_reject_oversize() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    let prefix = "{\"v\":1,\"type\":\"hello\",\"protocol\":{\"min\":1,\"max\":1},\"future\":\"";
    let suffix = "\"}";
    let frame = format!(
        "{prefix}{}{suffix}\r\n",
        "x".repeat(MAX_LINE_BYTES - prefix.len() - suffix.len())
    );
    client.raw(&frame.as_bytes()[..123]).await;
    client.raw(&frame.as_bytes()[123..]).await;
    assert_eq!(
        client.receive().await,
        Message::Welcome {
            protocol: 1,
            unified: true,
            heartbeat_interval_ms: 5_000
        }
    );
    client.register("alpha").await;
    client.raw(&vec![b'x'; MAX_LINE_BYTES + 1]).await;
    client.closed().await;
    assert!(hub.snapshot().apps.is_empty());
}

#[tokio::test]
async fn malformed_utf8_wrong_version_and_order_close_the_session() {
    for bad in [
        b"\xff\n".to_vec(),
        b"{\"v\":2,\"type\":\"heartbeat\",\"seq\":1}\n".to_vec(),
        encode(1, &Message::Registered).unwrap().into_bytes(),
    ] {
        let hub = Hub::new();
        let mut client = Client::connect(&hub);
        client.hello().await;
        client.register("alpha").await;
        client.raw(&bad).await;
        client.closed().await;
        assert!(hub.snapshot().apps.is_empty());
    }
}

#[tokio::test]
async fn routes_only_current_enabled_actions_to_the_owning_app() {
    let hub = Hub::new();
    let mut alpha = Client::connect(&hub);
    alpha.hello().await;
    alpha.register("alpha").await;
    let mut beta = Client::connect(&hub);
    beta.hello().await;
    beta.register("beta").await;
    for client in [&mut alpha, &mut beta] {
        client
            .send(Message::Menu {
                items: vec![item("same", true, None), item("disabled", false, None)],
            })
            .await;
        client.send(Message::Heartbeat { seq: 1 }).await;
        assert_eq!(client.receive().await, Message::HeartbeatAck { seq: 1 });
    }
    let snapshot = hub.snapshot();
    let a = &snapshot.apps[0];
    let b = &snapshot.apps[1];
    assert!(!hub.action("alpha", a.generation, a.menu_revision, "disabled"));
    assert!(!hub.action("alpha", a.generation, a.menu_revision, "missing"));
    assert!(hub.action("alpha", a.generation, a.menu_revision, "same"));
    assert_eq!(
        alpha.receive().await,
        Message::Action {
            item_id: "same".into()
        }
    );
    assert!(hub.show("beta", b.generation));
    assert_eq!(beta.receive().await, Message::Show);
    assert!(hub.show_responsive("beta", b.generation));
    assert_eq!(beta.receive().await, Message::Show);
    alpha
        .send(Message::Menu {
            items: vec![item("new", true, Some(true))],
        })
        .await;
    alpha.send(Message::Heartbeat { seq: 2 }).await;
    assert_eq!(alpha.receive().await, Message::HeartbeatAck { seq: 2 });
    assert!(!hub.action("alpha", a.generation, a.menu_revision, "same"));
    assert!(!hub.action("alpha", a.generation, a.menu_revision, "new"));
    alpha.send(Message::Bye).await;
    alpha.closed().await;
    assert!(!hub.show("alpha", a.generation));
}

#[tokio::test]
async fn unify_preference_is_retained_with_override_after_reconnect() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    let generation = hub.snapshot().apps[0].generation;
    assert!(hub.set_unified("alpha", generation, false));
    assert_eq!(client.receive().await, Message::Unified { value: false });
    assert!(!hub.snapshot().apps[0].unified);
    client.send(Message::Bye).await;
    client.closed().await;
    let mut reconnected = Client::connect(&hub);
    reconnected.hello().await;
    reconnected.register("alpha").await;
    assert_eq!(
        reconnected.receive().await,
        Message::Unified { value: false }
    );
    let next = hub.snapshot().apps[0].clone();
    assert_ne!(next.generation, generation);
    assert!(!next.unified);
    assert!(!hub.set_unified("alpha", generation, true));
}

#[tokio::test(start_paused = true)]
async fn quit_correlates_accept_refusal_timeout_and_missing_capability() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    let generation = hub.snapshot().apps[0].generation;
    for (accepted, reason, expected) in [
        (
            false,
            Some("Unsaved".to_string()),
            QuitOutcome::Refused(Some("Unsaved".to_string())),
        ),
        (true, None, QuitOutcome::Accepted),
    ] {
        let worker = hub.clone();
        let task = tokio::spawn(async move { worker.quit("alpha", generation).await });
        let Message::Quit {
            id,
            reason: nexo_protocol::QuitReason::User,
        } = client.receive().await
        else {
            panic!("expected quit");
        };
        client
            .send(Message::QuitResult {
                id: id + 100,
                accepted: true,
                reason: None,
            })
            .await;
        client
            .send(Message::QuitResult {
                id,
                accepted,
                reason,
            })
            .await;
        assert_eq!(task.await.unwrap(), expected);
    }
    let worker = hub.clone();
    let task = tokio::spawn(async move { worker.quit("alpha", generation).await });
    assert!(matches!(client.receive().await, Message::Quit { .. }));
    tokio::time::advance(Duration::from_millis(9_999)).await;
    settle().await;
    assert!(!task.is_finished());
    tokio::time::advance(Duration::from_millis(1)).await;
    assert_eq!(task.await.unwrap(), QuitOutcome::Timeout);
    let mut incapable = Client::connect(&hub);
    incapable.hello().await;
    incapable
        .send(Message::Register {
            app: AppInfo {
                id: "beta".into(),
                name: "Beta".into(),
                version: "1.0.0".into(),
            },
            capabilities: vec![Capability::Show],
        })
        .await;
    assert_eq!(incapable.receive().await, Message::Registered);
    let beta = hub.snapshot().apps[1].generation;
    assert_eq!(hub.quit("beta", beta).await, QuitOutcome::Unavailable);
}

#[tokio::test(start_paused = true)]
async fn quit_ignores_a_reply_arriving_after_its_deadline_even_if_polling_is_delayed() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    let generation = hub.snapshot().apps[0].generation;
    let mut quit = Box::pin(hub.quit("alpha", generation));
    assert!(
        tokio::time::timeout(Duration::from_millis(1), &mut quit)
            .await
            .is_err()
    );
    let Message::Quit { id, .. } = client.receive().await else {
        panic!("expected quit");
    };
    tokio::time::advance(Duration::from_secs(10)).await;
    client
        .send(Message::QuitResult {
            id,
            accepted: true,
            reason: None,
        })
        .await;
    settle().await;
    assert_eq!(quit.await, QuitOutcome::Timeout);
}

#[tokio::test(start_paused = true)]
async fn quit_preserves_an_in_time_reply_even_if_polling_is_delayed() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    let generation = hub.snapshot().apps[0].generation;
    let mut quit = Box::pin(hub.quit("alpha", generation));
    assert!(
        tokio::time::timeout(Duration::from_millis(1), &mut quit)
            .await
            .is_err()
    );
    let Message::Quit { id, .. } = client.receive().await else {
        panic!("expected quit");
    };
    tokio::time::advance(Duration::from_secs(9)).await;
    client
        .send(Message::QuitResult {
            id,
            accepted: true,
            reason: None,
        })
        .await;
    settle().await;
    tokio::time::advance(Duration::from_secs(2)).await;
    assert_eq!(quit.await, QuitOutcome::Accepted);
}

#[tokio::test(start_paused = true)]
async fn hub_quit_requests_each_app_concurrently_and_reports_failures() {
    let hub = Hub::new();
    let mut alpha = Client::connect(&hub);
    alpha.hello().await;
    alpha.register("alpha").await;
    let mut beta = Client::connect(&hub);
    beta.hello().await;
    beta.register("beta").await;
    let mut gamma = Client::connect(&hub);
    gamma.hello().await;
    gamma
        .send(Message::Register {
            app: AppInfo {
                id: "gamma".into(),
                name: "Gamma".into(),
                version: "1.0.0".into(),
            },
            capabilities: vec![],
        })
        .await;
    assert_eq!(gamma.receive().await, Message::Registered);
    let worker = hub.clone();
    let quit = tokio::spawn(async move { worker.quit_all().await });
    let Message::Quit { id: first, .. } = alpha.receive().await else {
        panic!("expected alpha quit");
    };
    let Message::Quit { id: second, .. } = beta.receive().await else {
        panic!("expected beta quit");
    };
    alpha
        .send(Message::QuitResult {
            id: first,
            accepted: true,
            reason: None,
        })
        .await;
    beta.send(Message::QuitResult {
        id: second,
        accepted: false,
        reason: Some("Unsaved".into()),
    })
    .await;
    let results = quit.await.unwrap();
    assert_eq!(
        results
            .iter()
            .map(|(app, result)| (app.id.as_str(), result))
            .collect::<Vec<_>>(),
        [
            ("alpha", &QuitOutcome::Accepted),
            ("beta", &QuitOutcome::Refused(Some("Unsaved".into()))),
            ("gamma", &QuitOutcome::Unavailable),
        ]
    );
    assert_eq!(
        hub.snapshot().apps.len(),
        3,
        "refusal does not shut down the hub"
    );
    hub.shutdown();
    alpha.closed().await;
    beta.closed().await;
    gamma.closed().await;
}

#[tokio::test(start_paused = true)]
async fn hub_quit_timeout_keeps_the_hub_and_reopens_registration() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    let worker = hub.clone();
    let quit = tokio::spawn(async move { worker.quit_all().await });
    assert!(matches!(client.receive().await, Message::Quit { .. }));
    tokio::time::advance(Duration::from_secs(10)).await;
    let result = quit.await.unwrap();
    assert_eq!(result[0].1, QuitOutcome::Timeout);
    assert_eq!(hub.snapshot().apps.len(), 1);
    let mut next = Client::connect(&hub);
    next.hello().await;
    next.register("beta").await;
}

#[tokio::test]
async fn undeclared_capabilities_are_never_sent_and_unsolicited_menu_closes() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client
        .send(Message::Register {
            app: AppInfo {
                id: "alpha".into(),
                name: "Alpha".into(),
                version: "1.0.0".into(),
            },
            capabilities: vec![],
        })
        .await;
    assert_eq!(client.receive().await, Message::Registered);
    let entry = hub.snapshot().apps[0].clone();
    assert!(!hub.show("alpha", entry.generation));
    assert!(!hub.action("alpha", entry.generation, entry.menu_revision, "anything"));
    assert_eq!(
        hub.quit("alpha", entry.generation).await,
        QuitOutcome::Unavailable
    );
    client
        .send(Message::Menu {
            items: vec![item("anything", true, None)],
        })
        .await;
    client.closed().await;
    assert!(hub.snapshot().apps.is_empty());
}

#[tokio::test]
async fn hub_only_exit_requires_an_explicit_offer_and_closes_connections() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    assert!(!hub.hub_only_exit());
    let mut changes = hub.subscribe();
    hub.set_notice("Mensaje previo".into(), false);
    changes.changed().await.unwrap();
    hub.clear_notice();
    changes.changed().await.unwrap();
    assert!(hub.snapshot().notice.is_none());
    hub.set_notice("Alpha: cambios sin guardar".into(), true);
    let snapshot = hub.snapshot();
    let notice = snapshot.notice.unwrap();
    assert_eq!(notice.message, "Alpha: cambios sin guardar");
    assert!(notice.hub_only_allowed);
    assert_eq!(snapshot.apps.len(), 1);
    assert!(hub.hub_only_exit());
    client.closed().await;
    assert!(hub.snapshot().apps.is_empty());
}

#[tokio::test]
async fn hub_exit_fences_new_sessions_and_reopens_registration_after_refusal() {
    let hub = Hub::new();
    let mut first = Client::connect(&hub);
    first.hello().await;
    first.register("alpha").await;
    let worker = hub.clone();
    let quit = tokio::spawn(async move { worker.quit_all().await });
    let Message::Quit { id, .. } = first.receive().await else {
        panic!("expected quit");
    };
    let mut newcomer = Client::connect(&hub);
    newcomer.hello().await;
    newcomer.send(registration("beta", "1.0.0")).await;
    assert_eq!(
        newcomer.receive().await,
        Message::Reject {
            code: RejectCode::InvalidMessage,
            hub_protocol: None
        }
    );
    newcomer.closed().await;
    first
        .send(Message::QuitResult {
            id,
            accepted: false,
            reason: Some("Busy".into()),
        })
        .await;
    assert!(matches!(quit.await.unwrap()[0].1, QuitOutcome::Refused(_)));
    let mut retry = Client::connect(&hub);
    retry.hello().await;
    retry.register("beta").await;
}

#[tokio::test]
async fn outgoing_controls_apply_bounded_backpressure() {
    let hub = Hub::new();
    let mut client = Client::with_capacity(&hub, 128);
    client.hello().await;
    client.register("alpha").await;
    let generation = hub.snapshot().apps[0].generation;
    let accepted = (0..1_000).filter(|_| hub.show("alpha", generation)).count();
    assert!(
        accepted > 0 && accepted <= 64,
        "queue accepted {accepted} controls"
    );
}

#[tokio::test(start_paused = true)]
async fn queued_quit_never_arrives_after_its_timeout() {
    let hub = Hub::new();
    let mut client = Client::with_capacity(&hub, 128);
    client.hello().await;
    client.register("alpha").await;
    let generation = hub.snapshot().apps[0].generation;
    assert!(hub.show("alpha", generation));
    settle().await;
    for _ in 0..5 {
        assert!(hub.show("alpha", generation));
    }
    settle().await;
    let worker = hub.clone();
    let quit = tokio::spawn(async move { worker.quit("alpha", generation).await });
    settle().await;
    tokio::time::advance(Duration::from_secs(10)).await;
    assert_eq!(quit.await.unwrap(), QuitOutcome::Timeout);
    for _ in 0..7 {
        let mut line = String::new();
        let result =
            tokio::time::timeout(Duration::from_millis(1), client.reader.read_line(&mut line))
                .await;
        match result {
            Err(_) | Ok(Ok(0)) => break,
            Ok(Ok(_)) => assert!(!line.contains("\"type\":\"quit\""), "late frame: {line}"),
            Ok(Err(error)) => panic!("read failed: {error}"),
        }
    }
}

#[tokio::test]
async fn blocked_writer_does_not_deliver_an_action_after_menu_replacement() {
    let hub = Hub::new();
    let mut client = Client::with_capacity(&hub, 128);
    client.hello().await;
    client.register("alpha").await;
    let blocking_id = "x".repeat(300);
    client
        .send(Message::Menu {
            items: vec![item(&blocking_id, true, None), item("old", true, None)],
        })
        .await;
    client.send(Message::Heartbeat { seq: 1 }).await;
    assert_eq!(client.receive().await, Message::HeartbeatAck { seq: 1 });
    let before = hub.snapshot().apps[0].clone();
    assert!(hub.action(
        "alpha",
        before.generation,
        before.menu_revision,
        &blocking_id
    ));
    settle().await;
    assert!(hub.action("alpha", before.generation, before.menu_revision, "old"));
    client
        .send(Message::Menu {
            items: vec![item("new", true, None)],
        })
        .await;
    settle().await;
    let snapshot = hub.snapshot();
    if let Some(app) = snapshot.apps.first() {
        assert_eq!(
            app.menu[0].id, "new",
            "blocked writer stalled inbound frames"
        );
    }
    let mut first = String::new();
    let result =
        tokio::time::timeout(Duration::from_secs(1), client.reader.read_line(&mut first)).await;
    assert!(result.is_ok());
    assert!(
        !first.contains("\"item_id\":\"old\""),
        "stale frame: {first}"
    );
    let mut remaining = String::new();
    let result = tokio::time::timeout(
        Duration::from_millis(20),
        client.reader.read_line(&mut remaining),
    )
    .await;
    assert!(
        result.is_err() || result.unwrap().unwrap() == 0,
        "stale frame: {remaining}"
    );
}

#[tokio::test]
async fn shutdown_closes_existing_and_new_sessions() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client.hello().await;
    client.register("alpha").await;
    hub.shutdown();
    assert!(
        hub.snapshot().apps.is_empty(),
        "shutdown must immediately invalidate the live snapshot"
    );
    client.closed().await;
    assert!(hub.snapshot().apps.is_empty());
    let mut new = Client::connect(&hub);
    new.closed().await;
}

#[tokio::test]
async fn hello_negotiates_v1_before_registration() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client
        .send(Message::Hello {
            protocol: VersionRange { min: 1, max: 2 },
        })
        .await;
    assert_eq!(
        client.receive().await,
        Message::Welcome {
            protocol: 1,
            unified: true,
            heartbeat_interval_ms: DEFAULT_HEARTBEAT_INTERVAL_MS,
        }
    );
}

#[tokio::test]
async fn unsupported_range_is_rejected_and_closed() {
    let hub = Hub::new();
    let mut client = Client::connect(&hub);
    client
        .send(Message::Hello {
            protocol: VersionRange { min: 2, max: 3 },
        })
        .await;
    assert_eq!(
        client.receive().await,
        Message::Reject {
            code: RejectCode::UnsupportedProtocol,
            hub_protocol: Some(VersionRange { min: 1, max: 1 }),
        }
    );
    let mut rest = String::new();
    assert_eq!(client.reader.read_line(&mut rest).await.unwrap(), 0);
}
