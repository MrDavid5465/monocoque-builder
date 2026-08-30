use async_graphql::SimpleObject;
use serde::Serialize;
use serde_json::Value;
use crate::host_command::host_command;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, SimpleObject)]
pub struct AudioSinkInfo {
    pub name: String,
    pub description: String,
    pub channels: u8,
}

/// Enumerates real PipeWire sinks (via PulseAudio's compat CLI, `pactl`,
/// confirmed present and JSON-capable on this system — no native pw-cli
/// binding needed for read-only enumeration) for the output-device picker.
/// Excludes the app's own DSP sinks themselves, if currently loaded, so
/// they can't be picked as their own playback target.
pub fn list_audio_sinks() -> Result<Vec<AudioSinkInfo>, String> {
    let output = host_command("pactl")
        .args(["-f", "json", "list", "sinks"])
        .output()
        .map_err(|e| format!("Failed to run pactl: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "pactl exited with code {}: {}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr),
        ));
    }

    let parsed: Vec<Value> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse pactl JSON output: {e}"))?;

    let sinks = parsed
        .into_iter()
        .filter_map(|v| {
            let name = v.get("name")?.as_str()?.to_string();
            if name.starts_with(DSP_SINK_PREFIX) {
                return None;
            }
            let description = v
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or(&name)
                .to_string();
            let channels = v
                .get("properties")
                .and_then(|p| p.get("audio.channels"))
                .and_then(Value::as_str)
                .and_then(|s| s.parse::<u8>().ok())
                .unwrap_or(2);
            Some(AudioSinkInfo {
                name,
                description,
                channels,
            })
        })
        .collect();

    Ok(sinks)
}

/// Prefix for every capture sink this module creates (e.g.
/// "shaker_dsp_dev_alsa_output_..._engine_in") — one per (device, effect)
/// pair, shared by that effect's corner rows *on that device*, not one per
/// row. See load_filter_chain's doc comment for the reasoning behind this
/// shape.
pub const DSP_SINK_PREFIX: &str = "shaker_dsp_";

/// Sanitizes a real PipeWire devid (an arbitrary, often dot/dash-heavy sink
/// name) into something safe to splice into a generated node name — non
/// `[a-zA-Z0-9_]` characters become `_`. Needed now that the same effect can
/// have independent modules on multiple devices simultaneously (one per
/// device's own chain, see load_filter_chain's doc comment), so sink names
/// must disambiguate by device, not just by effect.
fn device_slug(devid: &str) -> String {
    devid
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

pub fn effect_sink_name(devid: &str, effect_key: &str) -> String {
    format!("{DSP_SINK_PREFIX}{}_{effect_key}_in", device_slug(devid))
}

pub fn lfe_sink_name(devid: &str) -> String {
    format!("{DSP_SINK_PREFIX}{}_lfe_in", device_slug(devid))
}

/// Cutoff frequency used to represent "LPF bypassed" for a channel — well
/// above the top of human hearing (and above anything a shaker's mechanical
/// bandwidth could reproduce anyway), so a bq_lowpass node set to this Freq
/// is functionally a pass-through. Used instead of omitting the lpf node
/// entirely: the filter-chain's graph topology (which nodes/links exist) can
/// only be changed by fully respawning the `pipewire` process, but Freq/Mult
/// *values* on nodes that already exist can be changed live via `pw-cli s
/// <node-id> Props` with zero process restart and zero audio interruption
/// (see set_live_channel) — confirmed by hands-on testing. Keeping the lpf
/// node permanently present, and expressing "off" as a value rather than a
/// missing node, is what makes every fader/LPF adjustment in the UI apply
/// instantly instead of requiring a disable/enable cycle.
const BYPASS_FREQ_HZ: f32 = 20_000.0;

/// One physical corner's DSP settings within an effect. `pan` is both this
/// row's Monocoque-facing channel index (matches what Monocoque's own
/// `cv.values[pan]` writes into the shared capture sink) *and* the real
/// device output channel its processed signal lands on — the same number,
/// now that ShakerChannel.pan means "real output index on this channel's own
/// device" directly (see ShakerChannel.pan's doc comment). There is no
/// longer a separate `output_pan` to resolve.
pub struct CornerSpec {
    pub pan: u8,
    /// None = LPF bypassed for this corner.
    pub lpf_hz: Option<f32>,
    /// 0-100.
    pub fader: u8,
    /// When true, this corner's effective gain is 0 regardless of `fader`
    /// (see ShakerDspChannel.muted's doc comment).
    pub muted: bool,
}

/// The gain a corner's `vol{pan}` node should actually be set to, folding
/// `muted` in without disturbing the stored `fader` value it's derived
/// from.
fn effective_mult(fader: u8, muted: bool) -> f32 {
    if muted {
        0.0
    } else {
        (fader as f32) / 100.0
    }
}

/// One effect's worth of DSP corners, sharing one capture sink. `effect_key`
/// is the lowercased effect name (rows with different-cased effect strings
/// for the same semantic effect, e.g. "Engine" vs "engine", share one sink —
/// matches pre-existing app data rather than trying to normalize it).
pub struct EffectDspSpec {
    pub effect_key: String,
    pub corners: Vec<CornerSpec>,
}

/// One physical corner's slice of the LFE effect on one device — `pan` is
/// the real device channel its fader/mute-gated share of the shared
/// downmix+LPF signal fans out to (see LfeSpec's doc comment; same
/// pan-is-the-real-index reasoning as CornerSpec).
pub struct LfeCornerSpec {
    pub pan: u8,
    pub fader: u8,
    pub muted: bool,
}

/// One device's slice of the LFE effect's spec: an entirely separate signal
/// path from the other (Monocoque-fed) effects — it taps `source_device`'s
/// monitor directly (an existing real PipeWire sink, e.g. the game's own
/// audio output), not a virtual sink Monocoque writes into. `source_channels`
/// sizes the downmix (see load_filter_chain's LFE module). `lpf_hz` is
/// shared/global (None = bypassed) since the downmix collapses everything
/// to one mono signal before it ever reaches a per-corner fader — unlike
/// CornerSpec, which has its own `lpf_hz` per corner because each of those
/// signals is genuinely independent. Every device with at least one active
/// LFE corner gets its own independent instance of this (own capture of
/// source_device's monitor, own downmix, own lpf node) — duplicate capture
/// of the same source sink from multiple modules is fine in PipeWire.
pub struct LfeSpec {
    pub source_device: String,
    pub source_channels: u8,
    pub lpf_hz: Option<f32>,
    pub corners: Vec<LfeCornerSpec>,
}

/// PID of the currently-running `pipewire -c <config>` child process, if DSP
/// is enabled. Mirrors gamepad.rs's `static DEVICE` pattern for holding
/// external-resource state alive across GraphQL calls within this process.
///
/// Loading/unloading the filter-chain is done by spawning/killing a whole
/// second `pipewire` daemon process running just this one module, connected
/// as a peer client to the real system PipeWire — NOT via `pw-cli
/// load-module`. Confirmed by hands-on testing in this dev container:
/// `pw-cli load-module` loads a module into pw-cli's own local client
/// context, which is destroyed (along with everything it created) the
/// instant pw-cli's own one-shot process exits — it cannot create a
/// persistent system-wide sink at all. A standalone `pipewire -c` process,
/// left running in the background, is the actual documented mechanism for
/// this (see /usr/share/pipewire/filter-chain.conf's own header comment:
/// "Run the filters with pipewire -c filter-chain.conf").
static FILTER_CHAIN_PID: Mutex<Option<u32>> = Mutex::new(None);

fn config_file_path() -> std::path::PathBuf {
    std::env::temp_dir().join("typiql-shaker-dsp.conf")
}

fn log_file_path() -> std::path::PathBuf {
    std::env::temp_dir().join("typiql-shaker-dsp.log")
}

/// Mirrors Monocoque's own explicit channel_map choice for its playback
/// streams exactly (usb_generic_shaker_pulse.c's usb_generic_shaker_init:
/// pa_channel_map_parse for 2/4/6/8 channels — front-left/right,
/// rear-left/right, etc, not PulseAudio's generic auto-default). Used for
/// both the real *output device* side and each effect's capture sink (both
/// always 2/4/6/8 in practice, matching the real device's own channel
/// count) — see load_filter_chain's doc comment.
fn channel_positions(count: u8) -> Option<&'static [&'static str]> {
    match count {
        2 => Some(&["FL", "FR"]),
        4 => Some(&["FL", "FR", "RL", "RR"]),
        6 => Some(&["FL", "FR", "FC", "LFE", "RL", "RR"]),
        8 => Some(&["FL", "FR", "FC", "LFE", "RL", "RR", "SL", "SR"]),
        _ => None,
    }
}

/// One physical device's whole DSP chain — every effect (+ LFE) module that
/// targets it, sized to its own channel count. `load_filter_chain` builds
/// one of these per distinct `devid` in use across the live `ShakerChannel`
/// set: "1 chain per device selected across the channels" (a 4-channel
/// single-device rig is 1 chain; 4 channels split across 2 devices is 2
/// chains) — see load_filter_chain's own doc comment for why each chain
/// keeps today's exact per-effect module shape rather than merging into one
/// shared capture sink.
pub struct DeviceChainSpec {
    pub output_device: String,
    pub output_channel_count: u8,
    pub effects: Vec<EffectDspSpec>,
    pub lfe: Option<LfeSpec>,
}

/// Builds one effect's filter-chain module JSON args (capture sink sized to
/// `output_channel_count`, isolated per-corner LPF+fader chains, direct
/// remap to real output channels) — see load_filter_chain's doc comment for
/// the full reasoning behind this shape. Extracted so it can run once per
/// device the effect has corners on, not just once globally.
fn build_effect_module(
    devid: &str,
    output_channel_count: u8,
    effect: &EffectDspSpec,
) -> Result<String, String> {
    let sink_name = effect_sink_name(devid, &effect.effect_key);

    // "volume" is not a real builtin filter-graph label — confirmed by
    // hands-on testing (PipeWire 1.6.8) that it fails with "cannot
    // create label volume", killing the whole filter-chain module load.
    // "linear" (new = old * Mult + Add) is the actual builtin gain
    // filter; Mult alone gives a plain 0.0-1.0 fader (Add defaults to 0).
    //
    // The lpf node is *always* present per channel, even when
    // "bypassed" — see BYPASS_FREQ_HZ's doc comment for why (topology
    // must stay constant for live control updates to work at all). Q
    // must be set explicitly — confirmed by hands-on testing that
    // leaving it unset defaults to 0, a degenerate/invalid value for a
    // biquad's Freq/Q design math that produced total silence on real
    // hardware despite Freq being set correctly. 0.707 is the standard
    // "maximally flat" (Butterworth-equivalent) Q for a simple
    // 2nd-order lowpass.
    //
    // lpf{p}/vol{p} node names are suffixed by capture-channel index
    // (Monocoque's own `pan` for that corner) since, unlike the old
    // per-row-module design, multiple corners' chains now coexist in
    // one shared per-effect module instance.
    let mut nodes = Vec::new();
    let mut links = Vec::new();
    let mut inputs = Vec::new();
    for p in 0..output_channel_count {
        let corner = effect.corners.iter().find(|c| c.pan == p);
        let lpf_name = format!("lpf{p}");
        let vol_name = format!("vol{p}");
        nodes.push(serde_json::json!({
            "type": "builtin",
            "name": vol_name,
            "label": "linear",
            "control": { "Mult": corner.map(|c| effective_mult(c.fader, c.muted)).unwrap_or(0.0) },
        }));
        nodes.push(serde_json::json!({
                "type": "builtin",
                "name": lpf_name,
                "label": "bq_lowpass",
                "control": { "Freq": corner.and_then(|c| c.lpf_hz).unwrap_or(BYPASS_FREQ_HZ), "Q": 0.707 },
            }));
        links.push(serde_json::json!({
            "output": format!("{lpf_name}:Out"),
            "input": format!("{vol_name}:In"),
        }));
        inputs.push(format!("{lpf_name}:In"));
    }

    // Direct remap: each real output channel gets exactly the one
    // corner-chain that targets it, or a permanently-silent placeholder
    // if this effect has no corner for that channel.
    let mut outputs = Vec::new();
    for idx in 0..output_channel_count {
        if let Some(corner) = effect.corners.iter().find(|c| c.pan == idx) {
            outputs.push(format!("vol{}:Out", corner.pan));
        } else {
            let silence_name = format!("silence{idx}");
            nodes.push(serde_json::json!({
                "type": "builtin",
                "name": silence_name,
                "label": "linear",
                "control": { "Mult": 0.0 },
            }));
            // vol0 always exists (the loop above builds all
            // output_channel_count chains unconditionally) — its actual
            // content is irrelevant here since Mult=0 zeroes it either way.
            links.push(serde_json::json!({
                "output": "vol0:Out",
                "input": format!("{silence_name}:In"),
            }));
            outputs.push(format!("{silence_name}:Out"));
        }
    }

    // playback.props deliberately has no media.class — confirmed by
    // testing that setting one there (Audio/Sink, matching the capture
    // side) causes PipeWire to log "media.class Audio/Sink does not
    // expect Output stream direction" and the node never connects.
    let mut playback_props = serde_json::json!({
        "node.name": format!("{sink_name}_out"),
        "audio.channels": output_channel_count,
        "target.object": devid,
    });
    if let Some(positions) = channel_positions(output_channel_count) {
        playback_props["audio.position"] = serde_json::json!(positions);
    }

    // capture.props channel count matches output_channel_count exactly
    // (mirroring the real device's own channel count, same as
    // Monocoque's pre-DSP config always used) — no dont-remix/explicit
    // position needed here, since Monocoque's own stream declares the
    // identical channel count and its own explicit channel_map, so
    // ports connect straightforwardly by index, the same mechanism the
    // proven-working pre-DSP backup config already relied on.
    let mut capture_props = serde_json::json!({
        "node.name": sink_name,
        "media.class": "Audio/Sink",
        "audio.channels": output_channel_count,
    });
    if let Some(positions) = channel_positions(output_channel_count) {
        capture_props["audio.position"] = serde_json::json!(positions);
    }

    let filter_chain_args = serde_json::json!({
        "node.description": format!("Shaker DSP: {}", effect.effect_key),
        "media.name": format!("Shaker DSP: {}", effect.effect_key),
        "filter.graph": {
            "nodes": nodes,
            "links": links,
            "inputs": inputs,
            "outputs": outputs,
        },
        "capture.props": capture_props,
        "playback.props": playback_props,
    });
    let filter_chain_args_str =
        serde_json::to_string(&filter_chain_args).map_err(|e| e.to_string())?;

    Ok(format!(
            "    {{ name = libpipewire-module-filter-chain\n        args = {filter_chain_args_str}\n    }}"
        ))
}

/// Builds the LFE module's filter-chain JSON args for one device — the same
/// downmix+LPF+fanout shape as before (see the module-level doc comment on
/// LfeSpec), just now producing one instance per device that has at least
/// one active LFE corner, rather than a single global instance. Structurally
/// the same filter-chain shape as build_effect_module (capture.props +
/// playback.props + filter.graph), but with fundamentally different
/// topology and capture semantics — it reads *from* an existing real device
/// (source_device's monitor) as a plain input stream, rather than presenting
/// itself as a new virtual sink for Monocoque to write into. "mixer"
/// (builtin, ports "In 1".."In 8", controls "Gain 1".."Gain 8" — confirmed
/// via `man 7 libpipewire-module-filter-chain`) downmixes the N source
/// channels to one mono signal, gain-scaled by 1/N per input to avoid
/// summing N channels into clipping; one shared "lpf" node (same
/// bq_lowpass/Q pattern as every other channel in this file, always present
/// so its Freq stays live-adjustable the same way — see BYPASS_FREQ_HZ's doc
/// comment) processes that mono signal once; then, unlike build_effect_module
/// (a direct 1:1 remap, since within one effect no two corners ever share an
/// output channel), the *same* filtered mono signal is broadcast to every
/// enabled corner's own "vol{pan}" gain node — a real fan-out, not a remap,
/// since multiple corners can (and typically do) all want a share of the one
/// LFE signal simultaneously.
fn build_lfe_module(
    devid: &str,
    output_channel_count: u8,
    lfe: &LfeSpec,
) -> Result<String, String> {
    let sink_name = lfe_sink_name(devid);
    let mut nodes = Vec::new();
    let mut links = Vec::new();

    let mut mixer_control = serde_json::Map::new();
    let n = lfe.source_channels.max(1);
    for i in 0..lfe.source_channels {
        mixer_control.insert(format!("Gain {}", i + 1), serde_json::json!(1.0 / n as f32));
    }
    nodes.push(serde_json::json!({
        "type": "builtin", "name": "mix", "label": "mixer", "control": mixer_control,
    }));
    let inputs: Vec<String> = (0..lfe.source_channels)
        .map(|i| format!("mix:In {}", i + 1))
        .collect();

    nodes.push(serde_json::json!({
        "type": "builtin", "name": "lpf", "label": "bq_lowpass",
        "control": { "Freq": lfe.lpf_hz.unwrap_or(BYPASS_FREQ_HZ), "Q": 0.707 },
    }));
    links.push(serde_json::json!({ "output": "mix:Out", "input": "lpf:In" }));

    let mut outputs = Vec::new();
    for idx in 0..output_channel_count {
        if let Some(corner) = lfe.corners.iter().find(|c| c.pan == idx) {
            let vol_name = format!("vol{idx}");
            nodes.push(serde_json::json!({
                "type": "builtin", "name": vol_name, "label": "linear",
                "control": { "Mult": effective_mult(corner.fader, corner.muted) },
            }));
            links.push(
                serde_json::json!({ "output": "lpf:Out", "input": format!("{vol_name}:In") }),
            );
            outputs.push(format!("{vol_name}:Out"));
        } else {
            let silence_name = format!("silence{idx}");
            nodes.push(serde_json::json!({
                "type": "builtin", "name": silence_name, "label": "linear",
                "control": { "Mult": 0.0 },
            }));
            links.push(
                serde_json::json!({ "output": "lpf:Out", "input": format!("{silence_name}:In") }),
            );
            outputs.push(format!("{silence_name}:Out"));
        }
    }

    // No media.class — mirrors playback_props below (and every effect's
    // own playback_props above): omitting it plus setting target.object
    // makes this a plain stream that connects itself *to* an existing
    // node, here the source sink, rather than creating a new virtual
    // device for something else to connect to.
    //
    // `target.object` is deliberately the sink's own name, NOT
    // "{name}.monitor" — confirmed via hands-on testing (real hardware,
    // an atypical multi-app PipeWire routing setup with several virtual
    // sinks feeding an external DAW, all patched by a saved qpwgraph
    // layout at startup) that "{name}.monitor" doesn't resolve to
    // anything in the *native* PipeWire graph at all: that name only
    // exists in the PulseAudio-compatibility layer (pipewire-pulse),
    // which native `libpipewire-module-filter-chain` clients don't go
    // through. With an unresolvable target.object, PipeWire silently
    // fell back to auto-linking this capture stream to *the system's
    // default source* instead — observed directly in qpwgraph landing on
    // "default.remapped source" (an unrelated mic-passthrough), not the
    // configured sink at all. `stream.capture.sink: true` is the correct
    // native mechanism for "listen to what's being played to this sink"
    // (the same property `pw-record --target <sink> -P
    // 'stream.capture.sink=true'` uses) — it tells the adapter to
    // capture the sink node's own render/monitor side rather than
    // treating target.object as a capture source to be routed *from*.
    let mut capture_props = serde_json::json!({
        "node.name": sink_name,
        "audio.channels": lfe.source_channels,
        "target.object": lfe.source_device,
        "stream.capture.sink": true,
    });
    if let Some(positions) = channel_positions(lfe.source_channels) {
        capture_props["audio.position"] = serde_json::json!(positions);
    }

    let mut playback_props = serde_json::json!({
        "node.name": format!("{sink_name}_out"),
        "audio.channels": output_channel_count,
        "target.object": devid,
    });
    if let Some(positions) = channel_positions(output_channel_count) {
        playback_props["audio.position"] = serde_json::json!(positions);
    }

    let filter_chain_args = serde_json::json!({
        "node.description": "Shaker DSP: LFE",
        "media.name": "Shaker DSP: LFE",
        "filter.graph": {
            "nodes": nodes,
            "links": links,
            "inputs": inputs,
            "outputs": outputs,
        },
        "capture.props": capture_props,
        "playback.props": playback_props,
    });
    let filter_chain_args_str =
        serde_json::to_string(&filter_chain_args).map_err(|e| e.to_string())?;

    Ok(format!(
            "    {{ name = libpipewire-module-filter-chain\n        args = {filter_chain_args_str}\n    }}"
        ))
}

/// Builds and starts a standalone `pipewire -c <generated config>` process
/// containing one independent `libpipewire-module-filter-chain` module
/// instance per (device, effect) pair actually in use — not per row, and not
/// one giant shared module either. `chains` has one `DeviceChainSpec` per
/// distinct device among the live `ShakerChannel` set (see its own doc
/// comment for what "1 chain per device" means).
///
/// Each effect's module has a capture sink with `output_channel_count`
/// channels — matching *that device's* own channel count exactly (e.g. 4) —
/// targeted directly by that effect's own corner rows on that device, each
/// with its **real, untouched `pan`/`channels` values**, exactly as
/// Monocoque's original pre-DSP config used them. Monocoque's own
/// `cv.values[pan]` gating (the same mechanism the pre-DSP config always
/// relied on) does the per-corner separation *for us*, writing each row's
/// audio onto its own distinct channel of this shared sink — no per-row
/// mono sink, no per-row `stream.dont-remix`/`audio.position` trick needed
/// at the capture side at all. This is the mechanism that fixed real-hardware
/// routing this session (see the historical note below) — grouping the
/// filter-chain by device does not change it, it just runs it once per
/// device instead of once globally.
///
/// Internally, each of the sink's `output_channel_count` channels gets its
/// own isolated `bq_lowpass` -> `linear` (LPF + fader) chain, wired *directly*
/// to the real output channel that corner's `pan` targets — a straight
/// remap, not a broadcast gate, since within one effect on one device each
/// corner has a distinct target. Multiple *different* effects (or the same
/// effect on a different device) targeting the same real output channel of
/// the same device still sum together natively via PipeWire's own sink
/// mixing when their independent playback streams reach the same target
/// device — this is exactly why per-effect modules don't need to be merged
/// into one shared capture sink even when several land on one physical
/// channel.
///
/// This replaced an earlier design where every row got its own **mono**
/// capture sink and a mono playback stream with a single-entry
/// `audio.position` (e.g. `["RL"]`) plus `stream.dont-remix: true` to land
/// on one channel of the real device — which additionally required
/// temporarily rewriting each row's `pan` to 0 and `channels` to 1 in the
/// exported Monocoque config while DSP was enabled. That mono+dont-remix+
/// position-label approach turned out to be unreliable on real hardware for
/// non-front channel positions specifically: hands-on testing (objective
/// `parec` capture during a real `monocoque test` run, with the
/// known-working pre-DSP backup config as a working reference on the exact
/// same physical device) showed rear-channel audio reaching the real output
/// via the backup config's native multi-channel + per-channel-volume
/// approach, while the mono+dont-remix+`["RL"]`/`["RR"]` streams produced
/// literally zero signal — both at the real device and even at the row's
/// own capture sink (i.e. the whole per-row filter-chain node never reached
/// a running state) — and separately, the engine effect specifically was
/// observed not reaching all 4 output channels even after that was fixed.
/// Reusing Monocoque's own native multi-channel-stream + per-channel-volume
/// mechanism — proven to work on every channel — instead of a filter-chain-
/// side position-relabeling trick sidesteps both problems.
///
/// Returns the child process's PID (also cached in FILTER_CHAIN_PID). The
/// base module set (rt/protocol-native/client-node/adapter) is copied from
/// /usr/share/pipewire/filter-chain.conf and loaded once, shared by every
/// filter-chain module instance (across every device's chain) in this same
/// process — confirmed via hands-on testing that multiple
/// `libpipewire-module-filter-chain` entries can coexist in one
/// `context.modules` array within a single `pipewire -c` process, each
/// independently addressable (by its own capture/playback node names) and
/// independently live-adjustable via `pw-cli` (see set_live_channel).
pub fn load_filter_chain(chains: &[DeviceChainSpec]) -> Result<u32, String> {
    let mut modules = Vec::new();

    for chain in chains {
        for effect in &chain.effects {
            modules.push(build_effect_module(
                &chain.output_device,
                chain.output_channel_count,
                effect,
            )?);
        }
        if let Some(lfe) = &chain.lfe {
            modules.push(build_lfe_module(
                &chain.output_device,
                chain.output_channel_count,
                lfe,
            )?);
        }
    }

    // Base module set + spa-libs copied verbatim from
    // /usr/share/pipewire/filter-chain.conf — PipeWire's own conf parser
    // accepts strict JSON for each filter-chain module's `args` value
    // interchangeably with the bare key=value style used for everything
    // else in this file, so each entry in `modules` can be spliced straight
    // in as-is.
    let config_text = format!(
        r#"
context.properties = {{
    log.level = 0
}}
context.spa-libs = {{
    audio.convert.* = audioconvert/libspa-audioconvert
    support.*       = support/libspa-support
}}
context.modules = [
    {{ name = libpipewire-module-rt
        args = {{ }}
        flags = [ ifexists nofail ]
    }}
    {{ name = libpipewire-module-protocol-native }}
    {{ name = libpipewire-module-client-node }}
    {{ name = libpipewire-module-adapter }}
{}
]
"#,
        modules.join("\n")
    );

    let config_path = config_file_path();
    std::fs::write(&config_path, config_text)
        .map_err(|e| format!("Failed to write filter-chain config: {e}"))?;

    // Stop any previous instance first — matches ensure-clean-state idiom
    // used elsewhere (e.g. gamepad.rs's ensure_device).
    let _ = unload_filter_chain();

    let log_file = std::fs::File::create(log_file_path()).map_err(|e| e.to_string())?;
    let log_file_err = log_file.try_clone().map_err(|e| e.to_string())?;

    let mut child = host_command("pipewire")
        .arg("-c")
        .arg(&config_path)
        .stdout(log_file)
        .stderr(log_file_err)
        .spawn()
        .map_err(|e| format!("Failed to spawn pipewire (is it installed?): {e}"))?;

    // Give it a moment to either come up cleanly or fail fast (e.g. a
    // malformed config, a target.object that doesn't exist) — confirmed via
    // hands-on testing that a bad config exits within well under 300ms.
    std::thread::sleep(std::time::Duration::from_millis(300));

    match child.try_wait() {
        Ok(Some(status)) => {
            let log = std::fs::read_to_string(log_file_path()).unwrap_or_default();
            Err(format!("pipewire exited immediately ({status}): {log}"))
        }
        Ok(None) => {
            let pid = child.id();
            *FILTER_CHAIN_PID.lock().map_err(|e| e.to_string())? = Some(pid);

            // Reap it on exit. Dropping `Child` doesn't wait, so every
            // teardown used to leave a `<defunct>` pipewire behind — one per
            // load, and reloads are no longer rare now that a device change
            // triggers one (see graphql::shaker_dsp::reload_shaker_dsp).
            // Nothing here reads liveness by name the way the service
            // watchdogs do (see `process_liveness`), so those zombies were
            // harmless rather than load-bearing, but they were still ours.
            std::thread::spawn(move || {
                let _ = child.wait();
            });

            Ok(pid)
        }
        Err(e) => Err(format!("Failed to check pipewire process status: {e}")),
    }
}

/// Kills the currently-running filter-chain `pipewire` process, if any. A
/// no-op if none is running — matches this codebase's existing idempotent
/// teardown convention (e.g. gamepad.rs's device lifecycle).
///
/// Kills by matching the config file's path via `pkill -f`, not just the
/// PID cached in FILTER_CHAIN_PID — confirmed by hands-on debugging that
/// relying on the cached PID alone orphans the child process across a
/// backend restart (e.g. cargo-watch rebuilding on a code change): the
/// static Mutex resets to None on restart, so the next load_filter_chain's
/// "stop any previous instance" call finds nothing to kill even though the
/// old pipewire process is still running, still holding the same sink
/// names — producing colliding sinks with different (possibly stale)
/// configs and no reliable way to tell which one Monocoque actually
/// connects to. The config path is fixed/deterministic
/// (config_file_path()), so matching on it is safe and self-healing
/// regardless of in-memory state.
pub fn unload_filter_chain() -> Result<(), String> {
    *FILTER_CHAIN_PID.lock().map_err(|e| e.to_string())? = None;

    let config_path = config_file_path();
    let config_path_str = config_path.to_string_lossy();
    host_command("pkill")
        .arg("-f")
        .arg(format!("pipewire -c {config_path_str}"))
        .output()
        .map_err(|e| format!("Failed to run pkill: {e}"))?;
    Ok(())
}

/// Finds a filter-chain module's capture-side node by its PipeWire object id
/// — needed for set_live_channel/set_live_lfe_* below, since `pw-cli s`
/// addresses nodes by numeric id, not name, and that id is assigned fresh by
/// PipeWire every time the filter-chain process (re)spawns (it is not
/// something this process can cache/predict). Uses `pw-dump`'s JSON output
/// rather than parsing `pw-cli ls`'s text format.
fn find_node_id_by_name(target_name: &str) -> Result<u32, String> {
    let output = host_command("pw-dump")
        .arg("Node")
        .output()
        .map_err(|e| format!("Failed to run pw-dump: {e}"))?;
    if !output.status.success() {
        return Err(format!("pw-dump exited with {}", output.status));
    }
    let nodes: Vec<Value> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse pw-dump output: {e}"))?;

    nodes
        .into_iter()
        .find(|n| n.pointer("/info/props/node.name").and_then(Value::as_str) == Some(target_name))
        .and_then(|n| n.get("id").and_then(Value::as_u64))
        .map(|id| id as u32)
        .ok_or_else(|| {
            format!(
                "Shaker DSP node '{target_name}' is not currently loaded (no running sink found)"
            )
        })
}

fn find_effect_capture_node_id(devid: &str, effect_key: &str) -> Result<u32, String> {
    find_node_id_by_name(&effect_sink_name(devid, effect_key))
        .map_err(|_| format!("Shaker DSP effect '{effect_key}' is not currently loaded on this device (no running sink found)"))
}

/// Finds every currently-loaded node whose name ends with `suffix` — used by
/// set_live_lfe_lpf to update every device's own LFE module at once, since
/// there can now be more than one (one per device with an active LFE
/// corner), unlike the single global LFE_NODE_NAME this replaced.
fn find_node_ids_by_suffix(suffix: &str) -> Result<Vec<u32>, String> {
    let output = host_command("pw-dump")
        .arg("Node")
        .output()
        .map_err(|e| format!("Failed to run pw-dump: {e}"))?;
    if !output.status.success() {
        return Err(format!("pw-dump exited with {}", output.status));
    }
    let nodes: Vec<Value> = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Failed to parse pw-dump output: {e}"))?;

    Ok(nodes
        .into_iter()
        .filter_map(|n| {
            let name = n.pointer("/info/props/node.name").and_then(Value::as_str)?;
            if !name.ends_with(suffix) {
                return None;
            }
            n.get("id").and_then(Value::as_u64).map(|id| id as u32)
        })
        .collect())
}

/// `pw-cli s <node_id> Props '{ params = [ "<control>" <value> ] }'` for one
/// control — shared by set_live_channel/set_live_lfe_lpf/
/// set_live_lfe_channel below. Confirmed via hands-on testing that this
/// updates the value immediately, verified by reading it straight back with
/// enum-params.
fn set_prop(node_id: u32, key: &str, value: f32) -> Result<(), String> {
    let pod = format!(r#"{{ params = [ "{key}" {value} ] }}"#);
    let output = host_command("pw-cli")
        .arg("s")
        .arg(node_id.to_string())
        .arg("Props")
        .arg(&pod)
        .output()
        .map_err(|e| format!("Failed to run pw-cli: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "pw-cli set {key} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/// Live-updates one corner's LPF frequency and fader gain on the
/// already-running filter-chain, with no process restart and no audio
/// interruption — see BYPASS_FREQ_HZ's doc comment for why this works (the
/// lpf{pan}/vol{pan} nodes always exist once DSP is enabled; only their
/// control *values* change here, via PipeWire's standard live node-Props
/// mechanism, the same one pavucontrol/qpwgraph use for e.g. persistent EQ
/// configs). `devid` selects which device's instance of this effect's module
/// to address (a given effect can have independent modules on multiple
/// devices now — see load_filter_chain's doc comment); `pan` selects which
/// of that module's per-channel chains to update (matches Monocoque's own
/// `pan` for that corner's row — the caller resolves a DSP slot to its
/// (devid, effect_key, pan) via a DB lookup before calling this). Confirmed
/// via hands-on testing: `pw-cli s <capture-node-id> Props '{ params = [
/// "<control>" <value> ] }'` updates the value immediately, verified by
/// reading it straight back with enum-params.
pub fn set_live_channel(
    devid: &str,
    effect_key: &str,
    pan: u8,
    lpf_hz: Option<f32>,
    fader: u8,
    muted: bool,
) -> Result<(), String> {
    let node_id = find_effect_capture_node_id(devid, effect_key)?;
    let freq = lpf_hz.unwrap_or(BYPASS_FREQ_HZ);
    let mult = effective_mult(fader, muted);

    set_prop(node_id, &format!("lpf{pan}:Freq"), freq)?;
    set_prop(node_id, &format!("vol{pan}:Mult"), mult)?;
    Ok(())
}

/// Live-updates the LFE effect's shared LPF frequency on *every* currently
/// loaded device's LFE module — same mechanism as set_live_channel, but
/// `shakerLfeLpfHz` is one global AppSettings knob shared across every
/// device's own independent downmix (see LfeSpec's doc comment for why each
/// device's "lpf" node is local but conceptually shares one value), so every
/// matching node needs updating, not just one. A no-op (not an error) if no
/// device currently has an active LFE module — matches "nothing to update"
/// rather than treating it as a failure.
pub fn set_live_lfe_lpf(lpf_hz: Option<f32>) -> Result<(), String> {
    let node_ids = find_node_ids_by_suffix("_lfe_in")?;
    let freq = lpf_hz.unwrap_or(BYPASS_FREQ_HZ);
    for node_id in node_ids {
        set_prop(node_id, "lpf:Freq", freq)?;
    }
    Ok(())
}

/// Live-updates one corner's fader/mute on the LFE effect's already-running
/// filter-chain. `devid` selects which device's LFE module to address (a
/// corner belongs to exactly one channel, which belongs to exactly one
/// device). `pan` must already have a "vol{pan}" node in that device's
/// running topology (i.e. this corner was enabled when the filter-chain was
/// last (re)loaded) — same pre-existing limitation as adding a brand new
/// effect corner while DSP is already running (see ShakerMatrix's
/// handleToggle): the topology itself only changes on the next enable/resume
/// cycle, only control *values* are live-adjustable in between.
pub fn set_live_lfe_channel(devid: &str, pan: u8, fader: u8, muted: bool) -> Result<(), String> {
    let node_id = find_node_id_by_name(&lfe_sink_name(devid))?;
    set_prop(
        node_id,
        &format!("vol{pan}:Mult"),
        effective_mult(fader, muted),
    )
}
