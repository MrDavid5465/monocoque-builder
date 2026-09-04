//! Pushing puppet frames to the in-game Lua app.
//!
//! The mirror image of `ac_telemetry::ingest`: that endpoint receives from
//! the Lua app and acks back periodically. This one sends *to* the Lua app,
//! so the two halves of the socket are driven independently — writing
//! happens whenever `push_frame` is called, not in response to anything
//! arriving. The socket is split so both directions can run concurrently.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// How long to go without any message from the Lua app (its own periodic
/// heartbeat, or anything else) before treating the connection as dead.
///
/// Same reasoning as `ac_telemetry::ingest::ACK_TIMEOUT`: a socket can't be
/// trusted to report its own death on its own — CSP is known not to raise
/// `onError`/`onClose` reliably — so silence from the far end is the only
/// signal actually worth acting on.
const IDLE_TIMEOUT: Duration = Duration::from_secs(6);

/// Route handler for `/ac-puppet`.
pub async fn handler(upgrade: WebSocketUpgrade) -> impl IntoResponse {
    upgrade.on_upgrade(pump)
}

async fn pump(socket: WebSocket) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    {
        let Ok(mut guard) = super::CONNECTION.lock() else {
            return;
        };
        // Replaces any previous connection's sender. That socket's own read
        // loop will notice its sends going nowhere and tear itself down.
        *guard = Some(tx.clone());
    }

    let write_task = tokio::spawn(async move {
        while let Some(message) = rx.recv().await {
            if sink.send(message).await.is_err() {
                break;
            }
        }
    });

    let mut last_seen = Instant::now();
    loop {
        match tokio::time::timeout(IDLE_TIMEOUT, stream.next()).await {
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) => break,
            Ok(Some(Ok(_))) => last_seen = Instant::now(),
            Ok(Some(Err(_))) => break,
            // A single poll timing out isn't itself a dead connection —
            // only silence across the *whole* window is.
            Err(_) if last_seen.elapsed() >= IDLE_TIMEOUT => break,
            Err(_) => {}
        }
    }

    write_task.abort();
    // Only clear the connection if it's still this one: a newer connection
    // that raced in already replaced it, and clearing now would drop that
    // one's sender out from under `push_frame`.
    if let Ok(mut guard) = super::CONNECTION.lock() {
        if guard
            .as_ref()
            .is_some_and(|current| current.same_channel(&tx))
        {
            *guard = None;
        }
    }
}
