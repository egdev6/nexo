use nexo_catalog::{parse_catalog_v4, project_catalog_v4};
use serde_json::{Value, json};

fn patched_document(case: &Value) -> Value {
    let mut document: Value = serde_json::from_str(include_str!("../fixtures/v4.json")).unwrap();
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
fn shared_v4_corpus_pins_validation_and_platform_projections() {
    let corpus: Value = serde_json::from_str(include_str!("../fixtures/parity-v4.json")).unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let parsed = parse_catalog_v4(&patched_document(case).to_string());
        assert_eq!(
            parsed.is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}",
            case["name"]
        );
    }
    let catalog = parse_catalog_v4(include_str!("../fixtures/v4.json")).unwrap();
    for (platform, expected) in corpus["projections"].as_object().unwrap() {
        assert_eq!(
            serde_json::to_value(project_catalog_v4(&catalog, platform)).unwrap(),
            *expected,
            "{platform}"
        );
    }
    assert!(project_catalog_v4(&catalog, "unsupported").apps.is_empty());
}

#[test]
fn v4_requires_valid_data_on_every_platform_even_when_not_projected() {
    let mut document: Value = serde_json::from_str(include_str!("../fixtures/v4.json")).unwrap();
    document["apps"][0]["platforms"]["darwin-aarch64"]["version"] = json!("invalid");
    assert!(parse_catalog_v4(&document.to_string()).is_err());
}

#[test]
fn v4_rejects_null_optional_fields_and_duplicate_news_but_accepts_integral_version_number() {
    let mut document: Value = serde_json::from_str(include_str!("../fixtures/v4.json")).unwrap();
    document["schemaVersion"] = json!(4.0);
    assert!(parse_catalog_v4(&document.to_string()).is_ok());
    document["apps"][0]["platforms"]["darwin-aarch64"]["updaterPublicKey"] = Value::Null;
    assert!(parse_catalog_v4(&document.to_string()).is_err());
    document["apps"][0]["platforms"]["darwin-aarch64"]
        .as_object_mut()
        .unwrap()
        .remove("updaterPublicKey");
    let news = document["apps"][0]["news"][0].clone();
    document["apps"][0]["news"]
        .as_array_mut()
        .unwrap()
        .push(news);
    assert!(parse_catalog_v4(&document.to_string()).is_err());
}

#[test]
fn leaves_the_nsis_installer_rule_to_native_selection() {
    let mut document: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/v4.json")).unwrap();
    document["apps"][0]["platforms"]["windows-x86_64"]["installerUrl"] =
        serde_json::json!("https://github.com/egdev6/example/releases/download/v1.2.3/example.msi");
    assert!(nexo_catalog::parse_catalog_v4(&document.to_string()).is_ok());
}
