//! Native v3 catalog source for installation authorization.
//!
//! This is not an authorization by itself. A transaction must obtain a new catalog at
//! the action boundary and another immediately before spawning, then revalidate its
//! selection. Cache contents and renderer-provided documents cannot construct this type.

use crate::install_download::{Body, Network, ResponseKind};
use nexo_catalog::{Catalog, CatalogApp};
use std::time::Duration;

pub const OFFICIAL_V3_FEED: &str = "https://egdev6.github.io/nexo-catalog/v3/catalog.json";
pub const FEED_LIMIT: u64 = 2 * 1024 * 1024;
pub const FEED_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeedError {
    Network,
    Timeout,
    InvalidResponse,
    TooLarge,
    LengthMismatch,
    InvalidCatalog,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelectionError {
    NotOfficial,
    MissingKey,
    UnsupportedInstaller,
    Changed,
}

/// The catalog's keyed-release contract is limited to x64 Tauri NSIS setup assets.
/// URL trust is validated separately by the catalog and the download stage.
pub(crate) fn is_x64_nsis_asset(input: &str) -> bool {
    url::Url::parse(input).ok().is_some_and(|url| {
        url.path_segments()
            .and_then(|mut segments| segments.next_back())
            .is_some_and(|asset| asset.ends_with("_x64-setup.exe"))
    })
}

#[derive(Debug)]
pub struct FreshCatalog {
    catalog: Catalog,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    app: CatalogApp,
}

impl FreshCatalog {
    /// Select by official ID only. Validated v3 entries without keys remain display-only.
    pub fn select(&self, id: &str) -> Result<Selection, SelectionError> {
        let app = self
            .catalog
            .apps
            .iter()
            .find(|app| app.id == id)
            .ok_or(SelectionError::NotOfficial)?;
        if app.updater_public_key.is_none() {
            return Err(SelectionError::MissingKey);
        }
        if !is_x64_nsis_asset(&app.installer_url) {
            return Err(SelectionError::UnsupportedInstaller);
        }
        Ok(Selection { app: app.clone() })
    }
}

impl Selection {
    pub fn app(&self) -> &CatalogApp {
        &self.app
    }

    /// Recheck the selected release and detection identity against a new successful fetch.
    pub fn revalidate(&self, current: &FreshCatalog) -> Result<Selection, SelectionError> {
        let selection = current
            .select(&self.app.id)
            .map_err(|_| SelectionError::Changed)?;
        let before = &self.app;
        let after = &selection.app;
        if before.installer_url != after.installer_url
            || before.updater_public_key != after.updater_public_key
            || before.version != after.version
            || before.detection != after.detection
        {
            return Err(SelectionError::Changed);
        }
        Ok(selection)
    }
}

pub trait CatalogFeed: Sync {
    fn fetch(&self) -> impl std::future::Future<Output = Result<FreshCatalog, FeedError>> + Send;
}

pub struct NativeFeed<N> {
    network: N,
}

impl<N> NativeFeed<N> {
    pub fn new(network: N) -> Self {
        Self { network }
    }
}

impl<N: Network> CatalogFeed for NativeFeed<N> {
    async fn fetch(&self) -> Result<FreshCatalog, FeedError> {
        let fetch = async {
            let response = self
                .network
                .get(OFFICIAL_V3_FEED)
                .await
                .map_err(|_| FeedError::Network)?;
            if response.effective_url != OFFICIAL_V3_FEED {
                return Err(FeedError::InvalidResponse);
            }
            let ResponseKind::Ok { length, mut body } = response.kind else {
                return Err(FeedError::InvalidResponse);
            };
            if length.is_some_and(|length| length > FEED_LIMIT) {
                return Err(FeedError::TooLarge);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = body.next().await.map_err(|_| FeedError::Network)? {
                if chunk.is_empty() {
                    return Err(FeedError::InvalidResponse);
                }
                let received = (bytes.len() as u64)
                    .checked_add(chunk.len() as u64)
                    .ok_or(FeedError::TooLarge)?;
                if received > FEED_LIMIT {
                    return Err(FeedError::TooLarge);
                }
                if length.is_some_and(|length| received > length) {
                    return Err(FeedError::LengthMismatch);
                }
                bytes.extend_from_slice(&chunk);
            }
            if length.is_some_and(|length| length != bytes.len() as u64) {
                return Err(FeedError::LengthMismatch);
            }
            let text = std::str::from_utf8(&bytes).map_err(|_| FeedError::InvalidCatalog)?;
            let catalog =
                nexo_catalog::parse_catalog(text).map_err(|_| FeedError::InvalidCatalog)?;
            if catalog.schema_version != 3 {
                return Err(FeedError::InvalidCatalog);
            }
            Ok(FreshCatalog { catalog })
        };
        tokio::time::timeout(FEED_TIMEOUT, fetch)
            .await
            .map_err(|_| FeedError::Timeout)?
    }
}

#[cfg(test)]
#[path = "install_feed_tests.rs"]
mod tests;
