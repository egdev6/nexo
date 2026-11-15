//! Only native selections enter this short-lived, in-memory dialog session.
use super::{
    ExecutableFs, Picker, Selection,
    icons::{self, IconFs, IconPicker},
};
use crate::config::Store;
use std::time::{Duration, Instant};

const LIFETIME: Duration = Duration::from_secs(600);

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutableSelection {
    pub token: String,
    pub path: String,
    pub suggested_name: String,
}

#[derive(Debug, serde::Serialize)]
pub(crate) struct IconSelection {
    pub token: String,
    pub preview: String,
}

struct Pending<T> {
    token: String,
    created: Instant,
    value: T,
}

impl<T> Pending<T> {
    fn matches(&self, token: &str, now: Instant) -> bool {
        self.token == token && now.saturating_duration_since(self.created) < LIFETIME
    }
}

struct IconBytes {
    bytes: Vec<u8>,
    extension: &'static str,
}

#[derive(Default)]
pub(super) struct PendingSelections {
    generation: u64,
    executable: Option<Pending<String>>,
    icon: Option<Pending<IconBytes>>,
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0_u8; 16];
    rustls::crypto::ring::default_provider()
        .secure_random
        .fill(&mut bytes)
        .map_err(|_| "nexo.local.refused")?;
    use std::fmt::Write as _;
    let mut token = String::with_capacity(32);
    for byte in bytes {
        write!(&mut token, "{byte:02x}").expect("writing to a string cannot fail");
    }
    Ok(token)
}

impl PendingSelections {
    pub(super) fn generation(&self) -> u64 {
        self.generation
    }

    pub(super) fn cancel(&mut self) {
        self.generation = self.generation.wrapping_add(1);
        self.executable = None;
        self.icon = None;
    }

    pub(super) fn pick_executable(
        &mut self,
        fs: &impl ExecutableFs,
        picker: &impl Picker,
        generation: u64,
        now: Instant,
    ) -> Result<Option<ExecutableSelection>, String> {
        if generation != self.generation {
            return Err("nexo.local.refused".into());
        }
        let Some(path) = picker.pick_executable()? else {
            return Ok(None);
        };
        let path = super::validate_executable(fs, &path)?;
        let filename = path.rsplit('\\').next().expect("validated filename");
        let suggested_name =
            super::valid_name(filename.rsplit_once('.').expect("validated extension").0)?
                .to_owned();
        let token = random_token()?;
        self.executable = Some(Pending {
            token: token.clone(),
            created: now,
            value: path.clone(),
        });
        Ok(Some(ExecutableSelection {
            token,
            path,
            suggested_name,
        }))
    }

    pub(super) fn pick_icon(
        &mut self,
        fs: &impl IconFs,
        picker: &impl IconPicker,
        generation: u64,
        now: Instant,
    ) -> Result<Option<IconSelection>, String> {
        if generation != self.generation {
            return Err("nexo.local.refused".into());
        }
        let Some(path) = picker.pick_icon()? else {
            return Ok(None);
        };
        let (path, extension) = icons::selected_file(fs, &path)?;
        let bytes = fs.read_icon(&path)?;
        if !icons::valid_icon(&bytes, extension) {
            return Err("nexo.local.invalidIcon".into());
        }
        let preview = icons::icon_data_url(&bytes, extension).ok_or("nexo.local.invalidIcon")?;
        let token = random_token()?;
        self.icon = Some(Pending {
            token: token.clone(),
            created: now,
            value: IconBytes { bytes, extension },
        });
        Ok(Some(IconSelection { token, preview }))
    }

    pub(super) fn create(
        &mut self,
        store: &Store,
        fs: &impl IconFs,
        token: &str,
        name: &str,
        icon_token: Option<&str>,
        now: Instant,
    ) -> Result<Selection, String> {
        let name = super::valid_name(name)?;
        let executable = self
            .executable
            .as_ref()
            .filter(|entry| entry.matches(token, now))
            .ok_or("nexo.local.refused")?;
        if icon_token.is_some_and(|token| {
            !self
                .icon
                .as_ref()
                .is_some_and(|entry| entry.matches(token, now))
        }) {
            return Err("nexo.local.refused".into());
        }
        // Recheck immediately before persisting; never use a path supplied by the renderer.
        let executable = super::validate_executable(fs, &executable.value)?;
        self.executable = None;
        let icon = if icon_token.is_some() {
            self.icon.take().map(|entry| entry.value)
        } else {
            None
        };
        let icon_name = icon
            .as_ref()
            .map(|icon| icons::save_valid_icon(fs, &icon.bytes, icon.extension))
            .transpose()?;
        match super::save_new(store, executable, name, icon_name.clone()) {
            Ok(saved) => Ok(saved),
            Err(error) => {
                icons::delete_owned(fs, icon_name.as_deref())
                    .map_err(|cleanup| format!("{error}; {cleanup}"))?;
                Err(error)
            }
        }
    }
}

#[cfg(test)]
#[path = "selection_tokens_tests.rs"]
mod tests;
