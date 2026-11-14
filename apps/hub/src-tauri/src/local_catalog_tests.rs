use super::*;
use serde_json::{Value, json};
use std::cell::RefCell;
use std::collections::HashMap;
use std::io;

const FULL: &str = include_str!("../../../../crates/nexo-catalog/fixtures/full.json");

fn launch_document(version: u64) -> Value {
    let mut document: Value = serde_json::from_str(FULL).unwrap();
    document["schemaVersion"] = json!(version);
    document["apps"][0]["integrationLevel"] = json!("launch");
    document
}

#[derive(Default)]
struct FakeReader {
    files: RefCell<HashMap<String, String>>,
    reads: RefCell<Vec<String>>,
}
impl LocalCatalogReader for FakeReader {
    fn open(&self, location: &str) -> io::Result<impl io::Read> {
        self.reads.borrow_mut().push(location.into());
        self.files
            .borrow()
            .get(location)
            .map(|text| io::Cursor::new(text.as_bytes().to_vec()))
            .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
    }
}

#[test]
fn oversized_stream_is_stopped_after_the_limit_plus_one_byte() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    struct StreamingReader(Arc<AtomicUsize>);
    struct Stream(Arc<AtomicUsize>);
    impl io::Read for Stream {
        fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
            output.fill(b' ');
            self.0.fetch_add(output.len(), Ordering::Relaxed);
            Ok(output.len())
        }
    }
    impl LocalCatalogReader for StreamingReader {
        fn open(&self, _: &str) -> io::Result<impl io::Read> {
            Ok(Stream(Arc::clone(&self.0)))
        }
    }
    let count = Arc::new(AtomicUsize::new(0));
    assert_eq!(
        read_local_catalog(&StreamingReader(Arc::clone(&count)), "work", "selected"),
        Err(LocalCatalogError::Invalid)
    );
    assert_eq!(count.load(Ordering::Relaxed), MAX_LOCAL_CATALOG_BYTES + 1);
}

#[test]
fn parses_v1_v2_and_empty_catalogs_as_source_scoped_local_entries() {
    for version in [1, 2] {
        let text = launch_document(version).to_string();
        let snapshot = parse_local_catalog("work", &text).unwrap();
        assert_eq!(snapshot.source_id, "work");
        assert_eq!(snapshot.entries.len(), 1);
        let entry = &snapshot.entries[0];
        assert_eq!(entry.key.source_id, "work");
        assert_eq!(entry.key.app_id, "example-app");
        assert_eq!(entry.source, "local");
        assert_eq!(entry.name, "Example App");
        assert_eq!(entry.tagline, "An example for testing");
        assert_eq!(entry.description, "A fictional catalog entry.");
        assert_eq!(entry.tags, ["Example", "Desktop"]);
        let empty = parse_local_catalog(
            "work",
            &json!({"schemaVersion":version,"apps":[]}).to_string(),
        )
        .unwrap();
        assert_eq!(empty.source_id, "work");
        assert!(empty.entries.is_empty());
    }
}

#[test]
fn never_projects_urls_news_or_publishing_metadata() {
    let projected =
        serde_json::to_value(parse_local_catalog("work", &launch_document(1).to_string()).unwrap())
            .unwrap();
    assert_eq!(
        projected,
        json!({"sourceId":"work","entries":[{
            "key":{"sourceId":"work","appId":"example-app"}, "source":"local",
            "name":"Example App", "tagline":"An example for testing",
            "description":"A fictional catalog entry.", "tags":["Example","Desktop"]
        }]})
    );
    let serialized = projected.to_string();
    assert!(!serialized.contains("https://"));
    assert!(!serialized.contains("release"));
}

#[test]
fn rejects_malformed_unsupported_duplicate_and_invalid_metadata_whole() {
    let mut duplicate = launch_document(1);
    let copy = duplicate["apps"][0].clone();
    duplicate["apps"].as_array_mut().unwrap().push(copy);
    let mut missing = launch_document(1);
    missing["apps"][0]
        .as_object_mut()
        .unwrap()
        .remove("installerUrl");
    let mut invalid_url = launch_document(1);
    invalid_url["apps"][0]["iconUrl"] = json!("file:///private.png");
    for invalid in [
        "{".to_owned(),
        json!({"schemaVersion":3,"apps":[]}).to_string(),
        duplicate.to_string(),
        missing.to_string(),
        invalid_url.to_string(),
    ] {
        assert_eq!(
            parse_local_catalog("work", &invalid),
            Err(LocalCatalogError::Invalid)
        );
    }
}

#[test]
fn rejects_mixed_or_non_launch_levels_without_partial_entries() {
    let mut mixed = launch_document(1);
    let mut second = mixed["apps"][0].clone();
    second["id"] = json!("second-app");
    second["integrationLevel"] = json!("update");
    mixed["apps"].as_array_mut().unwrap().push(second);
    assert_eq!(
        parse_local_catalog("work", &mixed.to_string()),
        Err(LocalCatalogError::LaunchOnly)
    );
    assert_eq!(
        parse_local_catalog("work", FULL),
        Err(LocalCatalogError::LaunchOnly)
    );
}

#[test]
fn refresh_rereads_selected_source_and_failures_do_not_return_stale_entries() {
    let reader = FakeReader::default();
    let path = "C:\\work\\catalog.json";
    assert_eq!(
        read_local_catalog(&reader, "work", path),
        Err(LocalCatalogError::Unreadable)
    );
    reader
        .files
        .borrow_mut()
        .insert(path.into(), launch_document(1).to_string());
    assert_eq!(
        read_local_catalog(&reader, "work", path)
            .unwrap()
            .entries
            .len(),
        1
    );
    reader.files.borrow_mut().insert(path.into(), "{".into());
    assert_eq!(
        read_local_catalog(&reader, "work", path),
        Err(LocalCatalogError::Invalid)
    );
    reader
        .files
        .borrow_mut()
        .insert(path.into(), launch_document(2).to_string());
    assert_eq!(
        read_local_catalog(&reader, "work", path)
            .unwrap()
            .entries
            .len(),
        1
    );
    assert_eq!(*reader.reads.borrow(), vec![path; 4]);
}

#[test]
fn identical_catalog_ids_in_different_sources_remain_distinct() {
    let text = launch_document(1).to_string();
    let first = parse_local_catalog("work", &text).unwrap();
    let second = parse_local_catalog("personal", &text).unwrap();
    assert_ne!(first.entries[0].key, second.entries[0].key);
    assert_eq!(first.entries[0].key.app_id, second.entries[0].key.app_id);
}

#[test]
fn later_refresh_fences_older_results_even_when_the_newer_fails() {
    let fence = RefreshFence::default();
    let old = fence.begin("work");
    let new = fence.begin("work");
    assert!(fence.finish(new, Err(LocalCatalogError::Unreadable)));
    let stale = parse_local_catalog("work", &launch_document(1).to_string());
    assert!(!fence.finish(old, stale));
    assert_eq!(
        fence.current("work"),
        Some(Err(LocalCatalogError::Unreadable))
    );
}

#[test]
fn removing_or_replacing_a_source_fences_its_inflight_refresh_only() {
    let fence = RefreshFence::default();
    let work = fence.begin("work");
    let personal = fence.begin("personal");
    fence.invalidate("work");
    assert!(!fence.finish(
        work,
        parse_local_catalog("work", &launch_document(1).to_string())
    ));
    assert!(fence.finish(
        personal,
        parse_local_catalog("personal", &launch_document(1).to_string())
    ));
    assert_eq!(fence.current("work"), None);
    let current = fence.current("personal").unwrap().unwrap();
    assert_eq!(current.source_id, "personal");
    assert_eq!(current.entries.len(), 1);
}

#[test]
fn refresh_cannot_publish_a_snapshot_for_a_different_source() {
    let fence = RefreshFence::default();
    let work = fence.begin("work");
    let mismatched = parse_local_catalog("personal", &launch_document(1).to_string());
    assert!(!fence.finish(work, mismatched));
    assert_eq!(fence.current("work"), None);
}

#[test]
fn official_parser_still_accepts_full_integration_and_projects_news() {
    let official = nexo_catalog::parse_catalog(FULL).unwrap();
    assert_eq!(
        official.apps[0].integration_level,
        nexo_catalog::IntegrationLevel::Full
    );
    assert_eq!(official.apps[0].news.len(), 1);
}
