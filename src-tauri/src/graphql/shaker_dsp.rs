use crate::config_manager::app_config::{read_app_config, write_app_config};
use crate::pipewire_dsp::{
    self, CornerSpec, DeviceChainSpec, EffectDspSpec, LfeCornerSpec, LfeSpec,
};
use crate::typiql_types::{
    LfeChannel, MonocoqueSoundDevice, ShakerChannel, ShakerDspChannel, SoundDeviceProfile,
    SoundDeviceProfileChanged,
};
use async_graphql::{Context, Object, Result as GqlResult};
use std::collections::HashMap;
use std::sync::Arc;
use typiql::{resolve_list, TypiQLAdapter, TypiQLBroker, TypiQLType};

/// Fetches every live (profileId == null) MonocoqueSoundDevice row.
async fn fetch_live_monocoque_rows(adapter: &Arc<dyn TypiQLAdapter>) -> Vec<MonocoqueSoundDevice> {
    adapter
        .get_many(MonocoqueSoundDevice::collection_name().into(), vec![])
        .await
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .filter(|r: &MonocoqueSoundDevice| r.profile_id.is_none())
        .collect()
}

async fn fetch_live_shaker_channels(adapter: &Arc<dyn TypiQLAdapter>) -> Vec<ShakerChannel> {
    adapter
        .get_many(ShakerChannel::collection_name().into(), vec![])
        .await
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .filter(|c: &ShakerChannel| c.profile_id.is_none())
        .collect()
}

/// Builds one `DeviceChainSpec` per distinct device among the live
/// `ShakerChannel` set — "1 chain per device selected across the channels"
/// (see pipewire_dsp::DeviceChainSpec's doc comment). Every `MonocoqueSoundDevice`/
/// `LfeChannel` row resolves its device by joining through its own
/// `channel_id` to the owning `ShakerChannel`, not through a flat `pan`
/// match — `pan` is no longer globally unique, only unique within one
/// channel's own device (see ShakerChannel.pan's doc comment), so a flat
/// pan-based join would be ambiguous once two channels on different devices
/// share a pan value.
async fn build_device_chains(
    adapter: &Arc<dyn TypiQLAdapter>,
) -> Result<Vec<DeviceChainSpec>, String> {
    let live_rows = fetch_live_monocoque_rows(adapter).await;
    if live_rows.is_empty() {
        return Err("No active shaker channels to enable DSP for.".to_string());
    }
    let live_channels = fetch_live_shaker_channels(adapter).await;
    let channels_by_id: HashMap<String, ShakerChannel> = live_channels
        .into_iter()
        .map(|c| (c.id.clone(), c))
        .collect();

    // Every device in use, with its own channel count — derived from the
    // channels themselves, since devid/channels live on ShakerChannel, not
    // duplicated per effect row.
    let mut channels_per_device: HashMap<String, u8> = HashMap::new();
    for channel in channels_by_id.values() {
        channels_per_device
            .entry(channel.devid.clone())
            .or_insert(channel.channels);
    }

    let all_dsp_channels: Vec<ShakerDspChannel> = adapter
        .get_many(ShakerDspChannel::collection_name().into(), vec![])
        .await
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();
    let live_dsp_by_slot: HashMap<u8, &ShakerDspChannel> = all_dsp_channels
        .iter()
        .filter(|c| c.profile_id.is_none())
        .map(|c| (c.slot, c))
        .collect();

    // Grouped two levels deep (device -> effect -> corners) so each corner
    // moves straight into its final EffectDspSpec below with no cloning.
    // Rows without a dsp_slot predate the field and haven't been through the
    // one-time migration yet, and rows whose channel_id doesn't resolve to a
    // live channel (orphaned) are both skipped defensively rather than
    // panicking — they simply won't get DSP processing.
    let mut effects_by_device: HashMap<String, HashMap<String, Vec<CornerSpec>>> = HashMap::new();
    for row in &live_rows {
        let Some(slot) = row.dsp_slot else { continue };
        let Some(channel) = channels_by_id.get(&row.channel_id) else {
            continue;
        };
        let dsp = live_dsp_by_slot.get(&slot);
        effects_by_device
            .entry(channel.devid.clone())
            .or_default()
            .entry(row.effect.to_lowercase())
            .or_default()
            .push(CornerSpec {
                pan: channel.pan,
                lpf_hz: dsp.and_then(|c| c.lpf_hz),
                fader: dsp.map(|c| c.fader).unwrap_or(100),
                muted: dsp.map(|c| c.muted).unwrap_or(false),
            });
    }

    let app_config = read_app_config().map_err(|e| e.to_string())?;
    let lfe_source_device = app_config.settings.shaker_lfe_source_device.clone();

    let all_lfe_channels: Vec<LfeChannel> = adapter
        .get_many(LfeChannel::collection_name().into(), vec![])
        .await
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .collect();
    let mut lfe_corners_by_device: HashMap<String, Vec<LfeCornerSpec>> = HashMap::new();
    for c in all_lfe_channels
        .into_iter()
        .filter(|c| c.profile_id.is_none())
    {
        let Some(channel) = channels_by_id.get(&c.channel_id) else {
            continue;
        };
        lfe_corners_by_device
            .entry(channel.devid.clone())
            .or_default()
            .push(LfeCornerSpec {
                pan: channel.pan,
                fader: c.fader,
                muted: c.muted,
            });
    }

    let lfe_source_channels = match &lfe_source_device {
        Some(source) => {
            let sinks = pipewire_dsp::list_audio_sinks().unwrap_or_default();
            sinks
                .iter()
                .find(|s| &s.name == source)
                .map(|s| s.channels)
                .unwrap_or(2)
        }
        None => 0,
    };

    let mut devices: Vec<String> = channels_per_device.keys().cloned().collect();
    devices.sort();

    let mut chains = Vec::new();
    for devid in devices {
        let output_channel_count = *channels_per_device.get(&devid).unwrap_or(&4);
        let effects: Vec<EffectDspSpec> = effects_by_device
            .remove(&devid)
            .unwrap_or_default()
            .into_iter()
            .map(|(effect_key, corners)| EffectDspSpec {
                effect_key,
                corners,
            })
            .collect();
        let lfe = match (&lfe_source_device, lfe_corners_by_device.remove(&devid)) {
            (Some(source_device), Some(corners)) => Some(LfeSpec {
                source_device: source_device.clone(),
                source_channels: lfe_source_channels,
                lpf_hz: app_config.settings.shaker_lfe_lpf_hz,
                corners,
            }),
            _ => None,
        };

        chains.push(DeviceChainSpec {
            output_device: devid,
            output_channel_count,
            effects,
            lfe,
        });
    }

    Ok(chains)
}

/// Called once at server startup (see api.rs). If DSP was left enabled from
/// before a backend restart, AppSettings.shakerDspEnabled still says so, but
/// the actual `pipewire` filter-chain process is gone (it lived in the old
/// process tree, not persisted anywhere) — so the sink silently doesn't
/// exist even though the UI shows DSP as "on". This re-establishes it.
///
/// Best-effort: any failure (no live channels, pipewire not available) is
/// swallowed rather than panicking server startup over a DSP feature that's
/// secondary to the rest of the app.
pub async fn resume_shaker_dsp_if_enabled(adapter: Arc<dyn TypiQLAdapter>) {
    let Ok(app_config) = read_app_config() else {
        return;
    };
    if !app_config.settings.shaker_dsp_enabled {
        return;
    }
    let Ok(chains) = build_device_chains(&adapter).await else {
        return;
    };

    if let Err(e) = pipewire_dsp::load_filter_chain(&chains) {
        eprintln!("resume_shaker_dsp_if_enabled: failed to reload filter-chain: {e}");
    }
}

#[derive(Default)]
pub struct ShakerDspQuery;

#[Object]
impl ShakerDspQuery {
    /// Real PipeWire sinks available as a channel's output device or the LFE
    /// source device pickers. Excludes the app's own DSP sinks.
    async fn get_audio_sinks(&self) -> GqlResult<Vec<pipewire_dsp::AudioSinkInfo>> {
        pipewire_dsp::list_audio_sinks().map_err(async_graphql::Error::new)
    }
}

#[derive(Default)]
pub struct ShakerDspMutation;

#[Object]
impl ShakerDspMutation {
    /// Loads one PipeWire filter-chain per distinct device in use across the
    /// live ShakerChannel set (LPF + fader per channel, from the live
    /// ShakerDspChannel rows) and flips shakerDspEnabled on. No storage
    /// changes to ShakerChannel/MonocoqueSoundDevice rows — the DSP-mode
    /// devid/volume substitution is computed fresh at config-export time
    /// only (buildConfigText), never persisted (see ShakerChannel.devid's
    /// doc comment). Still gated behind a confirmation dialog on the
    /// frontend since loading the filter-chain does immediately start
    /// routing real audio through it.
    async fn enable_shaker_dsp(&self, ctx: &Context<'_>) -> GqlResult<bool> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let chains = build_device_chains(&adapter)
            .await
            .map_err(async_graphql::Error::new)?;

        pipewire_dsp::load_filter_chain(&chains).map_err(async_graphql::Error::new)?;

        let mut app_config = read_app_config().map_err(async_graphql::Error::new)?;
        app_config.settings.shaker_dsp_enabled = true;
        write_app_config(&app_config).map_err(async_graphql::Error::new)?;

        Ok(true)
    }

    /// Rebuilds the filter-chain from current state and reloads it, leaving
    /// `shakerDspEnabled` alone.
    ///
    /// Every other live edit (fader, mute, LPF) reaches the running chain
    /// through `pw-cli` without touching the process — see
    /// `apply_shaker_dsp_channel_live`. A **device** change can't: which sink
    /// each chain feeds, how many output channels it has, and which monitor
    /// the LFE taps are all baked into the filter-chain's config at build
    /// time (`DeviceChainSpec::output_device`/`output_channel_count`,
    /// `LfeSpec::source_device`), so switching devices means rebuilding the
    /// graph, not poking a parameter on it. Without this, changing a
    /// channel's device while DSP was on left the chain feeding the OLD
    /// device until the user manually toggled DSP off and on again.
    ///
    /// Returns false (rather than erroring) when DSP isn't currently
    /// enabled, so the frontend can fire it after any device edit without
    /// first checking — there's simply no chain to rebuild in that case, and
    /// the next enable/resume builds a fresh one from the same state anyway.
    ///
    /// `load_filter_chain` unloads any previous instance itself, so this
    /// deliberately doesn't unload first: doing so would add a second gap of
    /// silence for no benefit.
    async fn reload_shaker_dsp(&self, ctx: &Context<'_>) -> GqlResult<bool> {
        let app_config = read_app_config().map_err(async_graphql::Error::new)?;
        if !app_config.settings.shaker_dsp_enabled {
            return Ok(false);
        }

        let adapter = crate::graphql::default_adapter(ctx)?;
        let chains = build_device_chains(&adapter)
            .await
            .map_err(async_graphql::Error::new)?;
        pipewire_dsp::load_filter_chain(&chains).map_err(async_graphql::Error::new)?;

        Ok(true)
    }

    /// Unloads the filter-chain and flips shakerDspEnabled off. No row
    /// mutations — see enable_shaker_dsp's doc comment for why none are
    /// needed at all under the ShakerChannel model.
    async fn disable_shaker_dsp(&self, _ctx: &Context<'_>) -> GqlResult<bool> {
        pipewire_dsp::unload_filter_chain().map_err(async_graphql::Error::new)?;

        let mut app_config = read_app_config().map_err(async_graphql::Error::new)?;
        app_config.settings.shaker_dsp_enabled = false;
        write_app_config(&app_config).map_err(async_graphql::Error::new)?;

        Ok(true)
    }

    /// Unsets isDefault on whichever profile currently holds it, sets it on
    /// `id`. The typiql macro's auto-generated update mutation can't enforce
    /// "exactly one default" on its own, hence this hand-written resolver.
    async fn set_default_sound_device_profile(
        &self,
        ctx: &Context<'_>,
        id: String,
    ) -> GqlResult<SoundDeviceProfile> {
        let adapter = crate::graphql::default_adapter(ctx)?;

        let all_profiles: Vec<SoundDeviceProfile> =
            resolve_list::<SoundDeviceProfile>(ctx, vec![]).await?;
        for p in &all_profiles {
            if p.is_default && p.id != id {
                let demoted = adapter
                    .update(
                        SoundDeviceProfile::collection_name().into(),
                        "id",
                        &p.id,
                        serde_json::json!({ "is_default": false }),
                    )
                    .await;
                // Every profile whose flag moved, not just the new default
                // below — promoting one demotes another, and a list holding
                // that other profile would keep showing it as the default.
                if let Some(demoted) =
                    demoted.and_then(|v| serde_json::from_value::<SoundDeviceProfile>(v).ok())
                {
                    TypiQLBroker::publish(SoundDeviceProfileChanged {
                        operation_name: "update".to_string(),
                        value: demoted,
                    });
                }
            }
        }

        let updated = adapter
            .update(
                SoundDeviceProfile::collection_name().into(),
                "id",
                &id,
                serde_json::json!({ "is_default": true }),
            )
            .await
            .ok_or_else(|| async_graphql::Error::new("Profile not found"))?;

        let updated: SoundDeviceProfile = serde_json::from_value(updated)
            .map_err(|e| async_graphql::Error::new(e.to_string()))?;
        // Written through the adapter, so the macro's own announcement is
        // bypassed. ProfilesList holds a live soundDeviceProfileChanged
        // subscription, so without this it showed a stale default until
        // reloaded.
        TypiQLBroker::publish(SoundDeviceProfileChanged {
            operation_name: "update".to_string(),
            value: updated.clone(),
        });
        Ok(updated)
    }

    /// Writes Monocoque's config file. Replaces the previously-orphaned
    /// Tauri `write_monocoque_config` command (never registered in
    /// generate_handler!, and Tauri IPC doesn't fit this app's intended
    /// browser/kiosk usage pattern anyway) — reached over GraphQL like
    /// everything else.
    async fn write_monocoque_config(&self, config: String) -> GqlResult<bool> {
        crate::config_manager::write_monocoque_config(config).map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    /// SIGHUPs the running Monocoque process to reload its config. Replaces
    /// the previously-orphaned Tauri `reload_monocoque` command.
    async fn reload_monocoque(&self) -> GqlResult<bool> {
        crate::config_manager::reload_monocoque().map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    /// Live-updates one corner's LPF frequency + fader gain on the
    /// already-running filter-chain — no process restart, no interruption
    /// in output (see pipewire_dsp::set_live_channel). The frontend calls
    /// this right after persisting a ShakerDspChannel edit via the
    /// macro-generated update/addShakerDspChannel, only while DSP is
    /// currently enabled (this errors if it isn't — there's no running
    /// filter-chain to update).
    ///
    /// `slot` is the DSP-settings identity (ShakerDspChannel.slot /
    /// MonocoqueSoundDevice.dsp_slot) — resolved here to the (devid,
    /// effect_key, pan) triple pipewire_dsp::set_live_channel actually
    /// needs, via the row's own channel_id join.
    async fn apply_shaker_dsp_channel_live(
        &self,
        ctx: &Context<'_>,
        slot: u8,
        lpf_hz: Option<f32>,
        fader: u8,
        muted: bool,
    ) -> GqlResult<bool> {
        let adapter = crate::graphql::default_adapter(ctx)?;
        let all_rows: Vec<MonocoqueSoundDevice> = adapter
            .get_many(MonocoqueSoundDevice::collection_name().into(), vec![])
            .await
            .into_iter()
            .filter_map(|v| serde_json::from_value(v).ok())
            .collect();
        let row = all_rows
            .iter()
            .find(|r| r.profile_id.is_none() && r.dsp_slot == Some(slot))
            .ok_or_else(|| async_graphql::Error::new(format!("No live row for DSP slot {slot}")))?;

        let live_channels = fetch_live_shaker_channels(&adapter).await;
        let channel = live_channels
            .iter()
            .find(|c| c.id == row.channel_id)
            .ok_or_else(|| async_graphql::Error::new("This row's channel no longer exists"))?;

        pipewire_dsp::set_live_channel(
            &channel.devid,
            &row.effect.to_lowercase(),
            channel.pan,
            lpf_hz,
            fader,
            muted,
        )
        .map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    /// Live-updates one corner's fader/mute on the LFE effect's
    /// already-running filter-chain (see pipewire_dsp::set_live_lfe_channel).
    /// `channelId` is the LfeChannel row's own channel_id — resolved here
    /// directly to its owning ShakerChannel for devid + pan, rather than a
    /// pan-based lookup (pan is no longer globally unique — see
    /// ShakerChannel.pan's doc comment).
    async fn apply_lfe_channel_live(
        &self,
        ctx: &Context<'_>,
        channel_id: String,
        fader: u8,
        muted: bool,
    ) -> GqlResult<bool> {
        let adapter = crate::graphql::default_adapter(ctx)?;
        let live_channels = fetch_live_shaker_channels(&adapter).await;
        let channel = live_channels
            .iter()
            .find(|c| c.id == channel_id)
            .ok_or_else(|| async_graphql::Error::new("This channel no longer exists"))?;

        pipewire_dsp::set_live_lfe_channel(&channel.devid, channel.pan, fader, muted)
            .map_err(async_graphql::Error::new)?;
        Ok(true)
    }

    /// Live-updates the LFE effect's shared LPF frequency on every device's
    /// own LFE module at once (see pipewire_dsp::set_live_lfe_lpf) — global,
    /// not per-corner, so unlike applyLfeChannelLive this needs no
    /// channel/device resolution at all.
    async fn apply_lfe_lpf_live(&self, lpf_hz: Option<f32>) -> GqlResult<bool> {
        pipewire_dsp::set_live_lfe_lpf(lpf_hz).map_err(async_graphql::Error::new)?;
        Ok(true)
    }
}
