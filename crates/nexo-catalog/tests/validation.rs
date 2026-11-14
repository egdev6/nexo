use nexo_catalog::{CatalogError, parse_catalog};
use serde_json::{Value, json};

fn full() -> Value {
    serde_json::from_str(include_str!("../fixtures/full.json")).unwrap()
}

fn validate(value: &Value) -> Result<nexo_catalog::Catalog, CatalogError> {
    parse_catalog(&value.to_string())
}

#[test]
fn accepts_minimal_full_and_empty_catalogs() {
    for input in [
        include_str!("../fixtures/minimal.json"),
        include_str!("../fixtures/full.json"),
    ] {
        assert_eq!(parse_catalog(input).unwrap().apps.len(), 1);
    }
    assert!(
        validate(&json!({"schemaVersion": 1, "apps": []}))
            .unwrap()
            .apps
            .is_empty()
    );
    assert!(parse_catalog(r#"{"schemaVersion":1.0,"apps":[]}"#).is_ok());
}

#[test]
fn rejects_bad_and_duplicate_app_ids() {
    for id in ["", "UPPER", "a_b", "../app", "good\n"] {
        let mut doc = full();
        doc["apps"][0]["id"] = json!(id);
        assert_eq!(validate(&doc).unwrap_err(), CatalogError::BadId);
    }
    let mut doc = full();
    let app = doc["apps"][0].clone();
    doc["apps"].as_array_mut().unwrap().push(app);
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::DuplicateId);
}

#[test]
fn rejects_every_non_https_or_malformed_url() {
    for field in ["iconUrl", "artUrl", "installerUrl", "latestJsonUrl"] {
        for value in [
            "http://example.com/file",
            "relative/file",
            "https://",
            "https://user:pass@example.com",
            "https://@example.com",
            "https:///example.com",
            "https://example.com/%ZZ",
        ] {
            let mut doc = full();
            doc["apps"][0][field] = json!(value);
            assert_eq!(
                validate(&doc).unwrap_err(),
                CatalogError::BadUrl,
                "{field}={value}"
            );
        }
    }
    for field in ["github", "youtube"] {
        let mut doc = full();
        doc["apps"][0]["links"][field] = json!("http://example.com");
        assert_eq!(validate(&doc).unwrap_err(), CatalogError::BadUrl);
    }
}

#[test]
fn rejects_bad_semver_and_accepts_valid_prerelease() {
    for version in ["1.2", "v1.2.3", "01.2.3", "1.2.3-01", "1.2.3+", "1.2.3\n"] {
        let mut doc = full();
        doc["apps"][0]["version"] = json!(version);
        assert_eq!(
            validate(&doc).unwrap_err(),
            CatalogError::BadVersion,
            "{version}"
        );
    }
    assert!(validate(&full()).is_ok());
}

#[test]
fn rejects_invalid_dates_in_apps_and_news() {
    for date in [
        "2025-02-29T00:00:00Z",
        "2025-01-01",
        "2025-13-01T00:00:00Z",
        "not a date",
        "2025-01-01T00:00:00Z\n",
    ] {
        let mut doc = full();
        doc["apps"][0]["releasedAt"] = json!(date);
        assert_eq!(validate(&doc).unwrap_err(), CatalogError::BadDate, "{date}");
        let mut doc = full();
        doc["apps"][0]["news"][0]["publishedAt"] = json!(date);
        assert_eq!(validate(&doc).unwrap_err(), CatalogError::BadDate, "{date}");
    }
}

#[test]
fn rejects_unknown_integration_and_news_kinds() {
    let mut doc = full();
    doc["apps"][0]["integrationLevel"] = json!("unknown");
    assert_eq!(
        validate(&doc).unwrap_err(),
        CatalogError::UnknownIntegration
    );
    let mut doc = full();
    doc["apps"][0]["news"][0]["kind"] = json!("unknown");
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::UnknownNewsKind);
}

#[test]
fn rejects_invalid_or_duplicate_news_ids() {
    let mut doc = full();
    doc["apps"][0]["news"][0]["id"] = json!("Bad_id");
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::BadId);
    let mut doc = full();
    let item = doc["apps"][0]["news"][0].clone();
    doc["apps"][0]["news"].as_array_mut().unwrap().push(item);
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::DuplicateNewsId);
}

#[test]
fn rejects_missing_wrong_types_unknown_fields_and_schema_versions() {
    let mut doc = full();
    doc["apps"][0].as_object_mut().unwrap().remove("name");
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::Document);
    let mut doc = full();
    doc["apps"][0]["featured"] = json!("true");
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::Document);
    let mut doc = full();
    doc["apps"][0]["unexpected"] = json!(true);
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::Document);
    let mut doc = full();
    doc["schemaVersion"] = json!(2);
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::SchemaVersion);
    assert_eq!(parse_catalog("{").unwrap_err(), CatalogError::Document);
}

fn parity_document(case: &Value) -> Value {
    let mut document = match case["base"].as_str().unwrap() {
        "full" => full(),
        "minimal" => serde_json::from_str(include_str!("../fixtures/minimal.json")).unwrap(),
        "empty" => json!({"schemaVersion": 1, "apps": []}),
        _ => panic!("unknown fixture"),
    };
    for patch in case["patches"].as_array().into_iter().flatten() {
        let path = patch["path"].as_str().unwrap();
        match patch["op"].as_str().unwrap() {
            "set" => *document.pointer_mut(path).unwrap() = patch["value"].clone(),
            "remove" | "add" => {
                let (parent, key) = path.rsplit_once('/').unwrap();
                let object = document
                    .pointer_mut(parent)
                    .unwrap()
                    .as_object_mut()
                    .unwrap();
                if patch["op"] == "remove" {
                    object.remove(key).unwrap();
                } else {
                    object.insert(key.to_owned(), patch["value"].clone());
                }
            }
            "duplicate" => {
                let items = document.pointer_mut(path).unwrap().as_array_mut().unwrap();
                items.push(items[0].clone());
            }
            _ => panic!("unknown patch"),
        }
    }
    document
}

#[test]
fn shared_corpus_pins_validation_and_catalog_field_mapping() {
    let corpus: Value = serde_json::from_str(include_str!("../fixtures/parity.json")).unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let mut document = parity_document(case);
        let parsed = validate(&document);
        let valid = case["valid"].as_bool().unwrap();
        assert_eq!(parsed.is_ok(), valid, "{}", case["name"]);
        if let Ok(catalog) = parsed {
            document["schemaVersion"] = json!(1);
            assert_eq!(
                serde_json::to_value(catalog).unwrap(),
                document,
                "{}",
                case["name"]
            );
        }
    }
}

#[test]
fn shared_corpus_rejects_unicode_controls_and_bom_in_urls() {
    let corpus: Value = serde_json::from_str(include_str!("../fixtures/parity.json")).unwrap();
    for case in corpus["cases"].as_array().unwrap().iter().filter(|case| {
        matches!(
            case["name"].as_str(),
            Some("C1 control in URL" | "BOM in URL")
        )
    }) {
        assert!(
            validate(&parity_document(case)).is_err(),
            "{}",
            case["name"]
        );
    }
}

#[test]
fn shared_full_projection_pins_catalog_and_news_fields() {
    let corpus: Value = serde_json::from_str(include_str!("../fixtures/parity.json")).unwrap();
    let catalog = parse_catalog(include_str!("../fixtures/full.json")).unwrap();
    let app = &catalog.apps[0];
    let news: Vec<Value> = app
        .news
        .iter()
        .map(|item| {
            let badge = match item.kind {
                nexo_catalog::NewsKind::New => "Nuevo",
                nexo_catalog::NewsKind::Featured => "Destacada",
                nexo_catalog::NewsKind::Update => "Actualización",
            };
            json!({
                "id": format!("{}:{}", app.id, item.id), "appId": app.id,
                "badge": badge, "title": item.title, "text": item.text,
                "cta": "Ver en el catálogo", "publishedAt": item.published_at
            })
        })
        .collect();
    let projection = json!({
        "apps": [{
            "id": app.id, "name": app.name, "tagline": app.tagline,
            "description": app.description, "tags": app.tags, "iconUrl": app.icon_url,
            "artUrl": app.art_url, "links": app.links, "source": "official", "statusKnown": false,
            "catalogIntegration": app.integration_level, "catalogVersion": app.version,
            "releasedAt": app.released_at, "featured": app.featured
        }],
        "news": news
    });
    assert_eq!(projection, corpus["projectedFull"]);
}

#[test]
fn rejects_blank_text_and_requires_icon_or_art() {
    for field in ["name", "tagline", "description"] {
        let mut doc = full();
        doc["apps"][0][field] = json!("  ");
        assert_eq!(
            validate(&doc).unwrap_err(),
            CatalogError::EmptyText,
            "{field}"
        );
    }
    for field in ["title", "text"] {
        let mut doc = full();
        doc["apps"][0]["news"][0][field] = json!(" ");
        assert_eq!(
            validate(&doc).unwrap_err(),
            CatalogError::EmptyText,
            "{field}"
        );
    }
    let mut doc = full();
    doc["apps"][0]["tags"] = json!([""]);
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::EmptyText);
    let mut doc = full();
    let app = doc["apps"][0].as_object_mut().unwrap();
    app.remove("iconUrl");
    app.remove("artUrl");
    assert_eq!(validate(&doc).unwrap_err(), CatalogError::MissingArtwork);
    let mut doc = full();
    doc["apps"][0].as_object_mut().unwrap().remove("iconUrl");
    assert!(validate(&doc).is_ok());
}
