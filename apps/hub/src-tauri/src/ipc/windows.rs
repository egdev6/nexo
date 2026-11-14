use super::Hub;
use nexo_protocol::pipe_name;
use std::{ffi::c_void, io, ptr};
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::{
        Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1},
        SECURITY_ATTRIBUTES,
    },
    UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW},
};

struct Descriptor(*mut c_void);
impl Drop for Descriptor {
    fn drop(&mut self) {
        // SAFETY: the descriptor was allocated by the Windows conversion function.
        unsafe { LocalFree(self.0) };
    }
}

fn bind(name: &str, sid: &str, first: bool) -> io::Result<NamedPipeServer> {
    let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})\0").encode_utf16().collect();
    let mut raw = ptr::null_mut();
    // SAFETY: sddl is NUL terminated and raw points to writable storage.
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut raw,
            ptr::null_mut(),
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    let descriptor = Descriptor(raw);
    let mut attrs = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: 0,
    };
    // SAFETY: attrs and its descriptor remain valid for the duration of creation.
    unsafe {
        ServerOptions::new()
            .first_pipe_instance(first)
            .max_instances(254)
            .create_with_security_attributes_raw(
                name,
                (&mut attrs as *mut SECURITY_ATTRIBUTES).cast(),
            )
    }
}

pub(crate) fn report_startup_error(error: &io::Error) {
    let message: Vec<u16> = format!("No se pudo iniciar la comunicación de Nexo: {error}\0")
        .encode_utf16()
        .collect();
    let title: Vec<u16> = "Nexo\0".encode_utf16().collect();
    // SAFETY: both strings are NUL terminated and live until the dialog returns.
    unsafe {
        MessageBoxW(
            ptr::null_mut(),
            message.as_ptr(),
            title.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

pub(crate) struct Listener {
    name: String,
    sid: String,
    server: NamedPipeServer,
}

impl Listener {
    pub(crate) fn acquire() -> io::Result<Self> {
        let sid = tauri_plugin_nexo::current_user_sid()?;
        let name = pipe_name(&sid);
        let server = bind(&name, &sid, true)
            .map_err(|error| io::Error::new(error.kind(), format!("cannot own {name}: {error}")))?;
        Ok(Self { name, sid, server })
    }

    pub(crate) async fn run(mut self, hub: Hub) {
        let mut shutdown = hub.shutdown.subscribe();
        if *shutdown.borrow() {
            return;
        }
        loop {
            tokio::select! {
                _ = shutdown.changed() => return,
                result = self.server.connect() => {
                    if let Err(error) = result {
                        eprintln!("Nexo pipe connection failed: {error}");
                        hub.shutdown();
                        hub.set_notice("La conexión de Nexo se cerró inesperadamente.".into(), false);
                        return;
                    }
                    let next = match bind(&self.name, &self.sid, false) {
                        Ok(next) => next,
                        Err(error) => {
                            eprintln!("Nexo pipe listener stopped: {error}");
                            hub.shutdown();
                            hub.set_notice("La conexión de Nexo se cerró inesperadamente.".into(), false);
                            return;
                        }
                    };
                    let client = std::mem::replace(&mut self.server, next);
                    let client_hub = hub.clone();
                    tokio::spawn(async move { client_hub.serve(client).await; });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Listener, bind};
    use crate::ipc::Hub;
    use nexo_protocol::{
        AppInfo, Capability, MenuItem, Message, QuitReason, VersionRange, decode, encode,
    };
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::windows::named_pipe::ClientOptions,
    };

    #[tokio::test]
    async fn listener_serves_two_simultaneous_sessions_and_stops() {
        let sid = tauri_plugin_nexo::current_user_sid().unwrap();
        let name = format!(r"\\.\pipe\nexo-test-hub-{}-multiple", std::process::id());
        let server = bind(&name, &sid, true).unwrap();
        let listener = Listener {
            name: name.clone(),
            sid,
            server,
        };
        let hub = Hub::new();
        let worker = hub.clone();
        let task = tokio::spawn(async move {
            listener.run(worker).await;
        });
        let mut first = ClientOptions::new().open(&name).unwrap();
        first
            .write_all(
                encode(
                    1,
                    &Message::Hello {
                        protocol: VersionRange { min: 1, max: 1 },
                    },
                )
                .unwrap()
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut first = BufReader::new(first);
        let mut line = String::new();
        first.read_line(&mut line).await.unwrap();
        assert!(matches!(decode(&line, 1).unwrap(), Message::Welcome { .. }));
        // The first accepted connection does not prevent another instance from accepting.
        let mut second = ClientOptions::new().open(&name).unwrap();
        second
            .write_all(
                encode(
                    1,
                    &Message::Hello {
                        protocol: VersionRange { min: 1, max: 1 },
                    },
                )
                .unwrap()
                .as_bytes(),
            )
            .await
            .unwrap();
        let mut second = BufReader::new(second);
        line.clear();
        second.read_line(&mut line).await.unwrap();
        assert!(matches!(decode(&line, 1).unwrap(), Message::Welcome { .. }));
        hub.shutdown();
        task.await.unwrap();
        line.clear();
        assert_eq!(first.read_line(&mut line).await.unwrap(), 0);
        assert_eq!(second.read_line(&mut line).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn isolated_pipe_rejects_second_owner_and_serves_a_full_session() {
        let sid = tauri_plugin_nexo::current_user_sid().unwrap();
        let name = format!(r"\\.\pipe\nexo-test-hub-{}-ownership", std::process::id());
        let server = bind(&name, &sid, true).expect("first owner should bind");
        assert!(bind(&name, &sid, true).is_err(), "second owner must fail");
        let hub = Hub::new();
        let worker = hub.clone();
        let task = tokio::spawn(async move {
            server.connect().await.unwrap();
            worker.serve(server).await;
        });
        let client = ClientOptions::new().open(&name).unwrap();
        let (reader, mut writer) = tokio::io::split(client);
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        writer
            .write_all(
                encode(
                    1,
                    &Message::Hello {
                        protocol: VersionRange { min: 1, max: 1 },
                    },
                )
                .unwrap()
                .as_bytes(),
            )
            .await
            .unwrap();
        reader.read_line(&mut line).await.unwrap();
        assert!(matches!(
            decode(&line, 1).unwrap(),
            Message::Welcome { unified: true, .. }
        ));
        line.clear();
        writer
            .write_all(
                encode(
                    1,
                    &Message::Register {
                        app: AppInfo {
                            id: "alpha".into(),
                            name: "Alpha".into(),
                            version: "1.0.0".into(),
                        },
                        capabilities: vec![Capability::Show, Capability::Quit, Capability::Menu],
                    },
                )
                .unwrap()
                .as_bytes(),
            )
            .await
            .unwrap();
        reader.read_line(&mut line).await.unwrap();
        assert_eq!(decode(&line, 1).unwrap(), Message::Registered);
        line.clear();
        let items = vec![MenuItem {
            id: "capture".into(),
            label: "Capturar".into(),
            enabled: true,
            checked: None,
        }];
        writer
            .write_all(
                encode(
                    1,
                    &Message::Menu {
                        items: items.clone(),
                    },
                )
                .unwrap()
                .as_bytes(),
            )
            .await
            .unwrap();
        writer
            .write_all(
                encode(1, &Message::Heartbeat { seq: 42 })
                    .unwrap()
                    .as_bytes(),
            )
            .await
            .unwrap();
        reader.read_line(&mut line).await.unwrap();
        assert_eq!(decode(&line, 1).unwrap(), Message::HeartbeatAck { seq: 42 });
        let entry = hub.snapshot().apps[0].clone();
        assert_eq!(entry.menu, items);
        assert!(hub.action("alpha", entry.generation, entry.menu_revision, "capture"));
        line.clear();
        reader.read_line(&mut line).await.unwrap();
        assert_eq!(
            decode(&line, 1).unwrap(),
            Message::Action {
                item_id: "capture".into()
            }
        );
        assert!(hub.show("alpha", entry.generation));
        line.clear();
        reader.read_line(&mut line).await.unwrap();
        assert_eq!(decode(&line, 1).unwrap(), Message::Show);
        assert!(hub.set_unified("alpha", entry.generation, false));
        line.clear();
        reader.read_line(&mut line).await.unwrap();
        assert_eq!(decode(&line, 1).unwrap(), Message::Unified { value: false });
        let quitter = hub.clone();
        let quit = tokio::spawn(async move { quitter.quit("alpha", entry.generation).await });
        line.clear();
        reader.read_line(&mut line).await.unwrap();
        let Message::Quit {
            id,
            reason: QuitReason::User,
        } = decode(&line, 1).unwrap()
        else {
            panic!("expected user quit");
        };
        writer
            .write_all(
                encode(
                    1,
                    &Message::QuitResult {
                        id,
                        accepted: true,
                        reason: None,
                    },
                )
                .unwrap()
                .as_bytes(),
            )
            .await
            .unwrap();
        assert_eq!(quit.await.unwrap(), crate::ipc::QuitOutcome::Accepted);
        writer
            .write_all(encode(1, &Message::Bye).unwrap().as_bytes())
            .await
            .unwrap();
        task.await.unwrap();
        assert!(hub.snapshot().apps.is_empty());
    }
}
