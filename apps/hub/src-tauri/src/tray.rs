use crate::{
    i18n::{Locale, text},
    ipc::{Hub, Snapshot},
};
use nexo_protocol::Capability;
use std::fmt::Display;

// Keep the native check item in sync with the authoritative registry.
pub(crate) fn restore_toggle<E: Display>(
    hub: &Hub,
    id: &str,
    generation: u64,
    value: bool,
    rebuild: impl FnOnce() -> Result<Snapshot, E>,
    restore_check: impl FnOnce(),
) {
    if !hub.set_unified(id, generation, value)
        && let Err(error) = rebuild()
    {
        eprintln!("could not restore Nexo tray state; retaining previous menu: {error}");
        restore_check();
    }
}

pub(crate) fn restore_action<E: Display>(
    hub: &Hub,
    id: &str,
    generation: u64,
    revision: u64,
    item: &str,
    rebuild: impl FnOnce() -> Result<Snapshot, E>,
    restore_check: impl FnOnce(),
) {
    hub.action(id, generation, revision, item);
    if let Err(error) = rebuild() {
        eprintln!("could not restore Nexo tray state; retaining previous menu: {error}");
        restore_check();
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Command {
    Toggle {
        app: String,
        generation: u64,
        value: bool,
    },
    Show {
        app: String,
        generation: u64,
    },
    Quit {
        app: String,
        generation: u64,
    },
    Action {
        app: String,
        generation: u64,
        revision: u64,
        item: String,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Item {
    pub label: String,
    pub enabled: bool,
    pub checked: Option<bool>,
    pub command: Command,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Section {
    pub label: String,
    pub items: Vec<Item>,
}

pub(crate) fn compose(snapshot: &Snapshot, locale: Locale) -> Vec<Section> {
    snapshot
        .apps
        .iter()
        .map(|entry| {
            let app = entry.app.id.clone();
            let generation = entry.generation;
            let mut items = vec![Item {
                label: text(locale, "unify").into(),
                enabled: true,
                checked: Some(entry.unified),
                command: Command::Toggle {
                    app: app.clone(),
                    generation,
                    value: !entry.unified,
                },
            }];
            if entry.capabilities.contains(&Capability::Show) {
                items.push(Item {
                    label: text(locale, "show").into(),
                    enabled: true,
                    checked: None,
                    command: Command::Show {
                        app: app.clone(),
                        generation,
                    },
                });
            }
            if entry.capabilities.contains(&Capability::Quit) {
                items.push(Item {
                    label: text(locale, "close").into(),
                    enabled: true,
                    checked: None,
                    command: Command::Quit {
                        app: app.clone(),
                        generation,
                    },
                });
            }
            if entry.capabilities.contains(&Capability::Menu) {
                items.extend(entry.menu.iter().map(|item| Item {
                    label: item.label.clone(),
                    enabled: item.enabled,
                    checked: item.checked,
                    command: Command::Action {
                        app: app.clone(),
                        generation,
                        revision: entry.menu_revision,
                        item: item.id.clone(),
                    },
                }));
            }
            Section {
                label: if entry.responsive {
                    entry.app.name.clone()
                } else {
                    format!("{} · {}", entry.app.name, text(locale, "unresponsive"))
                },
                items,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{Command, compose};
    use crate::{
        i18n::Locale,
        ipc::{AppSnapshot, Snapshot},
    };
    use nexo_protocol::{AppInfo, Capability, MenuItem};

    fn app(id: &str, unified: bool) -> AppSnapshot {
        AppSnapshot {
            app: AppInfo {
                id: id.into(),
                name: id.into(),
                version: "1.0.0".into(),
            },
            capabilities: vec![Capability::Show, Capability::Menu],
            menu: vec![MenuItem {
                id: "same".into(),
                label: "Pausar".into(),
                enabled: false,
                checked: Some(true),
            }],
            unified,
            responsive: true,
            generation: 3,
            menu_revision: 4,
        }
    }

    #[test]
    fn english_submenu_preserves_app_labels_and_state() {
        let mut entry = app("beta", false);
        entry.responsive = false;
        entry.capabilities.push(Capability::Quit);
        let snapshot = Snapshot {
            revision: 1,
            apps: vec![entry],
            notice: None,
        };
        let sections = compose(&snapshot, Locale::En);
        assert_eq!(sections[0].label, "beta · Unresponsive");
        assert_eq!(
            sections[0]
                .items
                .iter()
                .map(|item| item.label.as_str())
                .collect::<Vec<_>>(),
            vec!["Unify tray", "Open", "Close", "Pausar"]
        );
        assert_eq!(sections[0].items[0].checked, Some(false));
        assert_eq!(sections[0].items[3].checked, Some(true));
        assert!(!sections[0].items[3].enabled);
    }

    #[test]
    fn separate_submenus_preserve_checks_capabilities_and_identity() {
        let mut beta = app("beta", false);
        beta.responsive = false;
        beta.capabilities.push(Capability::Quit);
        let snapshot = Snapshot {
            revision: 1,
            apps: vec![app("alpha", true), beta],
            notice: None,
        };
        let sections = compose(&snapshot, Locale::Es);
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].label, "alpha");
        assert_eq!(sections[1].label, "beta · Sin respuesta");
        assert_eq!(sections[0].items[0].checked, Some(true));
        assert_eq!(sections[1].items[0].checked, Some(false));
        assert!(
            sections[0]
                .items
                .iter()
                .any(|item| matches!(item.command, Command::Show { .. }))
        );
        assert!(
            !sections[0]
                .items
                .iter()
                .any(|item| matches!(item.command, Command::Quit { .. }))
        );
        assert!(
            sections[1]
                .items
                .iter()
                .any(|item| matches!(item.command, Command::Quit { .. }))
        );
        for (index, id) in ["alpha", "beta"].into_iter().enumerate() {
            let item = sections[index]
                .items
                .iter()
                .find(|item| item.label == "Pausar")
                .unwrap();
            assert!(!item.enabled);
            assert_eq!(item.checked, Some(true));
            assert_eq!(
                item.command,
                Command::Action {
                    app: id.into(),
                    generation: 3,
                    revision: 4,
                    item: "same".into()
                }
            );
        }
        let empty = Snapshot {
            revision: 2,
            apps: vec![AppSnapshot {
                menu: vec![],
                ..snapshot.apps[0].clone()
            }],
            notice: None,
        };
        assert!(
            !compose(&empty, Locale::Es)[0]
                .items
                .iter()
                .any(|item| item.label == "Pausar")
        );
    }
}
