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

#[derive(Default)]
pub struct CarCaptureQuery;

#[Object]
impl CarCaptureQuery {
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
            let _ = adapter
                .update(
                    "cars".into(),
                    "id",
                    &car.id,
                    serde_json::json!({ "car_ids": serde_json::to_string(&ids).unwrap_or_default() }),
                )
                .await;
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
