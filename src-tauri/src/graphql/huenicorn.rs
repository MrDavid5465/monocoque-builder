use crate::huenicorn;
use async_graphql::{Context, Object, Result as GqlResult};

#[derive(Default)]
pub struct HuenicornMutation;

#[Object]
impl HuenicornMutation {
    /// Manual override for the primary start/stop path, which is owned by
    /// `huenicorn::run_sim_watcher` (auto start/stop tied to `sim_status` +
    /// `huenicornEnabled`) — this exists for testing and for turning the
    /// running instance off/on without waiting on the sim state to change.
    async fn start_huenicorn(&self, _ctx: &Context<'_>) -> GqlResult<bool> {
        // No color-poller coordination needed here — `run_color_poller` is
        // a permanent background loop (spawned once at startup, see its own
        // doc comment) that notices this process coming up on its own.
        huenicorn::start_huenicorn().map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    async fn stop_huenicorn(&self, _ctx: &Context<'_>) -> GqlResult<bool> {
        huenicorn::stop_huenicorn().map_err(async_graphql::Error::new)?;
        Ok(true)
    }
}
