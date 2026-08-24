use async_graphql::SimpleObject;
use nusb::MaybeFuture;
use serde::Serialize;
use std::fs;

/// One connected USB device, for the Shift Lights "Device ID" picker (and
/// any other future USB devid field) — monocoque's own devid format for USB
/// Tachometer devices is `"VVVV:PPPP"`, uppercase hex, no `0x` prefix (see
/// the example config's `devid = "98FD:83AC"`), so `devid` here is
/// pre-formatted to match exactly rather than leaving the frontend to
/// reformat vid/pid itself.
#[derive(Debug, Clone, Serialize, SimpleObject)]
pub struct UsbDeviceInfo {
    pub devid: String,
    pub vid: String,
    pub pid: String,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
}

pub fn list_usb_devices() -> Result<Vec<UsbDeviceInfo>, String> {
    let devices = nusb::list_devices()
        .wait()
        .map_err(|e| format!("failed to enumerate USB devices: {e}"))?;

    let mut out: Vec<UsbDeviceInfo> = devices
        .map(|d| {
            let vid = format!("{:04X}", d.vendor_id());
            let pid = format!("{:04X}", d.product_id());
            UsbDeviceInfo {
                devid: format!("{vid}:{pid}"),
                vid,
                pid,
                manufacturer: d.manufacturer_string().map(str::to_owned),
                product: d.product_string().map(str::to_owned),
                serial: d.serial_number().map(str::to_owned),
            }
        })
        .collect();
    out.sort_by(|a, b| a.devid.cmp(&b.devid));
    Ok(out)
}

/// One connected serial device, for the Shift Lights/LED Controllers/
/// SimWind "Device Path" pickers — monocoque's Serial devices (Moza wheels,
/// Simleds, SimWind) are identified by a `devpath` like `/dev/ttyACM0`, not
/// a devid, so this returns the resolved tty path plus a human-readable
/// label rather than mirroring UsbDeviceInfo's shape.
#[derive(Debug, Clone, Serialize, SimpleObject)]
pub struct SerialDeviceInfo {
    pub devpath: String,
    pub label: String,
}

/// Equivalent to `ls -la /dev/serial/by-id/` — that directory (populated by
/// udev on any Linux system with serial ACM/USB devices attached) maps a
/// human-readable, stable-across-replug name straight to the real tty node
/// (`/dev/ttyACM0` etc.), which is exactly what a user manually running that
/// command to find their wheel's devpath would read off — this just does it
/// in-process instead of shelling out, and falls back to a bare `/dev/tty{ACM,USB}*`
/// scan (unlabeled, but still usable) on the rare system where udev hasn't
/// populated by-id yet.
pub fn list_serial_devices() -> Vec<SerialDeviceInfo> {
    let mut out = Vec::new();

    if let Ok(entries) = fs::read_dir("/dev/serial/by-id") {
        for entry in entries.flatten() {
            let label = entry.file_name().to_string_lossy().into_owned();
            let devpath = fs::canonicalize(entry.path())
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| entry.path().to_string_lossy().into_owned());
            out.push(SerialDeviceInfo { devpath, label });
        }
    }

    if out.is_empty() {
        if let Ok(entries) = fs::read_dir("/dev") {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with("ttyACM") || name.starts_with("ttyUSB") {
                    out.push(SerialDeviceInfo {
                        devpath: format!("/dev/{name}"),
                        label: name,
                    });
                }
            }
        }
    }

    out.sort_by(|a, b| a.devpath.cmp(&b.devpath));
    out
}
