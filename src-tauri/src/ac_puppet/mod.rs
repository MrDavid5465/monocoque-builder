//! Real-time car puppeteering.
//!
//! Pushes a stream of car-state frames to a CSP Lua app running in a second,
//! locally-running Assetto Corsa session, which drives its own car to match
//! every tick (`physics.setCarPosition`, wheel/steering state, lights, time
//! of day). The eventual point is a live *rendered* dashboard on a second
//! machine that always shows what a host's car is actually doing, with real
//! interior lighting — as opposed to `ac_capture`'s flat, one-shot 360°
//! photo.
//!
//! This module is deliberately just the primitive: where `PuppetFrame`s come
//! from is not its concern. Today that's a local test harness; eventually
//! it's a host's telemetry relayed over the network. `push_frame` only needs
//! a frame — swapping the source later doesn't touch this module.
//!
//! Structured as the mirror image of `ac_telemetry`: that module is a Lua
//! app pushing data *to* this backend, passive and one-way by design. This
//! one pushes *from* the backend to the Lua app instead, which is exactly
//! the difference `ac_telemetry`'s own doc comment calls out as the reason
//! it stays a separate app rather than growing a mode flag.
//!
//! Nothing in this binary calls `push_frame` yet — that's the host→client
//! network relay, an explicit follow-on rather than part of this pass (see
//! the ac-integration plan). `PuppetFrame`/`push_frame`/`is_connected` are
//! exercised by this module's own test and are otherwise dead until that
//! relay lands and calls in.
#![allow(dead_code)]

pub mod channel;
pub mod install;

use axum::extract::ws::Message;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tokio::sync::mpsc;

/// Folder (and entry-script) name of the Lua app, per CSP's convention.
pub const LUA_APP_NAME: &str = "typiql_puppet";

/// One frame of car state to apply to the puppeted car.
///
/// A combination of two sources that already exist: `telemetry::TelemetryFrame`
/// (cross-sim — orientation and driver inputs) and `ac_telemetry::AcTelemetryFrame`
/// (AC-only — absolute world position, time of day, lights). Neither alone
/// carries a full pose; together they do.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PuppetFrame {
    // ---- Pose ----------------------------------------------------------
    pub pos_x: f32,
    pub pos_y: f32,
    pub pos_z: f32,
    /// Degrees, 0 = north — matches `AcTelemetryFrame::compass`/`TelemetryFrame::heading`.
    pub heading: f64,
    pub pitch: f64,
    pub roll: f64,

    // ---- Car dynamics / driver inputs -----------------------------------
    pub speed: f64,
    /// Normalised steering input, not a wheel angle in degrees.
    pub steering: f64,
    pub gear: i32,
    pub rpm: u32,
    pub throttle: f64,
    pub brake: f64,
    pub handbrake: f64,

    // ---- Time of day and lighting ---------------------------------------
    pub time_total_seconds: f64,
    pub headlights_active: bool,
    pub high_beams: bool,
    pub brake_lights_active: bool,
}

/// Sender for whichever puppet Lua socket is currently connected.
///
/// Only one puppeted game instance is expected at a time; a new connection
/// replaces whatever was here, the same "newest wins" rule `ac_telemetry`
/// implicitly follows by only ever tracking the latest frame.
static CONNECTION: Mutex<Option<mpsc::UnboundedSender<Message>>> = Mutex::new(None);

/// Pushes a frame to the connected puppet app, if any.
///
/// Best-effort and non-blocking: with no app connected this is a no-op,
/// matching `ac_telemetry`'s "additive, absent app just means nothing
/// happens" philosophy. A send failure means the socket is already gone —
/// `channel`'s own teardown clears `CONNECTION`, so there's nothing further
/// to do here.
pub fn push_frame(frame: &PuppetFrame) {
    let Ok(guard) = CONNECTION.lock() else {
        return;
    };
    let Some(sender) = guard.as_ref() else {
        return;
    };
    let Ok(text) = serde_json::to_string(frame) else {
        return;
    };
    let _ = sender.send(Message::Text(text.into()));
}

/// Whether a puppet Lua app is currently connected.
pub fn is_connected() -> bool {
    CONNECTION
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::routing::get;
    use axum::Router;
    use futures_util::StreamExt;
    use std::time::Duration;
    use tokio_tungstenite::tungstenite::Message as WsMessage;

    /// Drives `channel::handler` for real over an actual TCP socket, with a
    /// genuine WebSocket client standing in for the in-game Lua app, and
    /// checks that a frame handed to `push_frame` after connecting actually
    /// arrives on the other end as the expected JSON.
    ///
    /// Exercises the real risk in this module: routing, the `CONNECTION`
    /// mutex, and serialization all have to line up, none of which a test
    /// calling `push_frame` in isolation (with nothing connected) would
    /// catch. Doesn't touch Assetto Corsa or the Lua app at all — full
    /// end-to-end validation of those needs a second running AC session
    /// puppeted for real, which is a manual step (see the plan/PR notes),
    /// not something this test can do.
    #[test]
    fn pushed_frame_reaches_connected_client() {
        tokio::runtime::Runtime::new()
            .expect("couldn't start a runtime")
            .block_on(async {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                    .await
                    .expect("couldn't bind a test port");
                let addr = listener.local_addr().expect("no local addr");

                let router = Router::new().route("/ac-puppet", get(channel::handler));
                tokio::spawn(async move {
                    axum::serve(listener, router).await.ok();
                });

                let (mut ws, _) =
                    tokio_tungstenite::connect_async(format!("ws://{addr}/ac-puppet"))
                        .await
                        .expect("test client couldn't connect");

                // The server registers CONNECTION after the upgrade completes,
                // asynchronously with respect to the client's own connect()
                // returning — poll rather than assume it's already set.
                let deadline = std::time::Instant::now() + Duration::from_secs(2);
                while !is_connected() {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "server never registered the connection"
                    );
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }

                let frame = PuppetFrame {
                    pos_x: 1.0,
                    pos_y: 2.0,
                    pos_z: 3.0,
                    heading: 90.0,
                    speed: 42.0,
                    ..Default::default()
                };
                push_frame(&frame);

                let received = tokio::time::timeout(Duration::from_secs(2), ws.next())
                    .await
                    .expect("timed out waiting for the pushed frame")
                    .expect("socket closed before sending anything")
                    .expect("websocket error");

                let WsMessage::Text(text) = received else {
                    panic!("expected a text frame, got {received:?}");
                };
                let decoded: PuppetFrame =
                    serde_json::from_str(&text).expect("frame didn't decode");
                assert_eq!(decoded.pos_x, 1.0);
                assert_eq!(decoded.pos_y, 2.0);
                assert_eq!(decoded.pos_z, 3.0);
                assert_eq!(decoded.heading, 90.0);
                assert_eq!(decoded.speed, 42.0);
            });
    }
}
