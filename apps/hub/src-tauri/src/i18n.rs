use serde_json::Value;
use std::sync::{Mutex, OnceLock};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum Locale {
    #[default]
    Es,
    En,
}

impl Locale {
    pub(crate) fn from_language(language: &str) -> Self {
        if language == "en" { Self::En } else { Self::Es }
    }
}

pub(crate) fn text(locale: Locale, key: &str) -> &str {
    static CATALOG: OnceLock<Value> = OnceLock::new();
    let catalog = CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/i18n/messages.json"))
            .expect("valid translations")
    });
    let language = match locale {
        Locale::Es => "es",
        Locale::En => "en",
    };
    catalog[language]["native"][key]
        .as_str()
        .filter(|value| !value.is_empty())
        .or_else(|| catalog["es"]["native"][key].as_str())
        .unwrap_or(key)
}

// App-management internals use stable keys; diagnostics supplied by the OS stay verbatim.
#[cfg(any(windows, test))]
pub(crate) fn app_message(locale: Locale, message: &str) -> String {
    let Some(encoded) = message.strip_prefix("nexo.") else {
        return message.to_owned();
    };
    let (key, detail) = encoded
        .split_once(':')
        .map_or((encoded, None), |(key, detail)| (key, Some(detail)));
    if !key.starts_with("app") || text(locale, key) == key {
        return message.to_owned();
    }
    match detail {
        Some(detail) => text(locale, key).replace("{error}", detail),
        None => text(locale, key).to_owned(),
    }
}

// Serializes all tray presentations; the stored setting remains authoritative.
#[derive(Default)]
pub(crate) struct Presentation(Mutex<()>);

impl Presentation {
    pub(crate) fn refresh<T, E>(
        &self,
        read: impl FnOnce() -> Locale,
        rebuild: impl FnOnce(Locale) -> Result<T, E>,
    ) -> Result<T, E> {
        let _guard = self.0.lock().unwrap();
        rebuild(read())
    }
}

#[cfg(test)]
#[path = "i18n_tests.rs"]
mod tests;
