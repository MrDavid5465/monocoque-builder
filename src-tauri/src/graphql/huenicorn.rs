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
        huenicorn::set_manually_stopped(false);
        huenicorn::start_huenicorn().map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    /// Flags the stop as user-initiated (see `huenicorn::MANUAL_STOP`) before
    /// performing it — otherwise `run_sim_watcher`'s level check would just
    /// start huenicorn again on its next tick while the sim is still Active.
    async fn stop_huenicorn(&self, _ctx: &Context<'_>) -> GqlResult<bool> {
        huenicorn::set_manually_stopped(true);
        huenicorn::stop_huenicorn().map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    /// Stops huenicorn, clears its saved XDG-portal `restoreToken`, and
    /// restarts it — see `huenicorn::reset_screen_selection`'s own doc
    /// comment for why this is needed at all (huenicorn silently reuses the
    /// first screen/region selection forever otherwise, with no other way
    /// to change it).
    async fn reset_huenicorn_screen_selection(&self, _ctx: &Context<'_>) -> GqlResult<bool> {
        huenicorn::reset_screen_selection().map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    /// Drags one corner of `channelId`'s screen region — see
    /// `huenicorn::set_channel_uv` for the corner-index convention and why
    /// the response (not the caller's own guess) is the new source of truth.
    async fn set_channel_uv(
        &self,
        _ctx: &Context<'_>,
        channel_id: u8,
        corner: u8,
        x: f32,
        y: f32,
    ) -> GqlResult<huenicorn::ChannelUVs> {
        huenicorn::set_channel_uv(channel_id, corner, x, y)
            .await
            .map_err(async_graphql::Error::new)
    }

    /// Activates/deactivates a channel in Huenicorn's live config —
    /// ChannelMapper.tsx's per-row toggle, replacing the original web UI's
    /// drag-between-lists interaction (not touch-friendly).
    async fn set_channel_active(
        &self,
        _ctx: &Context<'_>,
        channel_id: u8,
        active: bool,
    ) -> GqlResult<Vec<huenicorn::ChannelInfo>> {
        huenicorn::set_channel_active(channel_id, active)
            .await
            .map_err(async_graphql::Error::new)
    }

    /// Persists Huenicorn's current live config to its own profile.json —
    /// see `huenicorn::save_profile`.
    async fn save_huenicorn_profile(&self, _ctx: &Context<'_>) -> GqlResult<bool> {
        huenicorn::save_profile().await.map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    async fn set_huenicorn_subsample_width(
        &self,
        _ctx: &Context<'_>,
        width: i32,
    ) -> GqlResult<huenicorn::HuenicornDisplayInfo> {
        huenicorn::set_subsample_width(width)
            .await
            .map_err(async_graphql::Error::new)
    }

    async fn set_huenicorn_refresh_rate(&self, _ctx: &Context<'_>, hz: i32) -> GqlResult<i32> {
        huenicorn::set_refresh_rate(hz)
            .await
            .map_err(async_graphql::Error::new)
    }

    async fn set_huenicorn_interpolation(&self, _ctx: &Context<'_>, value: i32) -> GqlResult<bool> {
        huenicorn::set_interpolation(value)
            .await
            .map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    async fn set_huenicorn_transition_smoothing(
        &self,
        _ctx: &Context<'_>,
        value: f32,
    ) -> GqlResult<f32> {
        huenicorn::set_transition_smoothing(value)
            .await
            .map_err(async_graphql::Error::new)
    }

    async fn set_huenicorn_entertainment_configuration(
        &self,
        _ctx: &Context<'_>,
        id: String,
    ) -> GqlResult<Vec<huenicorn::ChannelInfo>> {
        huenicorn::set_entertainment_configuration(id)
            .await
            .map_err(async_graphql::Error::new)
    }
}
