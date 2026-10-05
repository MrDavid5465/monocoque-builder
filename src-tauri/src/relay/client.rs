//! The client half: takes a host's telemetry and makes this machine behave
//! as if the sim were running locally.

use std::fs::{File, OpenOptions};
use std::os::unix::fs::FileExt;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tokio_tungstenite::tungstenite::Message;

use super::{discovery, TextMessage, API_PORT, PROTOCOL_VERSION};
use crate::ac_puppet::PuppetFrame;
use crate::ac_telemetry::AcTelemetryFrame;
use crate::telemetry::simdata::SimData;
use crate::telemetry::{build_frame, simdata_from_bytes, SIMAPI_PATH, SIMDATA_SIZE};

/// No message at all for this long means the host is gone. The host pings
/// every second (`host::HEARTBEAT`), so a live but idle host never trips it.
const IDLE_TIMEOUT: Duration = Duration::from_secs(4);

/// How long to browse the LAN before reporting that no host was found.
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(5);

/// Pause between attempts, and between mode checks while not a client.
const RETRY: Duration = Duration::from_secs(3);

/// What the client is doing, for the Settings screen.
#[derive(Debug, Clone, Default)]
pub struct Status {
    pub client_mode: bool,
    /// The host connected to (or being tried), as `address:port`.
    pub host: Option<String>,
    pub connected: bool,
    /// Why the last attempt failed, if it did.
    pub error: Option<String>,
}

static STATUS: Mutex<Option<Status>> = Mutex::new(None);
static LAST_FRAME: Mutex<Option<Instant>> = Mutex::new(None);

pub fn status() -> Status {
    STATUS
        .lock()
        .ok()
        .and_then(|s| s.clone())
        .unwrap_or_default()
}

/// Milliseconds since the last frame from the host, while connected.
pub fn last_frame_age_ms() -> Option<f64> {
    let at = (*LAST_FRAME.lock().ok()?)?;
    Some(at.elapsed().as_secs_f64() * 1000.0)
}

fn set_status(status: Status) {
    if let Ok(mut guard) = STATUS.lock() {
        *guard = Some(status);
    }
}

fn touch() {
    if let Ok(mut guard) = LAST_FRAME.lock() {
        *guard = Some(Instant::now());
    }
}

/// `host` or `host:port`, defaulting the port to the API's.
fn with_port(host: &str) -> String {
    if host.contains(':') {
        host.to_string()
    } else {
        format!("{host}:{API_PORT}")
    }
}

/// Runs forever; spawn once at startup. Idles while not a client, and
/// reconnects whenever the host goes away.
pub async fn run() {
    loop {
        let client = super::is_client_mode();
        super::CLIENT_MODE.store(client, std::sync::atomic::Ordering::Relaxed);
        if !client {
            set_status(Status::default());
            tokio::time::sleep(RETRY).await;
            continue;
        }

        let host = match super::host_override() {
            Some(host) => with_port(&host),
            None => {
                set_status(Status {
                    client_mode: true,
                    ..Default::default()
                });
                match discovery::find(DISCOVERY_TIMEOUT).await {
                    Some(host) => host,
                    None => {
                        set_status(Status {
                            client_mode: true,
                            error: Some(
                                "No host found on the LAN. Set its address in Settings if \
                                 discovery can't reach it."
                                    .into(),
                            ),
                            ..Default::default()
                        });
                        tokio::time::sleep(RETRY).await;
                        continue;
                    }
                }
            }
        };

        let failed = |error: String| Status {
            client_mode: true,
            host: Some(host.clone()),
            connected: false,
            error: Some(error),
        };
        match tokio_tungstenite::connect_async(format!("ws://{host}/relay")).await {
            Ok((socket, _)) => {
                let outcome = session(socket, &host).await;
                clear_simdata();
                if let Ok(mut guard) = LAST_FRAME.lock() {
                    *guard = None;
                }
                match outcome {
                    Ok(()) => set_status(Status::default()),
                    Err(e) => {
                        eprintln!("relay: disconnected from {host}: {e}");
                        set_status(failed(e));
                    }
                }
            }
            Err(e) => set_status(failed(format!("Couldn't connect: {e}"))),
        }
        tokio::time::sleep(RETRY).await;
    }
}

/// One connection. `Ok` means it ended because client mode was switched off.
async fn session(
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    host: &str,
) -> Result<(), String> {
    let (_sink, mut stream) = socket.split();

    // The hello comes first; nothing touches shared memory until it checks out.
    let hello = match tokio::time::timeout(IDLE_TIMEOUT, stream.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<TextMessage>(&text).ok(),
        _ => None,
    };
    let Some(TextMessage::Hello(hello)) = hello else {
        return Err("The host didn't introduce itself; is it a monocoque-builder install?".into());
    };
    if hello.protocol != PROTOCOL_VERSION {
        return Err(format!(
            "The host speaks relay protocol {}, this install {PROTOCOL_VERSION}. Update both to the same version.",
            hello.protocol
        ));
    }
    if hello.simdata_size != SIMDATA_SIZE {
        return Err(format!(
            "The host's telemetry layout ({} bytes) doesn't match this install's ({SIMDATA_SIZE}). \
             Update both to the same version.",
            hello.simdata_size
        ));
    }

    let simapi = open_simdata().map_err(|e| format!("Couldn't open {SIMAPI_PATH}: {e}"))?;
    ensure_puppet_installed();
    eprintln!("relay: connected to {} at {host}", hello.host_name);
    set_status(Status {
        client_mode: true,
        host: Some(format!("{} ({host})", hello.host_name)),
        connected: true,
        error: None,
    });

    let mut latest: Option<SimData> = None;
    let mut mode_check = tokio::time::interval(RETRY);
    loop {
        tokio::select! {
            next = tokio::time::timeout(IDLE_TIMEOUT, stream.next()) => {
                let message = match next {
                    Err(_) => return Err("The host stopped responding.".into()),
                    Ok(None) | Ok(Some(Ok(Message::Close(_)))) => return Err("The host closed the connection.".into()),
                    Ok(Some(Err(e))) => return Err(format!("Connection error: {e}")),
                    Ok(Some(Ok(message))) => message,
                };
                match message {
                    Message::Binary(bytes) => {
                        if let Some(simdata) = simdata_from_bytes(&bytes) {
                            simapi
                                .write_all_at(&bytes, 0)
                                .map_err(|e| format!("Couldn't write {SIMAPI_PATH}: {e}"))?;
                            latest = Some(simdata);
                            touch();
                        }
                    }
                    Message::Text(text) => {
                        if let Ok(TextMessage::Ac(frame)) = serde_json::from_str::<TextMessage>(&text) {
                            if let Some(simdata) = latest {
                                crate::ac_puppet::push_frame(&puppet_frame(&frame, simdata));
                            }
                            crate::ac_telemetry::store(*frame);
                            touch();
                        }
                    }
                    // Pings (the heartbeat) are answered by tungstenite and
                    // only need to reset the idle timer, which receiving did.
                    _ => {}
                }
            }
            _ = mode_check.tick() => {
                if !super::is_client_mode() {
                    return Ok(());
                }
            }
        }
    }
}

/// The client's SIMAPI.DAT, created at SimData's size if simd never ran here.
fn open_simdata() -> std::io::Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(SIMAPI_PATH)?;
    if file.metadata()?.len() < SIMDATA_SIZE as u64 {
        file.set_len(SIMDATA_SIZE as u64)?;
    }
    Ok(file)
}

/// Blanks SIMAPI.DAT once the host is gone. Left as it was, monocoque would
/// keep driving the last frame it saw (a shaker held mid-rumble, LEDs stuck
/// at the last RPM). All-zero SimData reads as "no sim running".
fn clear_simdata() {
    if let Ok(file) = OpenOptions::new().write(true).open(SIMAPI_PATH) {
        let _ = file.write_all_at(&vec![0u8; SIMDATA_SIZE], 0);
    }
}

/// Makes sure the local AC has the puppet app, so a session started on this
/// machine follows the host's car. Best-effort: a client without AC still
/// gets telemetry for its dashboards and hardware.
fn ensure_puppet_installed() {
    let Ok(paths) = crate::ac_capture::paths::CapturePaths::resolve(None, None) else {
        return;
    };
    if crate::ac_puppet::install::is_installed(&paths) {
        return;
    }
    if let Err(e) = crate::ac_puppet::install::install(&paths) {
        eprintln!("relay: couldn't install the puppet app into AC: {e}");
    }
}

/// The local car's target state, from the host's two telemetry sources:
/// world position, heading, time and lights from its AC frame, orientation
/// and driver inputs from its SimData.
fn puppet_frame(ac: &AcTelemetryFrame, simdata: SimData) -> PuppetFrame {
    let t = build_frame(simdata);
    PuppetFrame {
        pos_x: ac.pos_x,
        pos_y: ac.pos_y,
        pos_z: ac.pos_z,
        heading: ac.compass as f64,
        pitch: t.pitch,
        roll: t.roll,
        speed: t.speed,
        steering: t.steering,
        gear: t.gear,
        rpm: t.rpm,
        throttle: t.throttle,
        brake: t.brake,
        handbrake: t.handbrake,
        time_total_seconds: ac.time_total_seconds,
        headlights_active: ac.headlights_active,
        high_beams: ac.high_beams,
        brake_lights_active: ac.brake_lights_active,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn puppet_takes_pose_and_lights_from_ac_and_the_rest_from_simdata() {
        let ac = AcTelemetryFrame {
            pos_x: 1.0,
            pos_y: 2.0,
            pos_z: 3.0,
            compass: 90.0,
            time_total_seconds: 43_200.0,
            headlights_active: true,
            brake_lights_active: true,
            ..Default::default()
        };
        let simdata = simdata_from_bytes(&vec![0; SIMDATA_SIZE]).unwrap();
        let expected = build_frame(simdata);
        let frame = puppet_frame(&ac, simdata);

        assert_eq!((frame.pos_x, frame.pos_y, frame.pos_z), (1.0, 2.0, 3.0));
        assert_eq!(frame.heading, 90.0);
        assert_eq!(frame.time_total_seconds, 43_200.0);
        assert!(frame.headlights_active && frame.brake_lights_active && !frame.high_beams);
        assert_eq!(frame.gear, expected.gear);
        assert_eq!(frame.rpm, expected.rpm);
        assert_eq!(frame.pitch, expected.pitch);
    }

    #[test]
    fn bare_host_gets_the_api_port() {
        assert_eq!(with_port("192.168.1.20"), "192.168.1.20:9000");
        assert_eq!(with_port("rig.local:9100"), "rig.local:9100");
    }
}
