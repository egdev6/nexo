use crate::ipc::Snapshot;
use nexo_protocol::Capability;

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

pub(crate) fn compose(snapshot: &Snapshot) -> Vec<Section> {
    snapshot
        .apps
        .iter()
        .map(|entry| {
            let app = entry.app.id.clone();
            let generation = entry.generation;
            let mut items = vec![Item {
                label: "Unificar bandeja".into(),
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
                    label: "Abrir".into(),
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
                    label: "Cerrar".into(),
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
                    format!("{} · Sin respuesta", entry.app.name)
                },
                items,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{Command, compose};
    use crate::ipc::{AppSnapshot, Snapshot};
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
    fn separate_submenus_preserve_checks_capabilities_and_identity() {
        let mut beta = app("beta", false);
        beta.responsive = false;
        beta.capabilities.push(Capability::Quit);
        let snapshot = Snapshot {
            revision: 1,
            apps: vec![app("alpha", true), beta],
            notice: None,
        };
        let sections = compose(&snapshot);
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
            !compose(&empty)[0]
                .items
                .iter()
                .any(|item| item.label == "Pausar")
        );
    }
}
