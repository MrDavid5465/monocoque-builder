//! Client-mode status for the Settings screen (see `relay`).

use async_graphql::{Object, SimpleObject};

/// What the relay client is doing right now.
#[derive(SimpleObject)]
pub struct RelayStatus {
    /// Whether this install is set to client mode.
    pub client_mode: bool,
    /// The host connected to, or being tried: "name (address:port)" once
    /// connected, "address:port" before.
    pub host: Option<String>,
    pub connected: bool,
    /// Milliseconds since the last frame from the host. Large while the
    /// host's sim is idle; only the heartbeat arrives then.
    pub last_frame_age_ms: Option<f64>,
    /// Why the last attempt failed, if it did.
    pub error: Option<String>,
}

#[derive(Default)]
pub struct RelayQuery;

#[Object]
impl RelayQuery {
    async fn relay_status(&self) -> RelayStatus {
        let status = crate::relay::client::status();
        RelayStatus {
            client_mode: status.client_mode || crate::relay::client_mode_cached(),
            host: status.host,
            connected: status.connected,
            last_frame_age_ms: crate::relay::client::last_frame_age_ms(),
            error: status.error,
        }
    }
}
