//! Rust owns the fixed config path; no frontend filesystem capability is required.
//! A synthetic v0 is the same flat object without `version` (or with version 0).
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager, State, WebviewWindow};

const VERSION: u64 = 2;
static TEMP_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Source {
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NewsVisit {
    pub last_visit_at: String,
    pub seen_keys: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub language: String,
    pub start_with_windows: bool,
    pub show_news_on_open: bool,
    pub accent: String,
    pub compact: bool,
    pub opacity: u8,
    pub blur: u8,
    pub first_run_complete: bool,
    pub sources: Vec<Source>,
    pub news_visit: Option<NewsVisit>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "es".into(),
            start_with_windows: false,
            show_news_on_open: true,
            accent: "#ff0036".into(),
            compact: false,
            opacity: 85,
            blur: 24,
            first_run_complete: false,
            news_visit: None,
            sources: vec![Source {
                id: "official".into(),
                label: "Catálogo oficial egdev".into(),
                kind: "official".into(),
                location: None,
            }],
        }
    }
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Patch {
    pub language: Option<String>,
    pub start_with_windows: Option<bool>,
    pub show_news_on_open: Option<bool>,
    pub accent: Option<String>,
    pub compact: Option<bool>,
    pub opacity: Option<i64>,
    pub blur: Option<i64>,
    pub first_run_complete: Option<bool>,
    pub sources: Option<Vec<Source>>,
    pub news_visit: Option<NewsVisit>,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileState {
    Missing,
    Ready,
    Corrupt,
    Unreadable,
    Future,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub settings: Settings,
    pub state: FileState,
}

pub struct Store {
    path: PathBuf,
}

fn normalize_hex(raw: &str) -> Option<String> {
    let hex = raw.trim().trim_start_matches('#');
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    match hex.len() {
        3 => Some(format!(
            "#{}",
            hex.chars()
                .flat_map(|c| [c, c])
                .collect::<String>()
                .to_ascii_lowercase()
        )),
        6 => Some(format!("#{}", hex.to_ascii_lowercase())),
        _ => None,
    }
}

fn sanitize_sources(raw: &Value, fallback: Vec<Source>) -> Vec<Source> {
    let Some(values) = raw.as_array() else {
        return fallback;
    };
    let mut result = Vec::new();
    for value in values {
        let Ok(source) = serde_json::from_value::<Source>(value.clone()) else {
            continue;
        };
        if source.id.trim().is_empty()
            || source.label.trim().is_empty()
            || !matches!(source.kind.as_str(), "official" | "local")
            || result.iter().any(|old: &Source| old.id == source.id)
        {
            continue;
        }
        result.push(source);
    }
    result
}

fn settings_from(map: &Map<String, Value>) -> Settings {
    let mut settings = Settings::default();
    if let Some(s) = map.get("language").and_then(Value::as_str) {
        let normalized = s.trim().to_ascii_lowercase();
        if matches!(normalized.as_str(), "es" | "en") {
            settings.language = normalized;
        }
    }
    if let Some(v) = map.get("startWithWindows").and_then(Value::as_bool) {
        settings.start_with_windows = v;
    }
    if let Some(v) = map.get("showNewsOnOpen").and_then(Value::as_bool) {
        settings.show_news_on_open = v;
    }
    if let Some(v) = map
        .get("accent")
        .and_then(Value::as_str)
        .and_then(normalize_hex)
    {
        settings.accent = v;
    }
    if let Some(v) = map.get("compact").and_then(Value::as_bool) {
        settings.compact = v;
    }
    if let Some(v) = map.get("firstRunComplete").and_then(Value::as_bool) {
        settings.first_run_complete = v;
    }
    if let Some(v) = map
        .get("opacity")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
    {
        settings.opacity = v.clamp(0.0, 100.0).round() as u8;
    }
    if let Some(v) = map
        .get("blur")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
    {
        settings.blur = v.clamp(0.0, 40.0).round() as u8;
    }
    if let Some(v) = map.get("sources") {
        settings.sources = sanitize_sources(v, settings.sources);
    }
    if map.get("version").and_then(Value::as_u64) == Some(VERSION) {
        settings.news_visit = map
            .get("newsVisit")
            .and_then(|value| serde_json::from_value(value.clone()).ok());
    }
    settings
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn document(&self) -> Result<Map<String, Value>, FileState> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound
                    && fs::symlink_metadata(&self.path).is_err() =>
            {
                return Err(FileState::Missing);
            }
            Err(_) => return Err(FileState::Unreadable),
        };
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| FileState::Corrupt)?;
        let map = value.as_object().cloned().ok_or(FileState::Corrupt)?;
        let version = match map.get("version") {
            None => 0,
            Some(v) => v.as_u64().ok_or(FileState::Corrupt)?,
        };
        if version > VERSION {
            return Err(FileState::Future);
        }
        Ok(map)
    }

    pub fn read(&self) -> Snapshot {
        match self.document() {
            Ok(map) => Snapshot {
                settings: settings_from(&map),
                state: FileState::Ready,
            },
            Err(state) => Snapshot {
                settings: Settings::default(),
                state,
            },
        }
    }

    pub fn patch(&self, patch: Patch) -> Result<Settings, String> {
        let mut map = match self.document() {
            Ok(map) => map,
            Err(FileState::Missing) => Map::new(),
            Err(state) => {
                return Err(match state {
                    FileState::Corrupt => "nexo.config.save.corrupt",
                    FileState::Unreadable => "nexo.config.save.unreadable",
                    FileState::Future => "nexo.config.save.future",
                    FileState::Missing | FileState::Ready => unreachable!(),
                }
                .into());
            }
        };
        // The marker did not exist before v2, even if an old document happens
        // to contain an unrelated unknown field with the same name.
        if map.get("version").and_then(Value::as_u64).unwrap_or(0) < VERSION {
            map.remove("newsVisit");
        }
        // Source descriptors belong to #9 as well: preserve unrecognized per-source
        // metadata when a known descriptor survives a settings patch.
        let old_sources = map
            .get("sources")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        macro_rules! change {
            ($field:ident, $key:literal) => {
                if let Some(value) = patch.$field {
                    map.insert($key.into(), json!(value));
                }
            };
        }
        change!(language, "language");
        change!(start_with_windows, "startWithWindows");
        change!(show_news_on_open, "showNewsOnOpen");
        change!(accent, "accent");
        change!(compact, "compact");
        change!(opacity, "opacity");
        change!(blur, "blur");
        change!(first_run_complete, "firstRunComplete");
        change!(sources, "sources");
        change!(news_visit, "newsVisit");
        map.insert("version".into(), json!(VERSION));
        let settings = settings_from(&map);
        let known = serde_json::to_value(&settings).map_err(|e| e.to_string())?;
        for (key, value) in known.as_object().expect("settings is an object") {
            if key == "sources" {
                let merged = value
                    .as_array()
                    .expect("sources is an array")
                    .iter()
                    .map(|source| {
                        let fields = source.as_object().expect("source is an object");
                        let id = fields.get("id");
                        let mut entry = old_sources
                            .iter()
                            .find_map(|old| {
                                let old = old.as_object()?;
                                (old.get("id") == id).then(|| old.clone())
                            })
                            .unwrap_or_default();
                        for known_key in ["id", "label", "kind", "location"] {
                            entry.remove(known_key);
                        }
                        entry.extend(fields.clone());
                        Value::Object(entry)
                    })
                    .collect();
                map.insert(key.clone(), Value::Array(merged));
            } else {
                map.insert(key.clone(), value.clone());
            }
        }
        map.insert("version".into(), json!(VERSION));
        self.write_document(&map)?;
        Ok(settings)
    }

    fn write_document(&self, map: &Map<String, Value>) -> Result<(), String> {
        let parent = self.path.parent().ok_or("Ruta de ajustes inválida")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temp = parent.join(format!(
            ".config.json.{}.{}.tmp",
            std::process::id(),
            TEMP_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let result = (|| -> Result<(), String> {
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(|e| e.to_string())?;
            let bytes = serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?;
            file.write_all(&bytes)
                .and_then(|()| file.sync_all())
                .map_err(|e| e.to_string())?;
            drop(file);
            fs::rename(&temp, &self.path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }

    pub fn recover(&self) -> Result<Settings, String> {
        match self.document() {
            Err(FileState::Corrupt | FileState::Unreadable) => {}
            _ => return Err("nexo.config.recoveryNotAllowed".into()),
        }
        let original = fs::read(&self.path).map_err(|e| e.to_string())?;
        let backup = self.path.with_file_name("config.json.bak");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(backup)
            .map_err(|e| e.to_string())?;
        file.write_all(&original)
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        let settings = Settings::default();
        let mut map = serde_json::to_value(&settings)
            .map_err(|e| e.to_string())?
            .as_object()
            .cloned()
            .ok_or("Ajustes inválidos")?;
        map.insert("version".into(), json!(VERSION));
        self.write_document(&map)?;
        Ok(settings)
    }
}

#[derive(Default)]
pub struct ConfigLock(Mutex<()>);

fn store_locale(store: &Store) -> crate::i18n::Locale {
    crate::i18n::Locale::from_language(&store.read().settings.language)
}

pub(crate) fn bootstrap_locale(app: &AppHandle) -> crate::i18n::Locale {
    let lock = app.state::<ConfigLock>();
    let Ok(_guard) = lock.0.lock() else {
        return crate::i18n::Locale::Es;
    };
    let Ok(directory) = app.path().app_config_dir() else {
        return crate::i18n::Locale::Es;
    };
    store_locale(&Store::new(directory.join("config.json")))
}

fn store(app: &AppHandle, window: &WebviewWindow) -> Result<Store, String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    Ok(Store::new(
        app.path()
            .app_config_dir()
            .map_err(|e| e.to_string())?
            .join("config.json"),
    ))
}

#[tauri::command]
pub fn get_settings(
    app: AppHandle,
    window: WebviewWindow,
    lock: State<'_, ConfigLock>,
) -> Result<Snapshot, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    Ok(store(&app, &window)?.read())
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    window: WebviewWindow,
    lock: State<'_, ConfigLock>,
    patch: Patch,
) -> Result<Settings, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    store(&app, &window)?.patch(patch)
}

#[tauri::command]
pub fn recover_settings(
    app: AppHandle,
    window: WebviewWindow,
    lock: State<'_, ConfigLock>,
) -> Result<Settings, String> {
    let _guard = lock.0.lock().map_err(|e| e.to_string())?;
    store(&app, &window)?.recover()
}

#[tauri::command]
pub fn quit_after_settings(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Ventana no autorizada".into());
    }
    // Windows must still coordinate the connected applications before exit.
    #[cfg(windows)]
    crate::runtime::handle_menu(&app, "quit");
    #[cfg(not(windows))]
    app.exit(0);
    Ok(())
}

#[cfg(test)]
#[path = "config_tests.rs"]
mod tests;
