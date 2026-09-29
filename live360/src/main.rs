//! Live 360: capture Assetto Corsa's equirectangular (CSP 360 mode) window
//! through the ScreenCast portal and reproject it onto the screens.
//!
//! ```text
//! live360 probe [--pick] [--virtual]
//! live360 view  [--pick] [--screens DP-3,DP-1,DP-2] [--angle A] [--yaw 0] [--pitch 0] [--fov 90]
//! ```
//!
//! `--virtual` captures a virtual monitor (AC moved onto it) instead of the
//! AC window. `--pick` shows the portal's window picker again instead of reusing the
//! saved window. `probe` only measures what arrives; `view` draws it.

mod capture;
mod egl;
mod import;
mod viewer;

use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn number(args: &[String], name: &str, default: f32) -> Result<f32> {
    match flag(args, name) {
        Some(v) => v.parse().with_context(|| format!("{name} {v}")),
        None => Ok(default),
    }
}

/// Reports, once a second, how many frames with content arrived.
fn probe(capture: capture::Capture) -> Result<()> {
    let mut last = Instant::now();
    loop {
        capture.pump(Duration::from_millis(2));
        if let Some(frame) = capture.take_newest() {
            capture.release(frame);
        }
        if last.elapsed() >= Duration::from_secs(1) {
            println!(
                "{:>3} frames/s  {:>3} empty/s  {:?}",
                capture.take_received(),
                capture.take_empty(),
                capture.negotiated()
            );
            last = Instant::now();
        }
    }
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let pick = args.iter().any(|a| a == "--pick");
    let source = if args.iter().any(|a| a == "--virtual") {
        capture::Source::Virtual
    } else {
        capture::Source::Window
    };
    let gpu = egl::Gpu::open()?;
    eprintln!("GPU: {}", gpu.render_node);

    match args.first().map(String::as_str) {
        Some("probe") => probe(capture::Capture::open(pick, source, &gpu)?),
        Some("view") => {
            let options = viewer::Options {
                screens: flag(&args, "--screens")
                    .map(|s| s.split(',').map(str::to_string).collect())
                    .unwrap_or_default(),
                angle: flag(&args, "--angle")
                    .map(|v| v.parse())
                    .transpose()
                    .context("--angle")?,
                view: viewer::View {
                    yaw: number(&args, "--yaw", 0.0)?,
                    pitch: number(&args, "--pitch", 0.0)?,
                    fov: number(&args, "--fov", 90.0)?,
                },
            };
            let capture = capture::Capture::open(pick, source, &gpu)?;
            eprintln!(
                "restore token: {}",
                capture::token_path_for(source).display()
            );
            viewer::run(capture, options)
        }
        _ => bail!(
            "usage: live360 probe|view [--pick] [--screens A,B,C] [--angle D] [--yaw D] [--pitch D] [--fov D]"
        ),
    }
}
