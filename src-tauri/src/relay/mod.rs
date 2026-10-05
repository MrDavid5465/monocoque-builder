//! Host/client telemetry relay, so a second PC can run the sim stack from
//! another PC's game.
//!
//! A **host** is an ordinary install: simd writes SIMAPI.DAT and the in-game
//! Lua app streams AC's extended telemetry. It also serves both at `/relay`
//! and advertises itself on the LAN (`discovery`).
//!
//! A **client** (`AppSettings::client_mode`) takes its telemetry from a host
//! instead. It writes the host's SimData bytes into its own SIMAPI.DAT, so
//! monocoque, huenicorn and the dashboards run unchanged, as if simd were
//! local. It stores the host's AC frames where the local Lua app's would go,
//! and drives the local AC's car to match them through `ac_puppet`. simd
//! must not run on a client: it would overwrite the relayed SIMAPI.DAT (see
//! `service_watchdogs::run_simd_watchdog`).

pub mod client;
pub mod discovery;
pub mod host;

use serde::{Deserialize, Serialize};

use crate::ac_telemetry::AcTelemetryFrame;

/// Bumped whenever the wire format changes. A client refuses a host with a
/// different version rather than writing bytes it can't trust into shared
/// memory.
pub const PROTOCOL_VERSION: u32 = 1;

/// The port the API (and so `/relay`) listens on.
pub const API_PORT: u16 = 9000;

/// Text messages on the relay socket. SimData travels separately, as a
/// binary message holding the raw SIMAPI.DAT bytes.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TextMessage {
    /// First message from the host.
    Hello(Hello),
    /// One frame from the host's in-game Lua app.
    Ac(Box<AcTelemetryFrame>),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hello {
    pub protocol: u32,
    /// `size_of::<SimData>()` on the host. Must match the client's, or the
    /// two were built from different SimData layouts.
    pub simdata_size: usize,
    pub host_name: String,
}

/// Last value `client::run` saw, for hot paths that can't read the settings
/// file per call (the Lua ingest runs at 60 Hz).
static CLIENT_MODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// `is_client_mode` as of the relay's last check, at most a few seconds old.
pub fn client_mode_cached() -> bool {
    CLIENT_MODE.load(std::sync::atomic::Ordering::Relaxed)
}

/// Whether this install is currently a client. Read fresh each time, so
/// switching modes in Settings takes effect without a restart.
pub fn is_client_mode() -> bool {
    crate::config_manager::app_config::read_app_config()
        .map(|c| c.settings.client_mode)
        .unwrap_or(false)
}

/// The manually configured host, if any; `None` means discover one.
pub fn host_override() -> Option<String> {
    crate::config_manager::app_config::read_app_config()
        .ok()
        .and_then(|c| c.settings.client_host)
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
}

/// This machine's name, for advertising and for the hello.
pub fn host_name() -> String {
    std::fs::read_to_string("/etc/hostname")
        .ok()
        .map(|h| h.trim().to_string())
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "monocoque-builder".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use axum::Router;
    use futures_util::StreamExt;
    use std::time::Duration;
    use tokio_tungstenite::tungstenite::Message;

    /// Serves the real `/relay` handler on a free local port.
    async fn serve() -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("couldn't bind a test port");
        let addr = listener.local_addr().expect("no local addr");
        let router = Router::new().route("/relay", get(host::handler));
        tokio::spawn(async move {
            axum::serve(listener, router).await.ok();
        });
        addr
    }

    /// A client checks the hello before it writes anything into shared
    /// memory, so the hello has to come first and carry this build's
    /// protocol and SimData size.
    #[test]
    fn host_introduces_itself_first() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let addr = serve().await;
            let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/relay"))
                .await
                .expect("couldn't connect");
            let first = tokio::time::timeout(Duration::from_secs(2), ws.next())
                .await
                .expect("no first message")
                .expect("stream ended")
                .expect("socket error");
            let Message::Text(text) = first else {
                panic!("first message wasn't text: {first:?}")
            };
            let TextMessage::Hello(hello) =
                serde_json::from_str(&text).expect("not a relay message")
            else {
                panic!("first message wasn't the hello: {text}")
            };
            assert_eq!(hello.protocol, PROTOCOL_VERSION);
            assert_eq!(hello.simdata_size, crate::telemetry::SIMDATA_SIZE);
        });
    }

    /// With no sim running the host has nothing to send; the heartbeat is
    /// what keeps an idle client from deciding the host is dead.
    #[test]
    fn idle_host_still_sends_a_heartbeat() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let addr = serve().await;
            let (mut ws, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/relay"))
                .await
                .expect("couldn't connect");
            let got_ping = tokio::time::timeout(Duration::from_secs(3), async {
                while let Some(Ok(message)) = ws.next().await {
                    if matches!(message, Message::Ping(_)) {
                        return true;
                    }
                }
                false
            })
            .await
            .unwrap_or(false);
            assert!(got_ping, "no heartbeat within 3s");
        });
    }

    #[test]
    fn ac_frames_survive_the_wire() {
        let frame = AcTelemetryFrame {
            pos_x: 12.5,
            compass: 270.0,
            headlights_active: true,
            ..Default::default()
        };
        let json = serde_json::to_string(&TextMessage::Ac(Box::new(frame))).unwrap();
        let TextMessage::Ac(back) = serde_json::from_str(&json).unwrap() else {
            panic!("decoded as the wrong message: {json}")
        };
        assert_eq!(back.pos_x, 12.5);
        assert_eq!(back.compass, 270.0);
        assert!(back.headlights_active);
    }

    /// The size check is what stops a client from writing a host's bytes
    /// into shared memory when the two builds disagree on SimData's layout.
    #[test]
    fn simdata_of_the_wrong_size_is_refused() {
        use crate::telemetry::{simdata_from_bytes, SIMDATA_SIZE};
        assert!(simdata_from_bytes(&vec![0; SIMDATA_SIZE]).is_some());
        assert!(simdata_from_bytes(&vec![0; SIMDATA_SIZE - 1]).is_none());
        assert!(simdata_from_bytes(&vec![0; SIMDATA_SIZE + 1]).is_none());
    }
}
