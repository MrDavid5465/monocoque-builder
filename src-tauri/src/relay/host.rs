//! The host half: `/relay` streams this machine's telemetry to a client.
//!
//! Binary messages are the raw SIMAPI.DAT bytes, sent whenever simd's
//! `mtick` moves. Text messages are the hello and each new frame from the
//! in-game Lua app. Both are polled rather than pushed, because neither
//! source notifies: SIMAPI.DAT is shared memory, and AC frames land in
//! `ac_telemetry`'s store.

use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;

use super::{Hello, TextMessage};
use crate::telemetry::{read_simdata_bytes, SIMDATA_SIZE};

/// How often to look for new data. Faster than any sim's update rate, so a
/// frame waits at most this long; each poll is a map and an 8-byte compare.
const POLL: Duration = Duration::from_millis(4);

/// With no sim running there's nothing to send, and a silent socket looks
/// the same as a dead one from the client's side. A ping this often lets
/// the client tell the two apart (see `client::IDLE_TIMEOUT`).
const HEARTBEAT: Duration = Duration::from_secs(1);

/// Route handler for `/relay`.
pub async fn handler(upgrade: WebSocketUpgrade) -> impl IntoResponse {
    upgrade.on_upgrade(serve)
}

fn text(message: &TextMessage) -> Option<Message> {
    serde_json::to_string(message)
        .ok()
        .map(|s| Message::Text(s.into()))
}

async fn serve(mut socket: WebSocket) {
    let hello = TextMessage::Hello(Hello {
        protocol: super::PROTOCOL_VERSION,
        simdata_size: SIMDATA_SIZE,
        host_name: super::host_name(),
    });
    let Some(hello) = text(&hello) else { return };
    if socket.send(hello).await.is_err() {
        return;
    }
    eprintln!("relay: client connected");

    let mut tick = tokio::time::interval(POLL);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_mtick: Option<u64> = None;
    let mut last_ac: Option<Instant> = None;
    let mut heartbeat = tokio::time::interval(HEARTBEAT);

    loop {
        tokio::select! {
            _ = tick.tick() => {
                if let Some(bytes) = read_simdata_bytes() {
                    // SimData starts with `mtick: u64`, which simd advances on
                    // every write: an unchanged tick is an unchanged frame.
                    let mtick = u64::from_ne_bytes(bytes[..8].try_into().expect("8 bytes"));
                    if last_mtick != Some(mtick) {
                        last_mtick = Some(mtick);
                        if socket.send(Message::Binary(bytes.into())).await.is_err() {
                            break;
                        }
                    }
                }
                if let Some((frame, stamp)) = crate::ac_telemetry::latest_stamped() {
                    if last_ac != Some(stamp) {
                        last_ac = Some(stamp);
                        let Some(message) = text(&TextMessage::Ac(Box::new(frame))) else { continue };
                        if socket.send(message).await.is_err() {
                            break;
                        }
                    }
                }
            }
            _ = heartbeat.tick() => {
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
            incoming = socket.recv() => match incoming {
                // Clients don't send anything meaningful; this arm exists to
                // notice them leaving.
                None | Some(Err(_)) | Some(Ok(Message::Close(_))) => break,
                Some(Ok(_)) => {}
            },
        }
    }
    eprintln!("relay: client disconnected");
}
