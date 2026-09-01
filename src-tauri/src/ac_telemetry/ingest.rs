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

/// Route handler for `/ac-telemetry`.
pub async fn handler(upgrade: WebSocketUpgrade) -> impl IntoResponse {
    upgrade.on_upgrade(pump)
}

async fn pump(mut socket: WebSocket) {
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
    }
}
