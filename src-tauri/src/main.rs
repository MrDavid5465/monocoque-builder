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
mod pipewire_dsp;
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
        .invoke_handler(tauri::generate_handler![
            gamepad::gamepad_udev_status,
            gamepad::setup_gamepad_udev,
        ])
        .setup(|_app| {
            std::thread::spawn(|| {
                let rt = Runtime::new().unwrap();
                rt.block_on(async {
                    tokio::spawn(gamepad::run_watchdog());

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
