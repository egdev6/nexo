use super::*;
const INITIAL: &str = "https://github.com/egdev6/antena/releases/download/v1/A_x64-setup.exe";
fn hop(location: &str) -> Result<String, Failure> {
    let current = url::Url::parse(INITIAL).unwrap();
    redirect_target(&current, location).map(|url| url.to_string())
}
#[test]
fn vp_redirect_accepts_only_exact_asset_hosts_after_normalization() {
    for ok in [
        "https://release-assets.githubusercontent.com/x?sig=1",
        "https://objects.githubusercontent.com/x",
        "//release-assets.githubusercontent.com/x",
        "https://RELEASE-ASSETS.githubusercontent.com/x",
        "https://release-assets.githubusercontent.com:443/x",
    ] {
        assert!(hop(ok).is_ok(), "{ok}");
    }
    for bad in [
        "https://release-assets.githubusercontent.com./x",
        "https://evil.release-assets.githubusercontent.com/x",
        "https://release-assets.githubusercontent.com.evil.example/x",
        "https://githubusercontent.com/x",
        "https:release-assets.githubusercontent.com/x",
        "/egdev6/other/releases/download/v1/x.exe",
        "https://release-assets.githubusercontent.com:8443/x",
        "https://u@release-assets.githubusercontent.com/x",
        "//u:p@release-assets.githubusercontent.com/x",
        "https://evil.example@release-assets.githubusercontent.com/x",
        "https://release-assets.githubusercontent.com/x#frag",
        "https:\\\\release-assets.githubusercontent.com/x",
        "https://release-assets.githubusercontent.com/\tx",
        "ftp://release-assets.githubusercontent.com/x",
        "http://objects.githubusercontent.com/x",
        "",
    ] {
        assert_eq!(hop(bad), Err(Failure::RedirectUrl), "{bad:?}");
    }
}
#[test]
fn official_parser_still_accepts_full_integration_and_projects_news() {
    let official = nexo_catalog::parse_catalog(include_str!(
        "../../../../crates/nexo-catalog/fixtures/full.json"
    ))
    .unwrap();
    assert_eq!(
        official.apps[0].integration_level,
        nexo_catalog::IntegrationLevel::Full
    );
    assert_eq!(official.apps[0].news.len(), 1);
}

#[test]
fn vp_official_catalogs_validate_v3_keys_and_reject_them_in_v2() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let mut raw = [0_u8; 42];
    raw[..2].copy_from_slice(b"Ed");
    let key = STANDARD.encode(format!("untrusted comment: k\n{}\n", STANDARD.encode(raw)));
    let doc = |version: u8, key: Option<&str>| {
        let mut app = serde_json::json!({"id": "antena", "name": "Antena", "tagline": "t", "description": "d",
            "tags": [], "iconUrl": "https://example.com/i.png", "installerUrl": INITIAL,
            "latestJsonUrl": "https://github.com/egdev6/antena/releases/download/v1/latest.json",
            "integrationLevel": "launch", "releasedAt": "2026-01-01T00:00:00Z", "featured": false, "news": []});
        if let Some(key) = key {
            app["updaterPublicKey"] = key.into();
        }
        serde_json::json!({"schemaVersion": version, "apps": [app]}).to_string()
    };
    assert!(nexo_catalog::parse_catalog(&doc(3, Some(&key))).is_ok());
    assert!(nexo_catalog::parse_catalog(&doc(2, Some(&key))).is_err());
}
