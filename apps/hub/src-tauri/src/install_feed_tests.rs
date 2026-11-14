use super::*;
use crate::install_download::{Body, NetworkError, Response, ResponseKind};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{collections::VecDeque, sync::Mutex};

const URL: &str = "https://github.com/egdev6/example/releases/download/v1/setup.exe";
const OTHER_URL: &str = "https://github.com/egdev6/example/releases/download/v2/setup.exe";
const KEY: &str = include_str!("../tests/fixtures/tauri-test.pub");
const OTHER_KEY: &str = include_str!("../tests/fixtures/minisign-test.pub");

fn catalog_value() -> Value {
    let mut value: Value = serde_json::from_str(include_str!(
        "../../../../crates/nexo-catalog/fixtures/minimal.json"
    ))
    .unwrap();
    value["schemaVersion"] = json!(3);
    value["apps"][0]["installerUrl"] = json!(URL);
    value["apps"][0]["latestJsonUrl"] =
        json!("https://github.com/egdev6/example/releases/download/v1/latest.json");
    value["apps"][0]["updaterPublicKey"] = json!(STANDARD.encode(KEY));
    value["apps"][0]["version"] = json!("1.0.0");
    value["apps"][0]["detection"] = json!({"windows": {
        "displayName": "Minimal", "publisher": "Example", "executableRelativePath": "Minimal.exe"
    }});
    value
}

fn fresh(value: &Value) -> FreshCatalog {
    FreshCatalog {
        catalog: nexo_catalog::parse_catalog(&value.to_string()).unwrap(),
    }
}

enum Reply {
    Ok {
        length: Option<u64>,
        chunks: Vec<Vec<u8>>,
    },
    Redirect,
    WrongUrl,
    Failed,
    Network,
    PendingConnection,
    PendingBody,
}

fn body(bytes: &[u8]) -> Reply {
    Reply::Ok {
        length: Some(bytes.len() as u64),
        chunks: vec![bytes.to_vec()],
    }
}

struct FakeBody {
    chunks: VecDeque<Vec<u8>>,
    pending: bool,
}

impl Body for FakeBody {
    async fn next(&mut self) -> Result<Option<Vec<u8>>, NetworkError> {
        if self.pending {
            return std::future::pending().await;
        }
        Ok(self.chunks.pop_front())
    }
}

struct FakeNetwork {
    replies: Mutex<VecDeque<Reply>>,
    requests: Mutex<Vec<String>>,
}

impl FakeNetwork {
    fn new(replies: Vec<Reply>) -> Self {
        Self {
            replies: Mutex::new(replies.into()),
            requests: Mutex::new(vec![]),
        }
    }
    fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}

impl Network for FakeNetwork {
    type Body = FakeBody;
    async fn get(&self, url: &str) -> Result<Response<Self::Body>, NetworkError> {
        self.requests.lock().unwrap().push(url.into());
        let reply = self
            .replies
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected request");
        let mut effective_url = url.to_owned();
        let kind = match reply {
            Reply::Ok { length, chunks } => ResponseKind::Ok {
                length,
                body: FakeBody {
                    chunks: chunks.into(),
                    pending: false,
                },
            },
            Reply::Redirect => ResponseKind::Redirect("https://evil.example/catalog.json".into()),
            Reply::WrongUrl => {
                effective_url = "https://evil.example/catalog.json".into();
                ResponseKind::Failed
            }
            Reply::Failed => ResponseKind::Failed,
            Reply::Network => return Err(NetworkError),
            Reply::PendingConnection => return std::future::pending().await,
            Reply::PendingBody => ResponseKind::Ok {
                length: None,
                body: FakeBody {
                    chunks: VecDeque::new(),
                    pending: true,
                },
            },
        };
        Ok(Response {
            effective_url,
            kind,
        })
    }
}

#[tokio::test]
async fn fetches_and_validates_only_the_fixed_native_v3_source() {
    let text = catalog_value().to_string();
    let feed = NativeFeed::new(FakeNetwork::new(vec![body(text.as_bytes())]));
    let catalog = feed.fetch().await.unwrap();
    let selected = catalog.select("minimal").unwrap();
    assert_eq!(selected.app().installer_url, URL);
    assert_eq!(
        selected.app().updater_public_key.as_deref(),
        Some(STANDARD.encode(KEY).as_str())
    );
    assert_eq!(feed.network.requests(), [OFFICIAL_V3_FEED]);
}

#[tokio::test]
async fn each_fetch_is_fresh_and_failure_never_falls_back_to_previous_data() {
    let text = catalog_value().to_string();
    let feed = NativeFeed::new(FakeNetwork::new(vec![
        body(text.as_bytes()),
        Reply::Network,
    ]));
    assert_eq!(
        feed.fetch()
            .await
            .unwrap()
            .select("minimal")
            .unwrap()
            .app()
            .id,
        "minimal"
    );
    assert_eq!(feed.fetch().await.unwrap_err(), FeedError::Network);
    assert_eq!(
        feed.network.requests(),
        [OFFICIAL_V3_FEED, OFFICIAL_V3_FEED]
    );
}

#[tokio::test]
async fn rejects_redirects_changed_effective_urls_and_failed_responses() {
    for reply in [Reply::Redirect, Reply::WrongUrl, Reply::Failed] {
        let feed = NativeFeed::new(FakeNetwork::new(vec![reply]));
        assert_eq!(feed.fetch().await.unwrap_err(), FeedError::InvalidResponse);
        assert_eq!(feed.network.requests(), [OFFICIAL_V3_FEED]);
    }
}

#[tokio::test]
async fn rejects_old_malformed_or_policy_invalid_catalogs() {
    let valid = catalog_value();
    let mut documents = vec![b"{".to_vec(), vec![0xff]];
    for version in [1, 2] {
        let mut old = valid.clone();
        old["schemaVersion"] = json!(version);
        old["apps"][0]
            .as_object_mut()
            .unwrap()
            .remove("updaterPublicKey");
        if version == 1 {
            old["apps"][0].as_object_mut().unwrap().remove("detection");
        }
        documents.push(old.to_string().into_bytes());
    }
    let mut invalid_url = valid.clone();
    invalid_url["apps"][0]["installerUrl"] =
        json!("https://github.com.evil/egdev6/example/releases/download/v1/a.exe");
    documents.push(invalid_url.to_string().into_bytes());
    let mut invalid_key = valid;
    invalid_key["apps"][0]["updaterPublicKey"] = json!("not-a-key");
    documents.push(invalid_key.to_string().into_bytes());
    for document in documents {
        let feed = NativeFeed::new(FakeNetwork::new(vec![body(&document)]));
        assert_eq!(feed.fetch().await.unwrap_err(), FeedError::InvalidCatalog);
        assert_eq!(feed.network.requests(), [OFFICIAL_V3_FEED]);
    }
}

#[tokio::test]
async fn bounds_feed_bytes_and_rejects_length_mismatches_without_fallback() {
    for (reply, expected) in [
        (
            Reply::Ok {
                length: Some(FEED_LIMIT + 1),
                chunks: vec![],
            },
            FeedError::TooLarge,
        ),
        (
            Reply::Ok {
                length: None,
                chunks: vec![vec![b'x'; FEED_LIMIT as usize], vec![b'x']],
            },
            FeedError::TooLarge,
        ),
        (
            Reply::Ok {
                length: Some(2),
                chunks: vec![b"x".to_vec()],
            },
            FeedError::LengthMismatch,
        ),
        (
            Reply::Ok {
                length: Some(1),
                chunks: vec![b"xx".to_vec()],
            },
            FeedError::LengthMismatch,
        ),
    ] {
        let feed = NativeFeed::new(FakeNetwork::new(vec![reply]));
        assert_eq!(feed.fetch().await.unwrap_err(), expected);
        assert_eq!(feed.network.requests(), [OFFICIAL_V3_FEED]);
    }
}

#[tokio::test(start_paused = true)]
async fn bounds_both_connection_and_stream_time() {
    for reply in [Reply::PendingConnection, Reply::PendingBody] {
        let feed = NativeFeed::new(FakeNetwork::new(vec![reply]));
        assert_eq!(feed.fetch().await.unwrap_err(), FeedError::Timeout);
        assert_eq!(feed.network.requests(), [OFFICIAL_V3_FEED]);
    }
}

#[test]
fn selecting_requires_an_official_id_and_a_public_key() {
    let mut value = catalog_value();
    let catalog = fresh(&value);
    assert_eq!(catalog.select("unknown"), Err(SelectionError::NotOfficial));
    assert_eq!(catalog.select("minimal").unwrap().app().id, "minimal");
    value["apps"][0]
        .as_object_mut()
        .unwrap()
        .remove("updaterPublicKey");
    assert_eq!(
        fresh(&value).select("minimal"),
        Err(SelectionError::MissingKey)
    );
}

#[test]
fn revalidation_rejects_removal_or_change_of_release_key_and_detection_identity() {
    let original = catalog_value();
    let selection = fresh(&original).select("minimal").unwrap();
    assert_eq!(selection.revalidate(&fresh(&original)).unwrap(), selection);
    let mut cases = vec![];
    let mut removed = original.clone();
    removed["apps"] = json!([]);
    cases.push(removed);
    let mut missing_key = original.clone();
    missing_key["apps"][0]
        .as_object_mut()
        .unwrap()
        .remove("updaterPublicKey");
    cases.push(missing_key);
    for (field, new_value) in [
        ("id", json!("other")),
        ("installerUrl", json!(OTHER_URL)),
        ("updaterPublicKey", json!(STANDARD.encode(OTHER_KEY))),
        ("version", json!("2.0.0")),
        (
            "detection",
            json!({"windows": {"displayName": "Other", "publisher": "Example", "executableRelativePath": "Minimal.exe"}}),
        ),
    ] {
        let mut changed = original.clone();
        changed["apps"][0][field] = new_value;
        cases.push(changed);
    }
    for changed in cases {
        assert_eq!(
            selection.revalidate(&fresh(&changed)),
            Err(SelectionError::Changed)
        );
    }
    let mut editorial_change = original;
    editorial_change["apps"][0]["tagline"] = json!("New tagline");
    assert!(selection.revalidate(&fresh(&editorial_change)).is_ok());
}
