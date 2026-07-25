use super::types::TelemetryFrame;
use super::{build_frame, read_simdata};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

struct ActiveRecording {
    id: String,
    frames: Vec<TelemetryFrame>,
    stop_flag: Arc<AtomicBool>,
}

struct ActivePlayback {
    id: String,
    frames: Vec<TelemetryFrame>,
    started_at: Instant,
    frame_interval: Duration,
}

static RECORDING: LazyLock<Mutex<Option<ActiveRecording>>> = LazyLock::new(|| Mutex::new(None));
static PLAYBACK: LazyLock<Mutex<Option<ActivePlayback>>> = LazyLock::new(|| Mutex::new(None));

pub fn is_recording() -> bool {
    RECORDING.lock().unwrap().is_some()
}

pub fn is_playing() -> bool {
    PLAYBACK.lock().unwrap().is_some()
}

/// The id of the recording currently being captured, if any — lets a
/// client viewing one recording's page tell whether *it* is the one
/// actively recording (vs. some other recording elsewhere), same reasoning
/// as `playing_id` below.
pub fn recording_id() -> Option<String> {
    RECORDING.lock().unwrap().as_ref().map(|r| r.id.clone())
}

/// The id of the recording currently playing, if any. `play()` only ever
/// holds one `ActivePlayback` at a time (a single global `Mutex<Option<_>>`
/// slot, replaced wholesale on every call) — playback is already centrally
/// tracked and mutually exclusive across every client by construction, this
/// just exposes *which* recording that single slot belongs to so a client
/// viewing recording A can tell "something else is playing" from "this is
/// playing" instead of only seeing one global boolean.
pub fn playing_id() -> Option<String> {
    PLAYBACK.lock().unwrap().as_ref().map(|p| p.id.clone())
}

/// Arms a new recording and spawns the background poller that fills it —
/// buffered in memory, never touching disk until `stop()`, since writing the
/// JsonAdapter's file on every tick would mean rewriting the whole (growing)
/// frame array dozens of times a second.
pub fn start(id: String, sample_rate_hz: f32) {
    let stop_flag = Arc::new(AtomicBool::new(false));
    *RECORDING.lock().unwrap() = Some(ActiveRecording {
        id,
        frames: Vec::new(),
        stop_flag: stop_flag.clone(),
    });

    tokio::spawn(async move {
        let mut interval =
            tokio::time::interval(Duration::from_secs_f32(1.0 / sample_rate_hz.max(0.1)));
        while !stop_flag.load(Ordering::Relaxed) {
            interval.tick().await;
            if let Some(d) = read_simdata() {
                let frame = build_frame(d);
                if let Some(rec) = RECORDING.lock().unwrap().as_mut() {
                    rec.frames.push(frame);
                }
            }
        }
    });
}

/// Stops the active recording (if any) and hands back its id and
/// accumulated frames for the caller to persist.
pub fn stop() -> Option<(String, Vec<TelemetryFrame>)> {
    let mut guard = RECORDING.lock().unwrap();
    let rec = guard.take()?;
    rec.stop_flag.store(true, Ordering::Relaxed);
    Some((rec.id, rec.frames))
}

pub fn play(id: String, frames: Vec<TelemetryFrame>, sample_rate_hz: f32) {
    *PLAYBACK.lock().unwrap() = Some(ActivePlayback {
        id,
        frames,
        started_at: Instant::now(),
        frame_interval: Duration::from_secs_f32(1.0 / sample_rate_hz.max(0.1)),
    });
}

pub fn stop_playback() {
    *PLAYBACK.lock().unwrap() = None;
}

/// The frame that should be visible right now, if a playback is active —
/// driven by elapsed wall-clock time rather than an advancing cursor, so
/// every independent subscriber (each poller, each connected client) that
/// calls this at the same moment converges on the same frame without any of
/// them coordinating with each other. `None` once playback runs past the
/// end (also clears the state, so the caller falls back to live data).
pub fn current_playback_frame() -> Option<TelemetryFrame> {
    let mut guard = PLAYBACK.lock().unwrap();
    let pb = guard.as_ref()?;
    let idx = (pb.started_at.elapsed().as_secs_f64() / pb.frame_interval.as_secs_f64()) as usize;
    if idx >= pb.frames.len() {
        *guard = None;
        return None;
    }
    Some(pb.frames[idx].clone())
}
