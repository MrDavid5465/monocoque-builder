//! Receiving telemetry frames from the in-game Lua app.
//!
//! A WebSocket rather than repeated POSTs: frames arrive at 30–60Hz, and one
//! long-lived connection avoids paying request setup on every one of them.
//! CSP's Lua API provides `web.socket`, so the game can open this directly.
//!
//! Deliberately not part of the GraphQL schema. The producer is a Lua script
//! with no GraphQL client, and making it speak the `graphql-ws` subprotocol
//! by hand would be a lot of fragile work for no benefit — this endpoint
//! takes a JSON object per message and nothing else. What the *frontend*
//! subscribes to is still GraphQL (see `graphql/ac_telemetry.rs`), fed from
//! the same in-process state this writes to.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use std::time::{Duration, Instant};

/// How often to acknowledge frames back to the sender.
///
/// Acks exist because the sender cannot otherwise tell that this end has gone
/// away. Observed directly: after a backend restart the in-game app carried on
/// "sending" more than ten thousand frames into a closed socket, reporting no
/// error — CSP raised neither `onError` nor `onClose`, so its own `reconnect`
/// never triggered either. An application-level round trip is the only signal
/// that actually proves the far end is listening.
///
/// Rate-limited rather than one-per-frame: at 60Hz that would double the
/// message count to say something that only needs saying occasionally.
const ACK_INTERVAL: Duration = Duration::from_secs(1);

/// Route handler for `/ac-telemetry`.
pub async fn handler(upgrade: WebSocketUpgrade) -> impl IntoResponse {
    upgrade.on_upgrade(pump)
}

async fn pump(mut socket: WebSocket) {
    let mut last_ack: Option<Instant> = None;

    while let Some(Ok(message)) = socket.recv().await {
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Binary(bytes) => match String::from_utf8(bytes.to_vec()) {
                Ok(text) => text,
                Err(_) => continue,
            },
            Message::Close(_) => break,
            // Ping/Pong are handled by axum itself.
            _ => continue,
        };

        // A frame that doesn't parse is dropped rather than closing the
        // connection: this is a lossy live signal, and one malformed message
        // during e.g. a session change shouldn't cost the whole stream.
        match serde_json::from_str::<super::AcTelemetryFrame>(&text) {
            Ok(frame) => super::store(frame),
            Err(err) => eprintln!("ac-telemetry: ignoring malformed frame: {err}"),
        }

        // Acknowledged after storing, so an ack means "your frame landed",
        // not merely "something is listening".
        if last_ack.is_none_or(|at| at.elapsed() >= ACK_INTERVAL) {
            last_ack = Some(Instant::now());
            // A failed send is this connection ending; the sender will notice
            // the acks stopping and rebuild it.
            if socket.send(Message::Text("ok".into())).await.is_err() {
                break;
            }
        }
    }
}
