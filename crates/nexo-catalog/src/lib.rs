//! Public, maintainer-curated catalog formats.
//!
//! Validate v4 wire documents with [`parse_catalog_v4`], then project them with
//! [`project_catalog_v4`]. [`parse_catalog`] retains the flat v1–v3 formats.

use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::DateTime;
use semver::Version;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::{BTreeMap, HashSet};
use thiserror::Error;
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u64,
    pub apps: Vec<CatalogApp>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogApp {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub description: String,
    pub tags: Vec<String>,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub icon_url: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub art_url: Option<String>,
    pub installer_url: String,
    pub latest_json_url: String,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub updater_public_key: Option<String>,
    pub integration_level: IntegrationLevel,
    pub released_at: String,
    pub featured: bool,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub version: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub links: Option<DiscoveryLinks>,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub detection: Option<Detection>,
    pub news: Vec<NewsEntry>,
}

/// The v4 wire document, before selecting a platform.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogV4 {
    pub schema_version: u64,
    pub apps: Vec<CatalogAppV4>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogAppV4 {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub description: String,
    pub tags: Vec<String>,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub icon_url: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub art_url: Option<String>,
    pub integration_level: IntegrationLevel,
    pub featured: bool,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub links: Option<DiscoveryLinks>,
    pub news: Vec<NewsEntry>,
    pub platforms: BTreeMap<String, PlatformEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformEntry {
    pub installer_url: String,
    pub latest_json_url: String,
    pub version: String,
    pub released_at: String,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub updater_public_key: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub detection: Option<WindowsDetection>,
}

impl CatalogAppV4 {
    fn project(&self, entry: &PlatformEntry) -> CatalogApp {
        CatalogApp {
            id: self.id.clone(),
            name: self.name.clone(),
            tagline: self.tagline.clone(),
            description: self.description.clone(),
            tags: self.tags.clone(),
            icon_url: self.icon_url.clone(),
            art_url: self.art_url.clone(),
            installer_url: entry.installer_url.clone(),
            latest_json_url: entry.latest_json_url.clone(),
            updater_public_key: entry.updater_public_key.clone(),
            integration_level: self.integration_level,
            released_at: entry.released_at.clone(),
            featured: self.featured,
            version: Some(entry.version.clone()),
            links: self.links.clone(),
            detection: entry.detection.clone().map(|windows| Detection { windows }),
            news: self.news.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Detection {
    pub windows: WindowsDetection,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WindowsDetection {
    pub display_name: String,
    pub publisher: String,
    pub executable_relative_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IntegrationLevel {
    Full,
    Update,
    Launch,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscoveryLinks {
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub github: Option<String>,
    #[serde(
        default,
        deserialize_with = "optional_non_null",
        skip_serializing_if = "Option::is_none"
    )]
    pub youtube: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewsEntry {
    pub id: String,
    pub title: String,
    pub text: String,
    pub published_at: String,
    pub kind: NewsKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NewsKind {
    New,
    Featured,
    Update,
}

fn optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CatalogError {
    #[error("malformed catalog or missing field")]
    Document,
    #[error("unsupported catalog schema version")]
    SchemaVersion,
    #[error("invalid id")]
    BadId,
    #[error("duplicate app id")]
    DuplicateId,
    #[error("invalid HTTPS URL")]
    BadUrl,
    #[error("invalid updater public key")]
    BadPublicKey,
    #[error("invalid semantic version")]
    BadVersion,
    #[error("invalid RFC 3339 timestamp")]
    BadDate,
    #[error("unknown integration level")]
    UnknownIntegration,
    #[error("unknown news kind")]
    UnknownNewsKind,
    #[error("duplicate news id")]
    DuplicateNewsId,
    #[error("required text is empty")]
    EmptyText,
    #[error("an icon or art URL is required")]
    MissingArtwork,
    #[error("invalid Windows executable relative path")]
    BadExecutablePath,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn check_url(input: &str) -> Result<(), CatalogError> {
    let Some(rest) = input.strip_prefix("https://") else {
        return Err(CatalogError::BadUrl);
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    let bytes = input.as_bytes();
    if authority.is_empty()
        || authority.contains(['@', '\\'])
        || input
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\u{feff}')
        || bytes.iter().enumerate().any(|(i, b)| {
            *b == b'%'
                && !(bytes.get(i + 1).is_some_and(u8::is_ascii_hexdigit)
                    && bytes.get(i + 2).is_some_and(u8::is_ascii_hexdigit))
        })
    {
        return Err(CatalogError::BadUrl);
    }
    let url = Url::parse(input).map_err(|_| CatalogError::BadUrl)?;
    if url.scheme() != "https"
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(CatalogError::BadUrl);
    }
    Ok(())
}

/// Validate an official GitHub release asset URL before it is used for execution or updates.
pub fn check_release_asset_url(input: &str) -> Result<(), CatalogError> {
    check_url(input)?;
    let url = Url::parse(input).map_err(|_| CatalogError::BadUrl)?;
    if url.host_str() != Some("github.com")
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(CatalogError::BadUrl);
    }
    let authority_end = input[8..].find('/').ok_or(CatalogError::BadUrl)? + 8;
    let raw_path = &input[authority_end..];
    // URL parsers normalize dot segments. Reject normalized and escaped separators rather
    // than allowing the server and client to disagree about the release-asset route.
    if raw_path != url.path() {
        return Err(CatalogError::BadUrl);
    }
    let bytes = raw_path.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte == b'%' {
            let encoded = u8::from_str_radix(&raw_path[index + 1..index + 3], 16)
                .map_err(|_| CatalogError::BadUrl)?;
            if encoded.is_ascii_control() || matches!(encoded, b'/' | b'\\' | b'.' | b'%') {
                return Err(CatalogError::BadUrl);
            }
        }
    }
    let parts: Vec<_> = raw_path
        .strip_prefix('/')
        .ok_or(CatalogError::BadUrl)?
        .split('/')
        .collect();
    if parts.len() != 6
        || parts[0] != "egdev6"
        || parts[2] != "releases"
        || parts[3] != "download"
        || parts
            .iter()
            .any(|part| part.is_empty() || *part == "." || *part == "..")
    {
        return Err(CatalogError::BadUrl);
    }
    Ok(())
}

fn check_updater_key(input: &str) -> Result<(), CatalogError> {
    let decoded = STANDARD
        .decode(input)
        .map_err(|_| CatalogError::BadPublicKey)?;
    if STANDARD.encode(&decoded) != input {
        return Err(CatalogError::BadPublicKey);
    }
    let text = std::str::from_utf8(&decoded).map_err(|_| CatalogError::BadPublicKey)?;
    let mut lines = text.lines();
    if !lines
        .next()
        .is_some_and(|line| line.starts_with("untrusted comment: "))
    {
        return Err(CatalogError::BadPublicKey);
    }
    let encoded = lines.next().ok_or(CatalogError::BadPublicKey)?;
    let key = STANDARD
        .decode(encoded)
        .map_err(|_| CatalogError::BadPublicKey)?;
    if lines.next().is_some()
        || STANDARD.encode(&key) != encoded
        || key.len() != 42
        || &key[..2] != b"Ed"
    {
        return Err(CatalogError::BadPublicKey);
    }
    Ok(())
}

fn check_date(input: &str) -> Result<(), CatalogError> {
    let b = input.as_bytes();
    // The interchange profile uses uppercase T/Z, a four-digit year and explicit seconds.
    let shape = b.len() >= 20
        && b.get(4) == Some(&b'-')
        && b.get(7) == Some(&b'-')
        && b.get(10) == Some(&b'T')
        && b.get(13) == Some(&b':')
        && b.get(16) == Some(&b':')
        && [0, 1, 2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18]
            .iter()
            .all(|&i| b[i].is_ascii_digit());
    if !shape {
        return Err(CatalogError::BadDate);
    }
    let suffix = &b[19..];
    let timezone = if suffix.first() == Some(&b'.') {
        let digits = suffix[1..]
            .iter()
            .take_while(|b| b.is_ascii_digit())
            .count();
        if digits == 0 {
            return Err(CatalogError::BadDate);
        }
        &suffix[1 + digits..]
    } else {
        suffix
    };
    let zone_ok = timezone == b"Z"
        || (timezone.len() == 6
            && matches!(timezone[0], b'+' | b'-')
            && timezone[3] == b':'
            && [1, 2, 4, 5].iter().all(|&i| timezone[i].is_ascii_digit()));
    if !zone_ok || DateTime::parse_from_rfc3339(input).is_err() {
        return Err(CatalogError::BadDate);
    }
    Ok(())
}

fn check_text(input: &str) -> Result<(), CatalogError> {
    if input.chars().all(|c| c.is_whitespace() || c == '\u{feff}') {
        Err(CatalogError::EmptyText)
    } else {
        Ok(())
    }
}

fn check_executable_path(path: &str) -> Result<(), CatalogError> {
    if !path.to_ascii_lowercase().ends_with(".exe")
        || path
            .chars()
            .any(|c| c.is_control() || "<>:\"|?*".contains(c))
        || path.split(['/', '\\']).any(|part| {
            part.is_empty() || part == "." || part == ".." || part.ends_with([' ', '.'])
        })
    {
        return Err(CatalogError::BadExecutablePath);
    }
    Ok(())
}

/// Decode and validate the complete document before using or caching it.
pub fn parse_catalog(input: &str) -> Result<Catalog, CatalogError> {
    let mut value: serde_json::Value =
        serde_json::from_str(input).map_err(|_| CatalogError::Document)?;
    // JSON Schema and JavaScript treat 1 and 1.0 as the same number.
    if let Some(version) = value.get_mut("schemaVersion")
        && version.is_number()
    {
        *version = match version.as_f64() {
            Some(1.0) => serde_json::Value::from(1),
            Some(2.0) => serde_json::Value::from(2),
            Some(3.0) => serde_json::Value::from(3),
            _ => return Err(CatalogError::SchemaVersion),
        };
    }
    // Preserve typed errors for unknown enum values instead of conflating them with malformed JSON.
    if let Some(apps) = value.get("apps").and_then(|v| v.as_array()) {
        for app in apps {
            if let Some(level) = app.get("integrationLevel").and_then(|v| v.as_str())
                && !matches!(level, "full" | "update" | "launch")
            {
                return Err(CatalogError::UnknownIntegration);
            }
            if let Some(news) = app.get("news").and_then(|v| v.as_array()) {
                for item in news {
                    if let Some(kind) = item.get("kind").and_then(|v| v.as_str())
                        && !matches!(kind, "new" | "featured" | "update")
                    {
                        return Err(CatalogError::UnknownNewsKind);
                    }
                }
            }
        }
    }
    let catalog: Catalog = serde_json::from_value(value).map_err(|_| CatalogError::Document)?;
    if !matches!(catalog.schema_version, 1..=3) {
        return Err(CatalogError::SchemaVersion);
    }
    if catalog.schema_version == 1 && catalog.apps.iter().any(|app| app.detection.is_some()) {
        return Err(CatalogError::Document);
    }
    if catalog.schema_version < 3
        && catalog
            .apps
            .iter()
            .any(|app| app.updater_public_key.is_some())
    {
        return Err(CatalogError::Document);
    }
    let mut app_ids = HashSet::new();
    for app in &catalog.apps {
        validate_app(app, catalog.schema_version, Some(&mut app_ids))?;
    }
    Ok(catalog)
}

fn validate_app<'a>(
    app: &'a CatalogApp,
    schema_version: u64,
    app_ids: Option<&mut HashSet<&'a String>>,
) -> Result<(), CatalogError> {
    if schema_version >= 3 {
        check_release_asset_url(&app.installer_url)?;
        check_release_asset_url(&app.latest_json_url)?;
        if let Some(key) = &app.updater_public_key {
            check_updater_key(key)?;
        }
    }
    if let Some(detection) = &app.detection {
        check_text(&detection.windows.display_name)?;
        check_text(&detection.windows.publisher)?;
        check_executable_path(&detection.windows.executable_relative_path)?;
    }
    if !valid_id(&app.id) {
        return Err(CatalogError::BadId);
    }
    if let Some(ids) = app_ids
        && !ids.insert(&app.id)
    {
        return Err(CatalogError::DuplicateId);
    }
    for text in [&app.name, &app.tagline, &app.description]
        .into_iter()
        .chain(app.tags.iter())
    {
        check_text(text)?;
    }
    if app.icon_url.is_none() && app.art_url.is_none() {
        return Err(CatalogError::MissingArtwork);
    }
    for url in [
        app.icon_url.as_deref(),
        app.art_url.as_deref(),
        Some(&app.installer_url),
        Some(&app.latest_json_url),
    ]
    .into_iter()
    .flatten()
    {
        check_url(url)?;
    }
    if let Some(links) = &app.links {
        for url in [links.github.as_deref(), links.youtube.as_deref()]
            .into_iter()
            .flatten()
        {
            check_url(url)?;
        }
    }
    if let Some(version) = &app.version {
        Version::parse(version).map_err(|_| CatalogError::BadVersion)?;
    }
    check_date(&app.released_at)?;
    let mut news_ids = HashSet::new();
    for item in &app.news {
        if !valid_id(&item.id) {
            return Err(CatalogError::BadId);
        }
        if !news_ids.insert(&item.id) {
            return Err(CatalogError::DuplicateNewsId);
        }
        check_text(&item.title)?;
        check_text(&item.text)?;
        check_date(&item.published_at)?;
    }
    Ok(())
}

/// Decode and validate every platform entry of a v4 wire document.
pub fn parse_catalog_v4(input: &str) -> Result<CatalogV4, CatalogError> {
    let mut value: serde_json::Value =
        serde_json::from_str(input).map_err(|_| CatalogError::Document)?;
    if let Some(version) = value.get_mut("schemaVersion")
        && version.is_number()
    {
        if version.as_f64() != Some(4.0) {
            return Err(CatalogError::SchemaVersion);
        }
        *version = serde_json::Value::from(4);
    }
    let catalog: CatalogV4 = serde_json::from_value(value).map_err(|_| CatalogError::Document)?;
    if catalog.schema_version != 4 {
        return Err(CatalogError::SchemaVersion);
    }
    let mut app_ids = HashSet::new();
    for app in &catalog.apps {
        if app.platforms.is_empty() {
            return Err(CatalogError::Document);
        }
        if !app_ids.insert(&app.id) {
            return Err(CatalogError::DuplicateId);
        }
        for (key, entry) in &app.platforms {
            let Some((os, arch)) = key.split_once('-') else {
                return Err(CatalogError::Document);
            };
            if !matches!(os, "windows" | "darwin" | "linux")
                || !matches!(arch, "x86_64" | "aarch64" | "i686" | "armv7")
                || (os != "windows" && entry.detection.is_some())
            {
                return Err(CatalogError::Document);
            }
            validate_app(&app.project(entry), 4, None)?;
        }
    }
    Ok(catalog)
}

/// Project a validated v4 document into the existing flat model for one platform.
pub fn project_catalog_v4(catalog: &CatalogV4, platform: &str) -> Catalog {
    Catalog {
        schema_version: 4,
        apps: catalog
            .apps
            .iter()
            .filter_map(|app| app.platforms.get(platform).map(|entry| app.project(entry)))
            .collect(),
    }
}
