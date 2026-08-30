use evdev::{
    uinput::VirtualDeviceBuilder, AbsInfo, AbsoluteAxisType, AttributeSet, EventType, InputEvent,
    Key, UinputAbsSetup,
};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

// The 0x130..0x13E block ("BTN_GAMEPAD_BASE.." in Linux's input-event-codes)
// contains 15 codes, but only 13 of them are buttons any standard Xbox-style
// controller actually has (A/B/X/Y, LB/RB/LT/RT-as-button, Back/Start/Guide,
// L3/R3) — SDL's and every desktop's gamepad-tester UI draw exactly those 13
// named slots and nothing else. The other two codes in that range,
// BTN_C (0x132) and BTN_Z (0x135), are leftover SNES/Genesis-pad buttons no
// modern controller emits and no standard tester UI has a slot for — a
// button mapped onto one of those fires correctly at the kernel level but is
// invisible in every "press a button" testing UI. Confirmed live: index 5
// under the old naive `BTN_GAMEPAD_BASE + index` walk landed on BTN_Z and
// silently never lit up in the system controller tester, while index 0
// (BTN_SOUTH, "A") worked and was visibly recognized.
//
// Fix: walk only the 13 real named buttons in order, then continue into
// BTN_TRIGGER_HAPPY1.. (0x2c0, the standard "extra gamepad button" range)
// for any index beyond that — same fallback as before, just starting after
// 13 real buttons instead of naively counting through all 15 raw codes.
//
// Continuing raw codes past 0x13E entirely (to 0x140+) would also be wrong
// for an unrelated reason — that's BTN_TOOL_PEN/BTN_TOUCH/etc, the
// digitizer/tablet range, which makes udev misclassify the whole device as
// ID_INPUT_TABLET instead of ID_INPUT_JOYSTICK (hiding it from games
// entirely) — already avoided by stopping at 13/going straight to
// BTN_TRIGGER_HAPPY1, never touching 0x13F+.
const REAL_GAMEPAD_BUTTONS: [u16; 13] = [
    0x130, // BTN_SOUTH (A)
    0x131, // BTN_EAST  (B)
    0x133, // BTN_NORTH (X)
    0x134, // BTN_WEST  (Y)
    0x136, // BTN_TL    (LB)
    0x137, // BTN_TR    (RB)
    0x138, // BTN_TL2   (LT as button)
    0x139, // BTN_TR2   (RT as button)
    0x13a, // BTN_SELECT (Back)
    0x13b, // BTN_START
    0x13c, // BTN_MODE  (Guide)
    0x13d, // BTN_THUMBL (L3)
    0x13e, // BTN_THUMBR (R3)
];
const BTN_TRIGGER_HAPPY_BASE: u16 = 0x2c0;
const BUTTON_COUNT: u16 = 32;

fn button_key_code(index: u16) -> u16 {
    match REAL_GAMEPAD_BUTTONS.get(index as usize) {
        Some(&code) => code,
        None => BTN_TRIGGER_HAPPY_BASE + (index - REAL_GAMEPAD_BUTTONS.len() as u16),
    }
}

const AXES: [AbsoluteAxisType; 6] = [
    AbsoluteAxisType::ABS_X,
    AbsoluteAxisType::ABS_Y,
    AbsoluteAxisType::ABS_Z,
    AbsoluteAxisType::ABS_RX,
    AbsoluteAxisType::ABS_RY,
    AbsoluteAxisType::ABS_RZ,
];

static DEVICE: Mutex<Option<evdev::uinput::VirtualDevice>> = Mutex::new(None);

fn ensure_device(
    guard: &mut std::sync::MutexGuard<Option<evdev::uinput::VirtualDevice>>,
) -> Result<(), String> {
    if guard.is_some() {
        return Ok(());
    }

    let mut keys = AttributeSet::<Key>::new();
    for i in 0u16..BUTTON_COUNT {
        keys.insert(Key::new(button_key_code(i)));
    }

    let axis_info = AbsInfo::new(0, -32767, 32767, 16, 128, 0);

    let mut builder = VirtualDeviceBuilder::new()
        .map_err(|e| e.to_string())?
        .name("DDController")
        .with_keys(&keys)
        .map_err(|e| e.to_string())?;

    for &axis in &AXES {
        builder = builder
            .with_absolute_axis(&UinputAbsSetup::new(axis, axis_info))
            .map_err(|e| e.to_string())?;
    }

    let device = builder.build().map_err(|e| e.to_string())?;
    **guard = Some(device);
    Ok(())
}

const UDEV_RULE_PATH: &str = "/etc/udev/rules.d/99-dashboard-gamepad.rules";
const UDEV_RULE: &str = "KERNEL==\"uinput\", GROUP=\"input\", MODE=\"0660\", TAG+=\"uaccess\"\n";

/// Whether this process can actually create a virtual gamepad.
///
/// Tests the capability, not the artifact. Checking only for our own rule
/// file reports "missing" on a machine where `/dev/uinput` is already
/// writable through some other grant — most commonly a `uaccess` ACL from
/// systemd-logind, which shows up as the `+` in `crw-rw----+` and grants the
/// logged-in user `rw` directly. Confirmed live on this machine: no rule
/// file at all, yet `getfacl /dev/uinput` lists `user:david:rw-` and opening
/// it for writing succeeds. Reporting "rule not found" there sends the user
/// to install something they demonstrably don't need.
///
/// Falls back to the file check so the answer stays sensible when the device
/// node is absent entirely (no uinput module loaded) but the rule is staged
/// for the next boot.
///
/// Exposed as the `gamepadUdevStatus` GraphQL query (graphql/mod.rs), not a
/// Tauri command — everything else in this app goes through typiql, and a
/// Tauri command is unanswerable from the browser build.
pub fn gamepad_udev_status() -> bool {
    if std::fs::OpenOptions::new()
        .write(true)
        .open("/dev/uinput")
        .is_ok()
    {
        return true;
    }

    std::fs::read_to_string(UDEV_RULE_PATH)
        .map(|c| c.contains("uinput"))
        .unwrap_or(false)
}

/// Writes the udev rule via pkexec (prompts for auth) and reloads udev.
/// Returns "already-installed", "installed", or an error string.
/// Exposed as the `setupGamepadUdev` GraphQL mutation (graphql/gamepad.rs).
pub fn setup_gamepad_udev() -> Result<String, String> {
    if gamepad_udev_status() {
        return Ok("already-installed".to_string());
    }

    // Write rule to a temp file first (no privileges needed), then use
    // pkexec to install it and reload udev — single auth prompt.
    let tmp = "/tmp/99-dashboard-gamepad.rules";
    std::fs::write(tmp, UDEV_RULE).map_err(|e| e.to_string())?;

    let status = crate::host_command::host_command("pkexec")
        .args([
            "sh",
            "-c",
            &format!(
                "cp {tmp} {dst} && udevadm control --reload-rules && udevadm trigger",
                tmp = tmp,
                dst = UDEV_RULE_PATH,
            ),
        ])
        .status()
        .map_err(|e| format!("Failed to launch pkexec: {e}"))?;

    if status.success() {
        Ok("installed".to_string())
    } else {
        Err(format!(
            "pkexec exited with code {}",
            status.code().unwrap_or(-1)
        ))
    }
}

fn emit_button(button_index: u8, pressed: bool) -> Result<(), String> {
    let mut guard = DEVICE.lock().map_err(|e| e.to_string())?;
    ensure_device(&mut guard)?;
    if let Some(device) = guard.as_mut() {
        let event = InputEvent::new(
            EventType::KEY,
            button_key_code(button_index as u16),
            if pressed { 1 } else { 0 },
        );
        device.emit(&[event]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Reached only via the GraphQL resolvers in graphql/gamepad.rs, over HTTP —
// not a Tauri command. A dashboard rendered in a plain browser (e.g. an
// actual tablet's browser hitting this app's own web server) has no access
// to Tauri's native IPC bridge at all, only whatever this process serves
// over the network, so button/axis input has to go through the GraphQL
// mutation the same way every other write in this app already does.
//
// `watchdog: true` registers this button as "currently held" — the caller
// (Canvas.tsx's momentary button-control) must keep re-sending
// `pressed: true, watchdog: true` roughly every 200ms for as long as the
// button is actually held. If those heartbeats stop arriving (dropped
// connection, closed tab, crashed browser) `run_watchdog` below force-
// releases the button after `WATCHDOG_TIMEOUT` — otherwise a lost "release"
// network call could leave something like a horn or a highbeam-flash on
// forever, a failure mode that couldn't happen with the previous in-process
// Tauri-invoke design. Toggle-mode presses and the encoder's brief
// self-timed pulses pass `watchdog: false` — they aren't "held" in a way
// that a lost heartbeat could get stuck on, so there's nothing to babysit.
pub fn set_button(button_index: u8, pressed: bool, watchdog: bool) -> Result<(), String> {
    emit_button(button_index, pressed)?;
    let mut wd = WATCHDOG.lock().map_err(|e| e.to_string())?;
    if pressed && watchdog {
        wd.insert(button_index, Instant::now());
    } else {
        wd.remove(&button_index);
    }
    Ok(())
}

pub fn set_axis(axis_index: u8, value: f32) -> Result<(), String> {
    let mut guard = DEVICE.lock().map_err(|e| e.to_string())?;
    ensure_device(&mut guard)?;
    if let (Some(device), Some(&axis_type)) = (guard.as_mut(), AXES.get(axis_index as usize)) {
        let raw = (value.clamp(-1.0, 1.0) * 32767.0) as i32;
        let event = InputEvent::new(EventType::ABSOLUTE, axis_type.0, raw);
        device.emit(&[event]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// index → last-heartbeat time, for buttons currently held with watchdog
// protection on. Axes have no on/off state to get stuck in, so they're
// never tracked here — see the `set_button` doc comment above.
static WATCHDOG: LazyLock<Mutex<HashMap<u8, Instant>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

const WATCHDOG_TIMEOUT: Duration = Duration::from_millis(600);
const WATCHDOG_POLL_INTERVAL: Duration = Duration::from_millis(150);

/// Runs forever; spawn once at startup (see main.rs). Force-releases any
/// watchdog-protected button whose last heartbeat is older than
/// `WATCHDOG_TIMEOUT`.
pub async fn run_watchdog() {
    loop {
        tokio::time::sleep(WATCHDOG_POLL_INTERVAL).await;
        let stale: Vec<u8> = {
            let wd = WATCHDOG.lock().unwrap();
            wd.iter()
                .filter(|(_, &last)| last.elapsed() > WATCHDOG_TIMEOUT)
                .map(|(&idx, _)| idx)
                .collect()
        };
        for idx in stale {
            eprintln!("gamepad watchdog: force-releasing stale button {idx} (no heartbeat within {WATCHDOG_TIMEOUT:?})");
            let _ = emit_button(idx, false);
            WATCHDOG.lock().unwrap().remove(&idx);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual diagnostic, not part of the normal test suite (creates a real
    /// system-wide uinput device). Run with:
    ///   cargo test --bin typiql gamepad::tests::manual_create_and_press -- --ignored --nocapture
    /// then check `cat /proc/bus/input/devices` in another shell for "DDController"
    /// while this process is still alive (it sleeps 10s at the end so the
    /// device stays registered long enough to inspect).
    #[test]
    #[ignore]
    fn manual_create_and_press() {
        set_button(5, true, false).expect("press should succeed");
        std::thread::sleep(std::time::Duration::from_millis(100));
        set_button(5, false, false).expect("release should succeed");
        println!("device created + button 5 pressed/released; sleeping 10s for inspection");
        std::thread::sleep(std::time::Duration::from_secs(10));
    }

    /// Confirms a watchdog-tracked press with no follow-up heartbeat gets
    /// force-released by `run_watchdog` within `WATCHDOG_TIMEOUT`. Run with:
    ///   cargo test --bin typiql gamepad::tests::manual_watchdog_releases_stale_button -- --ignored --nocapture
    #[test]
    #[ignore]
    fn manual_watchdog_releases_stale_button() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            set_button(6, true, true).expect("watchdog-tracked press should succeed");
            assert!(
                WATCHDOG.lock().unwrap().contains_key(&6),
                "button should be tracked immediately after a watchdog press"
            );

            let handle = tokio::spawn(run_watchdog());
            tokio::time::sleep(WATCHDOG_TIMEOUT + WATCHDOG_POLL_INTERVAL * 2).await;
            handle.abort();

            assert!(
                !WATCHDOG.lock().unwrap().contains_key(&6),
                "watchdog should have force-released the stale button"
            );
            println!(
                "watchdog correctly force-released button 6 after {:?} of silence",
                WATCHDOG_TIMEOUT
            );
        });
    }

    /// Reads the device's own advertised key-capability set back via evdev
    /// and prints it in ascending raw-code order — the same order Linux's
    /// joydev compatibility layer (and therefore any DirectInput/raw-
    /// joystick binding screen, which is what racing sims use) assigns
    /// sequential "Button N" numbers in. Confirms our `button_key_code`
    /// index scheme lines up with what a real binding screen will actually
    /// number things, independent of whether any code has a friendly
    /// Xbox-style name. Run with:
    ///   cargo test --bin typiql gamepad::tests::manual_dump_button_capabilities -- --ignored --nocapture
    #[test]
    #[ignore]
    fn manual_dump_button_capabilities() {
        for i in 0..BUTTON_COUNT as u8 {
            set_button(i, true, false).unwrap();
            set_button(i, false, false).unwrap();
        }
        std::thread::sleep(std::time::Duration::from_secs(1));

        println!("--- /proc/bus/input/devices around DDController ---");
        if let Ok(procdump) = std::fs::read_to_string("/proc/bus/input/devices") {
            if let Some(idx) = procdump.find("DDController") {
                let start = procdump[..idx].rfind("\n\n").map(|p| p + 2).unwrap_or(0);
                let end = procdump[idx..]
                    .find("\n\n")
                    .map(|p| idx + p)
                    .unwrap_or(procdump.len());
                println!("{}", &procdump[start..end]);
            } else {
                println!("(no DDController entry found in /proc/bus/input/devices at all)");
            }
        }

        let devices: Vec<_> = evdev::enumerate().collect();
        println!(
            "evdev::enumerate() found {} openable device(s):",
            devices.len()
        );
        for (path, d) in &devices {
            println!("  {} -> {:?}", path.display(), d.name());
        }
        let (_, dev) = devices
            .into_iter()
            .find(|(_, d)| d.name() == Some("DDController"))
            .expect("DDController device should be discoverable via evdev::enumerate()");

        let mut codes: Vec<u16> = dev
            .supported_keys()
            .expect("device should report supported keys")
            .iter()
            .map(|k| k.code())
            .collect();
        codes.sort_unstable();

        println!("DDController advertises {} button codes, ascending order (= js/DirectInput button numbering):", codes.len());
        for (js_index, &code) in codes.iter().enumerate() {
            let our_index = (0..BUTTON_COUNT).find(|&i| button_key_code(i) == code);
            println!(
                "  js button {js_index}: raw code 0x{code:03x} <- our index {:?}",
                our_index
            );
        }

        assert_eq!(
            codes.len(),
            BUTTON_COUNT as usize,
            "should advertise exactly BUTTON_COUNT distinct button codes"
        );
        for (js_index, &code) in codes.iter().enumerate() {
            assert_eq!(button_key_code(js_index as u16), code, "js button {js_index} should be our index {js_index}'s code — ascending order must match our index scheme 1:1");
        }
        println!(
            "Confirmed: js/DirectInput button N == our index N for all {} buttons.",
            BUTTON_COUNT
        );
    }
}
