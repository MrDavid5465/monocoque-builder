use crate::config_manager::app_config::read_app_config;
use crate::config_manager::{parser, read_monocoque_config};
use crate::typiql_types::build_typiql_schema;
use axum::{
    extract::Query,
    extract::Request,
    http::StatusCode,
    middleware::{self, Next},
    response::IntoResponse,
    routing::get,
    Router,
};
use http::{header, Method};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use typiql::TypiQLAdapter;
use typiql_adapter_json::JsonAdapter;

/// Uploaded 360° photos always get a fresh timestamped filename rather than
/// being overwritten in place, so a given URL's content never changes —
/// browsers can treat it as fresh indefinitely with no revalidation at all.
/// Without this, the absence of any Cache-Control header leaves clients to
/// heuristic freshness (typically ~10% of the file's age since upload), which
/// for a just-uploaded multi-MB photo is a window of minutes — short enough
/// that it was being fully re-requested on almost every load anyway.
async fn long_cache(request: Request, next: Next) -> axum::response::Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=31536000, immutable"),
    );
    response
}

/// Where the built frontend lives, for the browsers on other devices that load
/// their dashboards over HTTP (the Tauri window itself uses the copy embedded
/// in the binary and never comes here).
///
/// This used to be the relative path "dist", resolved against the working
/// directory, which is only ever right when the app is started from the source
/// tree. In a packaged build it silently isn't: measured in the Flatpak, cwd is
/// /home/david, so every request -- including / -- returned 404 and a browser
/// could not load anything at all. The same is true of any .deb/.rpm/AppImage
/// install launched from a desktop file.
///
/// Looked up next to the executable rather than hardcoded, so /app/bin/typiql
/// finds /app/share/typiql/dist and /usr/bin/typiql finds
/// /usr/share/typiql/dist without either build knowing about the other.
/// TYPIQL_DIST_DIR overrides for anyone with a different layout, and "dist"
/// remains the last resort so running from the source tree behaves as before.
fn frontend_dist_dir() -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("TYPIQL_DIST_DIR") {
        if !dir.is_empty() {
            return std::path::PathBuf::from(dir);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(bin_dir) = exe.parent() {
            let installed = bin_dir.join("../share/typiql/dist");
            if installed.join("index.html").is_file() {
                return installed;
            }
        }
    }

    std::path::PathBuf::from("dist")
}

fn typiql_data_dir() -> std::path::PathBuf {
    let config = read_app_config().unwrap_or_default();
    if let Some(dir) = config.settings.typiql_data_dir {
        let p = expand_tilde(&dir);
        if !dir.is_empty() {
            return p;
        }
    }
    // Fallback: ~/.config/dashboard-designer -- the host's, not the sandbox's.
    //
    // Flatpak redirects XDG_CONFIG_HOME to ~/.var/app/<app-id>/config, so
    // dirs::config_dir() inside one resolves to a private directory that
    // starts out empty. Everything this app owns lives here -- data.json, the
    // DuckDB recordings, the 360 photos, the dashboards -- so the Flatpak
    // build silently ran against a blank database while the real data sat in
    // ~/.config/dashboard-designer. It surfaced as a DuckDB lock error naming
    // the private path outright:
    //   Could not set lock on file ".../.var/app/com.telemetryadmin.app/
    //   config/dashboard-designer/recordings.duckdb"
    // $HOME is not redirected, and the manifest's
    // --filesystem=xdg-config/dashboard-designer:create grant is what makes
    // the real directory visible -- a grant that did nothing until now.
    // Same reasoning, and same shape, as config_manager::monocoque_config_dir().
    if crate::host_command::in_flatpak() {
        if let Some(home) = dirs::home_dir() {
            return home.join(".config").join("dashboard-designer");
        }
    }

    dirs::config_dir()
        .map(|p| p.join("dashboard-designer"))
        .unwrap_or_else(|| std::path::PathBuf::from("data/typiql"))
}

pub async fn build_router() -> Router {
    let data_dir = typiql_data_dir();
    let adapter = JsonAdapter::new(data_dir.clone());
    seed_monocoque_sound_devices(&adapter).await;

    // Re-establishes the DSP filter-chain process if it was left enabled
    // before a backend restart — see resume_shaker_dsp_if_enabled's doc
    // comment. Fire-and-forget: needs its own Arc<dyn TypiQLAdapter> handle
    // (a clone of the same underlying JsonAdapter, not a separate store —
    // JsonAdapter's Clone shares its Arc<RwLock<...>> cache) since the
    // adapter map below only holds `Arc`s, not the original `JsonAdapter`.
    let dsp_resume_adapter: Arc<dyn TypiQLAdapter> = Arc::new(adapter.clone());
    tokio::spawn(crate::graphql::shaker_dsp::resume_shaker_dsp_if_enabled(
        dsp_resume_adapter,
    ));

    // Day/night gamma for the Hue lights. Spawned here rather than in
    // main.rs alongside huenicorn's other permanent loops (run_sim_watcher /
    // run_color_poller) purely because it needs an adapter handle to read
    // the NightMode singleton, and this is where one exists — same reason
    // and same shape as the DSP resume above.
    let gamma_adapter: Arc<dyn TypiQLAdapter> = Arc::new(adapter.clone());
    tokio::spawn(crate::huenicorn::run_gamma_pusher(gamma_adapter));

    // Every hand-written resolver and every existing typiql type stays on
    // "default" (JsonAdapter) — only DuckDB-backed types (currently just
    // RecordingFrame, see typiql_types.rs) opt into "duckdb" via
    // #[typiql_type(adapter = "duckdb")]. See build_typiql_schema, which
    // wires each registered type's DataLoader/CRUD against whichever entry
    // here matches its own T::adapter_name().
    // A lock conflict here means another copy of this app is already running:
    // DuckDB allows a single writer. That used to abort this task alone, which
    // left the window up with no backend behind it and the UI reporting
    // nothing but "connection refused" -- the failure reads as a broken app
    // rather than a second instance. Say which it is, and go, rather than
    // leaving a window that cannot work.
    let duckdb_path = data_dir.join("recordings.duckdb");
    let duckdb_adapter = match typiql_adapter_duckdb::DuckDbAdapter::new(duckdb_path.clone()) {
        Ok(adapter) => adapter,
        Err(e) => {
            eprintln!(
                "Could not open {}: {e}\n\
                 typiql is probably already running -- only one copy at a time can \
                 hold the recordings database. Close the other window and start again.",
                duckdb_path.display()
            );
            std::process::exit(1);
        }
    };
    let mut adapters: typiql::AdapterMap = std::collections::HashMap::new();
    adapters.insert("default", Arc::new(adapter) as Arc<dyn TypiQLAdapter>);
    adapters.insert("duckdb", Arc::new(duckdb_adapter) as Arc<dyn TypiQLAdapter>);

    let typiql_schema = build_typiql_schema(adapters);

    // /360-photos serves per-file symlinks (named by content hash), not the
    // real files directly — see graphql::car::link_photo/car_photo_links_dir.
    let car_photo_links_dir = crate::graphql::car::car_photo_links_dir();
    std::fs::create_dir_all(&car_photo_links_dir).ok();

    let thumbnails_dir = crate::graphql::car::thumbnails_dir();
    std::fs::create_dir_all(&thumbnails_dir).ok();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            header::HeaderName::from_static("x-app-id"),
        ]);

    let router = Router::new()
        .route("/file-proxy", get(file_proxy))
        .route("/list-files", get(list_files))
        .nest(
            "/360-photos",
            Router::new()
                .fallback_service(tower_http::services::ServeDir::new(&car_photo_links_dir))
                .layer(middleware::from_fn(long_cache)),
        )
        // Car-card thumbnails — always a fresh filename per capture (old file is
        // removed before a new one is written), so same long-cache treatment.
        .nest(
            "/thumbnails",
            Router::new()
                .fallback_service(tower_http::services::ServeDir::new(&thumbnails_dir))
                .layer(middleware::from_fn(long_cache)),
        )
        // Serve symlinked dashboard folders — populated by syncDashboardFiles.
        // In dev mode the path lives outside src-tauri/ to avoid triggering Tauri's file watcher.
        //
        // No forced no-cache here (previously present): unlike /360-photos, a sprite
        // *can* be re-uploaded under the same filename and overwrite in place, so a
        // client could in theory serve a briefly-stale cached copy right after a
        // re-upload (a hard refresh always fixes it). That's a narrow, low-frequency
        // edge case, and it was the same forced-revalidation cost that made large
        // default 360° background images (dashboard.photo360File, served from here)
        // effectively unloadable on remote kiosks — the same failure mode already
        // fixed for /360-photos above. ServeDir's default Last-Modified/ETag headers
        // still support correct conditional revalidation.
        .nest(
            "/dash-assets",
            Router::new().fallback_service(tower_http::services::ServeDir::new(
                if cfg!(debug_assertions) {
                    concat!(env!("CARGO_MANIFEST_DIR"), "/../data/dash-assets")
                } else {
                    "data/dash-assets"
                },
            )),
        )
        .nest(
            "/typiql",
            typiql::typiql_router(typiql_schema, "/typiql/graphql"),
        );

    // In dev mode Vite serves the frontend, but the API is on a different port —
    // so browsers on remote machines can't reach relative /dash-sprites/ URLs.
    // Serve them from here instead so the correct hostname is always used.
    #[cfg(debug_assertions)]
    let router = router.nest_service(
        "/dash-sprites",
        tower_http::services::ServeDir::new(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../public/dash-sprites"),
        ),
    );

    #[cfg(not(debug_assertions))]
    let router = {
        let dist = frontend_dist_dir();
        if !dist.join("index.html").is_file() {
            eprintln!(
                "No frontend at {} -- the API will answer but browsers on other \
                 devices will get 404 for every page. Set TYPIQL_DIST_DIR if this \
                 build keeps it somewhere else.",
                dist.display()
            );
        }
        let index = dist.join("index.html");
        router.fallback_service(
            tower_http::services::ServeDir::new(&dist)
                .not_found_service(tower_http::services::ServeFile::new(index)),
        )
    };

    router.layer(cors)
}

#[derive(Deserialize)]
struct FileProxyParams {
    path: String,
}

fn expand_tilde(s: &str) -> std::path::PathBuf {
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return std::path::PathBuf::from(home).join(rest);
        }
    }
    std::path::PathBuf::from(s)
}

/// Serve a local file by absolute path — used to display dashboard sprite images
/// that live in the user's file system rather than the app bundle.
async fn file_proxy(Query(params): Query<FileProxyParams>) -> impl IntoResponse {
    let path = expand_tilde(&params.path);
    let path = path.as_path();
    match std::fs::read(path) {
        Ok(data) => {
            let content_type = match path.extension().and_then(|e| e.to_str()) {
                Some("png") => "image/png",
                Some("jpg") | Some("jpeg") => "image/jpeg",
                Some("webp") => "image/webp",
                Some("svg") => "image/svg+xml",
                Some("gif") => "image/gif",
                _ => "application/octet-stream",
            };
            (StatusCode::OK, [(header::CONTENT_TYPE, content_type)], data).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

/// List image files in a directory — lets the frontend discover sprites in a dash folder.
async fn list_files(Query(params): Query<FileProxyParams>) -> impl IntoResponse {
    const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "svg", "gif"];
    let expanded = expand_tilde(&params.path);
    let dir = expanded.as_path();
    let files: Vec<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let p = e.path();
                    if !p.is_file() {
                        return None;
                    }
                    let ext = p.extension()?.to_str()?.to_lowercase();
                    if !IMAGE_EXTS.contains(&ext.as_str()) {
                        return None;
                    }
                    p.file_name()?.to_str().map(String::from)
                })
                .collect()
        })
        .unwrap_or_default();
    axum::Json(files).into_response()
}

/// One-time import from monocoque.config into the JSON adapter, seeding
/// ShakerChannel + MonocoqueSoundDevice rows from the user's existing
/// hand-written config file. Skipped entirely once any live (profileId ==
/// null) ShakerChannel row exists — the app's own storage is authoritative
/// from that point on, and the real config file is only ever a write target
/// (Export to Config), never read again. Re-running is always safe: it's a
/// no-op the moment there's anything to protect.
async fn seed_monocoque_sound_devices(adapter: &JsonAdapter) {
    let existing = adapter.get_many("shaker_channels".into(), Vec::new()).await;
    // A row counts as live whether `profile_id` is explicitly JSON `null`
    // *or* the key is simply absent — both deserialize to `None` through
    // the real Rust struct (`Option<String>`), but some existing rows in
    // this JSON store only omit the key rather than writing an explicit
    // null. Checking for `Value::is_null()` alone (missing key -> `.get()`
    // returns `None` -> `.map()` short-circuits to `None` ->
    // `.unwrap_or(false)`) silently failed to detect those rows as live,
    // which let this seed step re-run on every backend restart — each time
    // parsing whatever `monocoque.config` happens to contain (observed
    // creating a fresh batch of bogus channels from a stale DSP-mode-
    // exported config on this exact machine).
    let has_live_channel = existing
        .iter()
        .any(|v| v.get("profile_id").map(Value::is_null).unwrap_or(true));
    if has_live_channel {
        return;
    }

    let Ok(text) = read_monocoque_config() else {
        return;
    };

    let mut next_dsp_slot: u8 = 0;
    for (pan, channel) in parser::parse_shaker_channels(&text).into_iter().enumerate() {
        let pan = pan as u8;
        let created = adapter
            .add(
                "shaker_channels".into(),
                "id",
                serde_json::json!({
                    "profile_id": null,
                    "pan": pan,
                    "devid": channel.devid,
                    "channels": channel.channels,
                    "position": channel.position,
                }),
            )
            .await
            .ok();
        let Some(channel_id) = created
            .as_ref()
            .and_then(|v| v.get("id"))
            .and_then(Value::as_str)
        else {
            continue;
        };

        for effect in channel.effects {
            adapter
                .add(
                    "monocoque_sound_devices".into(),
                    "id",
                    serde_json::json!({
                        "device": "Sound",
                        "effect": effect.effect,
                        "channel_id": channel_id,
                        "volume": effect.volume,
                        "modulation": effect.modulation,
                        "frequency": effect.frequency,
                        "frequency_max": effect.frequency_max,
                        "amplitude": effect.amplitude,
                        "amplitude_max": effect.amplitude_max,
                        "profile_id": null,
                        "dsp_slot": next_dsp_slot,
                    }),
                )
                .await
                .ok();
            next_dsp_slot += 1;
        }
    }
}
