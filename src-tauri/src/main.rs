// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// async-graphql's MergedObject/MergedSubscription derives expand recursively
// per merged type — adding File pushed the schema's type count past rustc's
// default query recursion limit (128).
#![recursion_limit = "256"]
mod api;
mod config_manager;
mod device_enumeration;
mod gamepad;
mod graphql;
mod host_command;
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
                    tokio::spawn(gamepad::run_watchdog());
                    tokio::spawn(huenicorn::run_sim_watcher());
                    tokio::spawn(huenicorn::run_color_poller());
                    tokio::spawn(service_watchdogs::run_simd_watchdog());
                    tokio::spawn(service_watchdogs::run_monocoque_watchdog());

                    let app = api::build_router().await;

                    println!("Starting API on http://0.0.0.0:9000");
                    // Same reasoning as the DuckDB open in api.rs: a port
                    // already in use means another copy is running, and
                    // unwrapping here killed only this task -- leaving a
                    // window whose UI could only report "connection refused".
                    let listener = match tokio::net::TcpListener::bind("0.0.0.0:9000").await {
                        Ok(listener) => listener,
                        Err(e) => {
                            eprintln!(
                                "Could not bind 0.0.0.0:9000: {e}\n\
                                 typiql is probably already running. Close the other \
                                 window and start again."
                            );
                            std::process::exit(1);
                        }
                    };

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
