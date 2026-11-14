//! Local catalog ingestion. Network metadata is deliberately not projected.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntryKey {
    pub source_id: String,
    pub app_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCatalogEntry {
    pub key: LocalEntryKey,
    pub source: &'static str,
    pub name: String,
    pub tagline: String,
    pub description: String,
    pub tags: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalCatalogSnapshot {
    pub source_id: String,
    pub entries: Vec<LocalCatalogEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LocalCatalogError {
    Unreadable,
    Invalid,
    LaunchOnly,
}

/// The caller owns selection and safe local-path validation; implementations must
/// never interpret the location as a URL or request catalog metadata URLs.
pub trait LocalCatalogReader {
    fn read(&self, location: &str) -> std::io::Result<String>;
}

/// Holds the latest refresh result per source. Invalidate under the same source
/// transaction that removes or replaces a descriptor; callers must also fence
/// out-of-order delivery when applying snapshots in another process.
#[derive(Default)]
pub struct RefreshFence {
    slots: Mutex<HashMap<String, RefreshSlot>>,
}

struct RefreshSlot {
    token: Arc<()>,
    result: Option<Result<LocalCatalogSnapshot, LocalCatalogError>>,
}

pub struct RefreshTicket {
    source_id: String,
    token: Arc<()>,
}

impl RefreshFence {
    pub fn begin(&self, source_id: &str) -> RefreshTicket {
        let token = Arc::new(());
        let mut slots = self.slots.lock().unwrap_or_else(|error| error.into_inner());
        slots.insert(
            source_id.to_owned(),
            RefreshSlot {
                token: Arc::clone(&token),
                result: None,
            },
        );
        RefreshTicket {
            source_id: source_id.to_owned(),
            token,
        }
    }

    pub fn invalidate(&self, source_id: &str) {
        self.slots
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(source_id);
    }

    pub fn finish(
        &self,
        ticket: RefreshTicket,
        result: Result<LocalCatalogSnapshot, LocalCatalogError>,
    ) -> bool {
        let mut slots = self.slots.lock().unwrap_or_else(|error| error.into_inner());
        let Some(slot) = slots.get_mut(&ticket.source_id) else {
            return false;
        };
        if !Arc::ptr_eq(&slot.token, &ticket.token)
            || result.as_ref().is_ok_and(|snapshot| {
                snapshot.source_id != ticket.source_id
                    || snapshot.entries.iter().any(|entry| {
                        entry.key.source_id != ticket.source_id || entry.source != "local"
                    })
            })
        {
            return false;
        }
        slot.result = Some(result);
        true
    }

    pub fn current(
        &self,
        source_id: &str,
    ) -> Option<Result<LocalCatalogSnapshot, LocalCatalogError>> {
        self.slots
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(source_id)
            .and_then(|slot| slot.result.clone())
    }
}

/// Parse the complete unchanged catalog format, projecting only local display data.
pub fn parse_local_catalog(
    source_id: &str,
    text: &str,
) -> Result<LocalCatalogSnapshot, LocalCatalogError> {
    let catalog = nexo_catalog::parse_catalog(text).map_err(|_| LocalCatalogError::Invalid)?;
    if catalog
        .apps
        .iter()
        .any(|app| app.integration_level != nexo_catalog::IntegrationLevel::Launch)
    {
        return Err(LocalCatalogError::LaunchOnly);
    }
    let entries = catalog
        .apps
        .into_iter()
        .map(|app| LocalCatalogEntry {
            key: LocalEntryKey {
                source_id: source_id.to_owned(),
                app_id: app.id,
            },
            source: "local",
            name: app.name,
            tagline: app.tagline,
            description: app.description,
            tags: app.tags,
        })
        .collect();
    Ok(LocalCatalogSnapshot {
        source_id: source_id.to_owned(),
        entries,
    })
}

/// Reread a selected source; errors never return a partial set of entries.
pub fn read_local_catalog(
    reader: &impl LocalCatalogReader,
    source_id: &str,
    location: &str,
) -> Result<LocalCatalogSnapshot, LocalCatalogError> {
    let text = reader
        .read(location)
        .map_err(|_| LocalCatalogError::Unreadable)?;
    parse_local_catalog(source_id, &text)
}

#[cfg(test)]
#[path = "local_catalog_tests.rs"]
mod tests;
