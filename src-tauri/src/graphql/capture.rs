//! GraphQL surface for automated 360° photo capture.
//!
//! Starting a capture launches Assetto Corsa, drives it through a day and a
//! night shot, and quits — minutes of work, most of it just waiting for a
//! game to load. So the mutation *starts* a capture and returns; it doesn't
//! hold the request open for the whole run. Progress is read back from
//! `carCaptureStatus`.

use crate::ac_capture::{self, CaptureConfig};
use crate::typiql_types::Car;
use async_graphql::{Context, Object, Result as GqlResult, SimpleObject};
use base64::prelude::*;

/// What the capture pipeline is doing, and how the last run ended.
#[derive(SimpleObject, Clone, Default)]
pub struct CarCaptureStatus {
    pub running: bool,
    /// Car being captured right now, if any.
    pub car_id: Option<String>,
    /// Human-readable step, e.g. "Launching Assetto Corsa".
    pub stage: String,
    /// Why the last run failed. A capture outlives the request that started
    /// it, so a failure has nowhere to be returned to and is reported here
    /// instead.
    pub last_error: Option<String>,
    /// Car whose capture last succeeded — the cue to refetch its photos.
    pub last_completed_car_id: Option<String>,
}

/// One car installed in Assetto Corsa, for the capture picker.
#[derive(SimpleObject, Clone)]
pub struct AcCarOption {
    /// AC's own folder id — the same domain as `Car.carIds`.
    pub id: String,
    pub name: String,
    pub brand: Option<String>,
}

/// Whether capture can run here at all, plus what there is to capture.
///
/// Bundled into one query because the frontend needs both together: without
/// Assetto Corsa there's nothing to pick from and no point offering the
/// feature, so the UI hides rather than presenting a button that can only
/// fail.
#[derive(SimpleObject, Default)]
pub struct AcCaptureSupport {
    /// Whether an Assetto Corsa install was found.
    pub available: bool,
    /// Why not, when it wasn't — worth showing rather than silently hiding,
    /// since "launch the game once" is a fixable cause.
    pub reason: Option<String>,
    pub install_path: Option<String>,
    /// Installed cars, empty when unavailable.
    pub cars: Vec<AcCarOption>,
}

/// Everything the Game Config settings panel checks, in one query.
///
/// One request rather than several because the panel shows them together and
/// they share the same path resolution — asking separately would repeat that
/// work and let the rows disagree with each other mid-refresh.
#[derive(SimpleObject, Default)]
pub struct GameConfig {
    /// Resolved Assetto Corsa install, if one was found.
    pub install_path: Option<String>,
    /// Whether that path was auto-detected rather than configured by hand.
    pub install_detected: bool,
    /// Whether Custom Shaders Patch is present. Everything this app does
    /// inside the game is CSP Lua, so without it neither capture nor the
    /// telemetry app can work at all.
    pub csp_installed: bool,
    /// Whether the extended-telemetry Lua app is installed in the game.
    pub telemetry_app_installed: bool,
    /// The game's current Steam launch options, verbatim.
    pub launch_options: Option<String>,
    /// Whether those launch options set `SIMD_BRIDGE_EXE`, which is what
    /// simd's automatic bridging needs — it reads the variable from the
    /// *game's* environment, so it has to be set where Steam starts the game.
    pub bridge_configured: bool,
    /// Launch options with the bridge variable added, ready to paste into
    /// Steam. Offered as text rather than written directly: Steam keeps this
    /// config in memory and rewrites the file on exit, so an edit made while
    /// it's running is silently discarded.
    pub recommended_launch_options: Option<String>,
}

/// Variable simd reads from the game's environment to find its bridge.
const BRIDGE_ENV: &str = "SIMD_BRIDGE_EXE";

/// Where simshmbridge's AC bridge usually lands.
const DEFAULT_BRIDGE_EXE: &str = "~/.local/share/simracing/simshmbridge/assets/acbridge.exe";

#[derive(Default)]
pub struct CarCaptureQuery;

#[Object]
impl CarCaptureQuery {
    /// State of the Assetto Corsa integration, for the Game Config settings.
    async fn game_config(&self) -> GameConfig {
        let Ok(paths) = ac_capture::paths::CapturePaths::resolve(None, None) else {
            return GameConfig::default();
        };

        let launch_options = ac_capture::paths::steam_launch_options(ac_capture::AC_STEAM_APP_ID);
        let bridge_configured = launch_options.as_deref().is_some_and(|options| {
            ac_capture::paths::env_assignments(options)
                .iter()
                .any(|(key, _)| key == BRIDGE_ENV)
        });

        // Built by prepending the assignment to whatever is already there,
        // so a user's other variables and any wrapper survive rather than
        // being replaced by a canned string.
        let recommended = (!bridge_configured).then(|| {
            let existing = launch_options.as_deref().unwrap_or("%command%").trim();
            let existing = if existing.is_empty() {
                "%command%"
            } else {
                existing
            };
            format!("{BRIDGE_ENV}={DEFAULT_BRIDGE_EXE} {existing}")
        });

        GameConfig {
            install_path: Some(paths.install_dir.display().to_string()),
            install_detected: true,
            csp_installed: paths.install_dir.join("extension").is_dir(),
            telemetry_app_installed: crate::ac_telemetry::install::is_installed(&paths),
            launch_options,
            bridge_configured,
            recommended_launch_options: recommended,
        }
    }

    /// Whether 360° capture is usable here, and which cars are installed.
    ///
    /// Also backfills `KnownCar` with anything installed that isn't already
    /// there. That list previously only grew when a car was seen in
    /// telemetry — you had to drive something before you could configure it
    /// — so folding the install scan into it means every owned car becomes
    /// selectable. A query with a write in it is unusual, but it's an
    /// idempotent upsert and matches `syncCarPhotos`, which already repairs
    /// File records on read.
    async fn ac_capture_support(&self, ctx: &Context<'_>) -> GqlResult<AcCaptureSupport> {
        let paths = match ac_capture::paths::CapturePaths::resolve(None, None) {
            Ok(paths) => paths,
            Err(reason) => {
                return Ok(AcCaptureSupport {
                    available: false,
                    reason: Some(reason),
                    ..Default::default()
                })
            }
        };

        let cars = ac_capture::content::installed_cars(&paths.install_dir);
        if cars.is_empty() {
            return Ok(AcCaptureSupport {
                available: false,
                reason: Some(format!(
                    "No cars found under {}/content/cars.",
                    paths.install_dir.display()
                )),
                install_path: Some(paths.install_dir.display().to_string()),
                ..Default::default()
            });
        }

        let adapter = crate::graphql::default_adapter(ctx)?;
        for car in &cars {
            if adapter
                .get_one("known_cars".into(), "id", &car.id)
                .await
                .is_none()
            {
                // Same shape as ClientsMutation::register_car, which is how
                // telemetry-discovered cars get here.
                let _ = adapter
                    .add(
                        "known_cars".into(),
                        "id",
                        serde_json::json!({ "id": car.id, "name": car.id }),
                    )
                    .await;
            }
        }

        Ok(AcCaptureSupport {
            available: true,
            reason: None,
            install_path: Some(paths.install_dir.display().to_string()),
            cars: cars
                .into_iter()
                .map(|car| AcCarOption {
                    id: car.id,
                    name: car.name,
                    brand: car.brand,
                })
                .collect(),
        })
    }

    /// Current capture progress.
    ///
    /// A plain query the frontend polls only while a capture is running,
    /// rather than a subscription. This app has already had mutations hang
    /// because too many always-open subscriptions exhausted the browser's
    /// ~6-connections-per-origin limit (see `shaker_updates`' own doc
    /// comment); a poll that exists only for the few minutes a capture takes
    /// avoids adding another permanent connection for a rarely-used feature.
    async fn car_capture_status(&self) -> CarCaptureStatus {
        let progress = ac_capture::progress();
        CarCaptureStatus {
            running: progress.running,
            car_id: progress.car_id,
            stage: progress.stage,
            last_error: progress.last_error,
            last_completed_car_id: progress.last_completed_car_id,
        }
    }
}

#[derive(Default)]
pub struct CarCaptureMutation;

#[Object]
impl CarCaptureMutation {
    /// Starts capturing this car's day and night 360° photos.
    ///
    /// Returns as soon as the run is under way. Both photos are written
    /// straight onto the Car when it finishes, through the same
    /// `set_car_photo` path a manual upload uses.
    ///
    /// `track_id` is optional: with nothing given, the car is shot wherever
    /// `race.ini` currently points, which is guaranteed to be installed.
    async fn capture_car_photos_360(
        &self,
        ctx: &Context<'_>,
        id: String,
        track_id: Option<String>,
    ) -> GqlResult<bool> {
        if ac_capture::is_running() {
            return Err(async_graphql::Error::new(
                "A 360° capture is already running.",
            ));
        }

        let adapter = crate::graphql::default_adapter(ctx)?;
        let car: Car = adapter
            .get_one("cars".into(), "id", &id)
            .await
            .ok_or_else(|| async_graphql::Error::new("Car not found"))
            .and_then(|value| {
                serde_json::from_value(value).map_err(|e| async_graphql::Error::new(e.to_string()))
            })?;

        // The explicitly chosen car wins; otherwise fall back to the first
        // raw id this record stands for, which is correct whenever it maps
        // to a single car (see `Car::capture_car_id`).
        let existing_ids: Vec<String> =
            serde_json::from_str::<Vec<String>>(&car.car_ids).unwrap_or_default();
        let ac_car_id = car
            .capture_car_id
            .clone()
            .filter(|value| !value.is_empty())
            .or_else(|| existing_ids.iter().find(|value| !value.is_empty()).cloned())
            .ok_or_else(|| {
                async_graphql::Error::new(
                    "No Assetto Corsa car selected for this record, and no game car ID to \
                     fall back on. Pick one before capturing.",
                )
            })?;

        // Capturing a car is a statement that this record represents it, so
        // make that true rather than leaving the association implicit: the
        // photos are about to be filed here.
        if !existing_ids.iter().any(|id| id == &ac_car_id) {
            let mut ids = existing_ids.clone();
            ids.push(ac_car_id.clone());
            let updated = adapter
                .update(
                    "cars".into(),
                    "id",
                    &car.id,
                    serde_json::json!({ "car_ids": serde_json::to_string(&ids).unwrap_or_default() }),
                )
                .await;
            // The photos this capture files are announced by `set_car_photo`,
            // but this registration was not — so a car list open elsewhere
            // kept showing the old id set, and per-registration pan lookups
            // (which key off car_ids) missed the id that was just added.
            if let Some(updated) =
                updated.and_then(|v| serde_json::from_value::<crate::typiql_types::Car>(v).ok())
            {
                typiql::TypiQLBroker::publish(crate::typiql_types::CarChanged {
                    operation_name: "update".to_string(),
                    value: updated,
                });
            }
        }
        if adapter
            .get_one("known_cars".into(), "id", &ac_car_id)
            .await
            .is_none()
        {
            let _ = adapter
                .add(
                    "known_cars".into(),
                    "id",
                    serde_json::json!({ "id": ac_car_id, "name": ac_car_id }),
                )
                .await;
        }

        let paths = ac_capture::paths::CapturePaths::resolve(None, None)
            .map_err(async_graphql::Error::new)?;

        let mut config = CaptureConfig::new(ac_car_id, String::new());
        match track_id.filter(|value| !value.is_empty()) {
            Some(track) => config.track_id = track,
            None => {
                let (track, layout) =
                    ac_capture::preflight::current_track(&paths).ok_or_else(|| {
                        async_graphql::Error::new(
                            "Couldn't work out which track to use. Launch Assetto Corsa once, \
                             or pass a track explicitly.",
                        )
                    })?;
                config.track_id = track;
                config.track_layout = layout;
            }
        }

        ac_capture::begin(&car.id);

        // Detached on purpose: the run outlives this request by minutes.
        // The adapter is an Arc, so the task keeps its own handle to the
        // store and can write the photos itself when the capture lands.
        let car_record_id = car.id.clone();
        tokio::spawn(async move {
            let outcome = run_and_store(&adapter, &car_record_id, &config).await;
            ac_capture::finish_progress(&car_record_id, outcome);
        });

        Ok(true)
    }
}

/// Runs a capture and files the resulting images against the Car.
async fn run_and_store(
    adapter: &std::sync::Arc<dyn typiql::TypiQLAdapter>,
    car_record_id: &str,
    config: &CaptureConfig,
) -> Result<(), String> {
    let images = ac_capture::run(config, None, None).await?;

    // Re-encoded to base64 to go through `set_car_photo`, the same entry
    // point the manual upload uses. Round-tripping the bytes is a little
    // wasteful, but it keeps one storage path for car photos rather than a
    // second one that could drift from it.
    for (slot, bytes) in [("day", images.day), ("night", images.night)] {
        let filename = format!("{car_record_id}-{slot}.png");
        let data = BASE64_STANDARD.encode(&bytes);
        crate::graphql::car::set_car_photo(adapter, car_record_id, slot, &filename, &data)
            .await
            .map_err(|err| format!("Couldn't save the {slot} photo: {}", err.message))?;
    }

    Ok(())
}
