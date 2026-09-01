// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// async-graphql's MergedObject/MergedSubscription derives expand recursively
// per merged type — adding File pushed the schema's type count past rustc's
// default query recursion limit (128).
#![recursion_limit = "256"]
mod ac_capture;
mod ac_telemetry;
mod api;
mod config_manager;
mod device_enumeration;
mod gamepad;
mod graphql;
mod huenicorn;
mod night_state;
mod pipewire_dsp;
mod process_liveness;
mod service_commands;
mod service_watchdogs;
mod sun_position;
mod telemetry;
mod typiql_types;

use axum::serve;
use std::net::SocketAddr;
use tokio::runtime::Runtime;
fn main() {
    std::panic::set_hook(Box::new(|info| {
        let bt = std::backtrace::Backtrace::capture();
        eprintln!("BACKEND PANIC: {info}\n{bt}");
    }));

    tauri::Builder::default()
        .setup(|_app| {
            std::thread::spawn(|| {
                let rt = Runtime::new().unwrap();
                rt.block_on(async {
                    // A 360° capture temporarily swaps out Assetto Corsa's
                    // display mode, upscaling and session settings. If a run
                    // died before it could put them back (crash, power cut,
                    // killed process), the journal it left behind is replayed
                    // here — otherwise the user would find their sim stuck in
                    // 360° mode with upscaling off and no clear way back.
                    match ac_capture::restore_pending_config() {
                        Ok(true) => {
                            println!("Restored Assetto Corsa settings left over from an interrupted 360° capture")
                        }
                        Ok(false) => {}
                        Err(e) => eprintln!("Could not restore Assetto Corsa settings: {e}"),
                    }

                    tokio::spawn(gamepad::run_watchdog());
                    tokio::spawn(huenicorn::run_sim_watcher());
                    tokio::spawn(huenicorn::run_color_poller());
                    tokio::spawn(service_watchdogs::run_simd_watchdog());
                    tokio::spawn(service_watchdogs::run_monocoque_watchdog());

                    let app = api::build_router().await;

                    println!("Starting API on http://0.0.0.0:9000");
                    let listener = tokio::net::TcpListener::bind("0.0.0.0:9000").await.unwrap();

                    if let Err(e) = serve(
                        listener,
                        app.into_make_service_with_connect_info::<SocketAddr>(),
                    )
                    .await
                    {
                        eprintln!("Axum serve error: {e:?}");
                    }
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
