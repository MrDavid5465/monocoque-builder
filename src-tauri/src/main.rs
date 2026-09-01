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

    // Runs in the webview before the app's own code. It reports the origin the
    // page actually got -- which decides the API URL the frontend builds from
    // window.location.hostname -- and then reports whether that URL works,
    // straight to the backend's log. 127.0.0.1 is used for the report itself
    // precisely because it cannot depend on the thing being diagnosed.
    // The leading semicolon is load-bearing. This is appended to Tauri's own
    // IPC bootstrap, which ends in `})()`; without a separator JavaScript reads
    // `})()` followed by `(function...` as a *call*, so the IPC init's return
    // value gets invoked and throws at global scope before any app code runs --
    // which looks exactly like the bug being investigated.
    const ORIGIN_DIAG: &str = r#"
      ;(function () {
        var report = function (stage, detail) {
          try {
            new Image().src = "http://127.0.0.1:9000/diag?stage=" + encodeURIComponent(stage) +
              "&href=" + encodeURIComponent(String(location.href)) +
              "&hostname=" + encodeURIComponent(String(location.hostname)) +
              "&detail=" + encodeURIComponent(String(detail));
          } catch (e) {}
        };
        report("origin", "");
        var url = "http://" + window.location.hostname + ":9000/typiql/graphql";
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: "{ simdStatus { running } }" }),
        }).then(function (r) { report("fetch-ok", url + " status=" + r.status); },
                function (e) { report("fetch-failed", url + " error=" + e); });
      })();
    "#;

    tauri::Builder::default()
        .append_invoke_initialization_script(ORIGIN_DIAG)
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
