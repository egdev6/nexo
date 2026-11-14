//! Version 1 of the public, maintainer-curated catalog.
//! Parse untrusted input with [`parse_catalog`] rather than deserializing it directly.

use chrono::DateTime;
use semver::Version;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;
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
    pub news: Vec<NewsEntry>,
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

/// Decode and validate the complete document before using or caching it.
pub fn parse_catalog(input: &str) -> Result<Catalog, CatalogError> {
    let mut value: serde_json::Value =
        serde_json::from_str(input).map_err(|_| CatalogError::Document)?;
    // JSON Schema and JavaScript treat 1 and 1.0 as the same number.
    if let Some(version) = value.get_mut("schemaVersion")
        && version.is_number()
    {
        if version.as_f64() != Some(1.0) {
            return Err(CatalogError::SchemaVersion);
        }
        *version = serde_json::Value::from(1);
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
    if catalog.schema_version != 1 {
        return Err(CatalogError::SchemaVersion);
    }
    let mut app_ids = HashSet::new();
    for app in &catalog.apps {
        if !valid_id(&app.id) {
            return Err(CatalogError::BadId);
        }
        if !app_ids.insert(&app.id) {
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
    }
    Ok(catalog)
}
