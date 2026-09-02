//! Lifetime of the globally-shared "preview car" pin.
//!
//! The pin exists so a car's 360° photo and pan can be previewed on kiosk
//! screens without driving that car (see CarDetail, which sets it, and
//! DashboardDesigner's `effectiveCar`, which honours it while no sim is
//! active). It is one persisted row that every dashboard in the house
//! follows.
//!
//! That reach is the problem this module exists for. The only thing clearing
//! it was a React unmount cleanup in the page that set it — so closing the
//! tab, killing the app, or a crash left every dashboard pinned to a car
//! someone had merely looked at, with no way back except opening that page
//! again and leaving it properly. Observed in practice, days later.
//!
//! Two independent releases, deliberately, because they fail in different
//! ways:
//!
//! * **Expiry** — the viewing page keeps saying it still wants the pin; when
//!   nothing has for `PIN_TTL`, it's dropped. Covers the tab that vanished
//!   while the server kept running, which no server-side lifecycle event can
//!   see.
//! * **Clear on startup** — covers everything else at once, and gives a
//!   deliberate "reset it now" action: restart the app.
//!
//! Both publish `PreviewCarChanged`, so dashboards drop the pin live rather
//! than waiting for a reload.

use crate::typiql_types::{PreviewCar, PreviewCarChanged};
use std::sync::Arc;
use std::time::Duration;
use typiql::{TypiQLAdapter, TypiQLBroker, TypiQLType};

/// How long a pin survives without being re-confirmed.
///
/// Comfortably longer than the client's refresh interval (60s), so an
/// ordinary hiccup — a slow render, a paused tab, a brief network drop —
/// never drops a pin someone is actively using. Short enough that an
/// abandoned one doesn't outlive the sitting it came from.
const PIN_TTL: Duration = Duration::from_secs(15 * 60);

/// How often to look. Cheap: one read of a single-row collection, and a write
/// only on the tick that actually expires something.
const SWEEP_INTERVAL: Duration = Duration::from_secs(30);

fn now_ms() -> f64 {
    crate::graphql::night_clock::now_ms()
}

/// Clears every non-empty pin, whatever its age. Returns how many it cleared.
///
/// Used at startup: a pin cannot meaningfully survive the process that served
/// it, and starting clean is also the manual reset path.
pub async fn clear_all(adapter: &Arc<dyn TypiQLAdapter>) -> usize {
    release(adapter, |_| true).await
}

/// Clears pins older than `PIN_TTL`.
pub async fn clear_expired(adapter: &Arc<dyn TypiQLAdapter>) -> usize {
    let cutoff = now_ms() - PIN_TTL.as_millis() as f64;
    release(adapter, |row| {
        // No timestamp at all means the row predates expiry tracking, so
        // there is nothing to say it's still wanted — treat it as stale
        // rather than as immortal.
        row.touched_at.is_none_or(|touched| touched < cutoff)
    })
    .await
}

async fn release(
    adapter: &Arc<dyn TypiQLAdapter>,
    should_release: impl Fn(&PreviewCar) -> bool,
) -> usize {
    let rows = adapter
        .get_many(PreviewCar::collection_name().into(), vec![])
        .await;

    let mut cleared = 0;
    for value in rows {
        let Ok(row) = serde_json::from_value::<PreviewCar>(value) else {
            continue;
        };
        // Already empty: nothing to release, and publishing anyway would
        // wake every dashboard on every sweep for no reason.
        if row.car_id.is_empty() || !should_release(&row) {
            continue;
        }
        let patch = serde_json::json!({ "car_id": "", "touched_at": serde_json::Value::Null });
        let Some(updated) = adapter
            .update(
                PreviewCar::collection_name().into(),
                PreviewCar::key_field(),
                &row.id,
                patch,
            )
            .await
        else {
            continue;
        };
        if let Ok(updated) = serde_json::from_value::<PreviewCar>(updated) {
            TypiQLBroker::publish(PreviewCarChanged {
                operation_name: "update".to_string(),
                value: updated,
            });
            cleared += 1;
        }
    }
    cleared
}

/// Drops abandoned pins forever, every `SWEEP_INTERVAL`.
pub async fn run_expiry_watchdog(adapter: Arc<dyn TypiQLAdapter>) {
    let mut ticker = tokio::time::interval(SWEEP_INTERVAL);
    loop {
        ticker.tick().await;
        let cleared = clear_expired(&adapter).await;
        if cleared > 0 {
            println!(
                "preview_car: released {cleared} pin(s) that hadn't been refreshed in {}m",
                PIN_TTL.as_secs() / 60
            );
        }
    }
}
