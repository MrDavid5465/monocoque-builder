//! Sending commands *into* a running Assetto Corsa session.
//!
//! The capture pipeline drives the game by writing `job.ini` and launching it,
//! which works but costs a full restart per change. This is the live channel:
//! the Lua telemetry app already holds a websocket to this process, and that
//! socket was always bidirectional — the backend has been sending `"ok"` down
//! it once a second as a liveness ack, and the app has had an `onMessage`
//! handler receiving and discarding it since the beginning. Only the payload
//! semantics were missing.
//!
//! Commands therefore need no new connection, no new port, and no file
//! polling. They ride the existing socket and go out on the next inbound
//! frame, so at the app's 60Hz send rate the latency is about 16ms rather than
//! the 1s the ack interval would impose.
//!
//! The point of this is verification. Changing the day/night band or the
//! capture's placement currently means asking a human to load a session, scrub
//! a clock and describe what they saw — which is slow, and the reports are
//! necessarily qualitative. With a command channel the same checks become
//! "set the clock to 22:50, read the elevation back, screenshot it", which is
//! the same shape as driving a browser under `playwright-verify`.
//!
//! Safety, which matters because the telemetry app stays installed during
//! ordinary play: the game only ever acts on an explicit command. There is no
//! standing behaviour, nothing is queued at startup, and an empty queue sends
//! nothing at all. Same discipline as the capture app's `job.ini`.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;

/// Commands waiting to go out on the next inbound frame.
///
/// A queue rather than a single slot so a caller can stage a short sequence
/// ("place the car, set the time, screenshot") without waiting for each to
/// round-trip.
static PENDING: Mutex<VecDeque<Command>> = Mutex::new(VecDeque::new());

/// Results the game has reported, newest last. Bounded — this is a debugging
/// aid, not a durable log, and an unbounded one would grow for the life of the
/// process.
static RESULTS: Mutex<Vec<CommandResult>> = Mutex::new(Vec::new());
const MAX_RESULTS: usize = 64;

/// One instruction for the game.
///
/// `args` is deliberately free-form JSON rather than a typed enum per command:
/// the Lua side dispatches on `cmd` and reads whichever keys it needs, so
/// adding a command is a change in one place (the app) instead of three.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    pub id: String,
    pub cmd: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

/// What the game said about a command it ran.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub id: String,
    pub ok: bool,
    pub message: String,
}

/// Queues a command. Returns its id, which the result will carry back.
pub fn queue(cmd: &str, args: serde_json::Value) -> String {
    let id = uuid::Uuid::new_v4().to_string();
    if let Ok(mut guard) = PENDING.lock() {
        guard.push_back(Command {
            id: id.clone(),
            cmd: cmd.to_string(),
            args,
        });
    }
    id
}

/// Takes the next command to send, if any. Called from the ingest loop.
pub fn take_next() -> Option<Command> {
    PENDING.lock().ok()?.pop_front()
}

/// Records a result reported by the game.
pub fn record_result(result: CommandResult) {
    if let Ok(mut guard) = RESULTS.lock() {
        guard.push(result);
        let len = guard.len();
        if len > MAX_RESULTS {
            guard.drain(0..len - MAX_RESULTS);
        }
    }
}

/// The result for a given command id, once the game has reported it.
pub fn result_for(id: &str) -> Option<CommandResult> {
    let guard = RESULTS.lock().ok()?;
    guard.iter().rev().find(|r| r.id == id).cloned()
}

/// Every result still held, oldest first.
pub fn recent_results() -> Vec<CommandResult> {
    RESULTS.lock().map(|g| g.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queued_commands_come_back_in_order() {
        while take_next().is_some() {}
        let a = queue("ping", serde_json::json!({}));
        let b = queue("set_time", serde_json::json!({ "hours": 13 }));

        let first = take_next().expect("first command");
        let second = take_next().expect("second command");
        assert_eq!(first.id, a);
        assert_eq!(second.id, b);
        assert_eq!(second.cmd, "set_time");
        assert_eq!(second.args["hours"], 13);
        assert!(take_next().is_none(), "queue should now be empty");
    }

    /// Results are looked up by id, because commands can complete out of order
    /// and a caller only cares about its own.
    #[test]
    fn results_are_found_by_id_and_bounded() {
        record_result(CommandResult {
            id: "wanted".into(),
            ok: true,
            message: "done".into(),
        });
        assert_eq!(result_for("wanted").map(|r| r.message), Some("done".into()));
        assert!(result_for("never-queued").is_none());

        for i in 0..MAX_RESULTS + 10 {
            record_result(CommandResult {
                id: format!("flood-{i}"),
                ok: true,
                message: String::new(),
            });
        }
        assert!(
            recent_results().len() <= MAX_RESULTS,
            "result history must stay bounded"
        );
        // The oldest entries are the ones dropped.
        assert!(result_for("wanted").is_none());
        assert!(result_for(&format!("flood-{}", MAX_RESULTS + 9)).is_some());
    }
}
