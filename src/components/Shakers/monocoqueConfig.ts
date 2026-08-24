import { ShakerRec, TYRE_EFFECTS } from './EffectRow';
import { ShakerChannel } from './channelQueries';
import { ShiftLightRec } from './ShiftLights/queries';
import { LedsDeviceRec } from './LedsDevices/queries';
import { SimWindDeviceRec } from './SimWindDevices/queries';

// monocoque reads its *entire* hardware setup from one config file, one
// shared `devices = (...)` array (confirmed against
// monocoque/conf/monocoque.config — Tachometer/Sound/Serial blocks all sit
// side by side in the same array, not separate files/sections per device
// type). Writing only this app's own device category's blocks would
// silently delete every other category the last export wrote — every
// exporter (Shakers/ShiftLights/LedsDevices/SimWindDevices) must therefore
// always assemble ALL FOUR categories' blocks and write the combined file,
// regardless of which page's "Export to Config" button was clicked.

// PipeWire node names can't safely contain arbitrary devid characters
// (dots/dashes/etc) — must match pipewire_dsp::device_slug's sanitization
// exactly (non `[a-zA-Z0-9_]` -> `_`) since the backend derives its actual
// running sink names the same way.
function deviceSlug(devid: string): string {
  return devid.replace(/[^a-zA-Z0-9_]/g, '_');
}

// While DSP is enabled, each (device, effect) pair's exported devid/volume
// are substituted fresh at export time only — computed here, never
// persisted to storage (see ShakerChannel.devid's backend doc comment for
// the full reasoning: the DSP-mode override is inherently per-*effect*
// *per-device*, since every effect gets its own isolated capture sink per
// device it has corners on — see pipewire_dsp::load_filter_chain's doc
// comment — while devid itself now lives per-*channel*, so the substitution
// moved to export time, the same place pan/channels/dsp_slot substitution
// already lived under the prior per-slot design).
function dspEffectSinkName(devid: string, effect: string): string {
  return `shaker_dsp_${deviceSlug(devid)}_${effect.toLowerCase()}_in`;
}

export function buildSoundDeviceBlocks(records: ShakerRec[], shakerChannels: ShakerChannel[], dspEnabled: boolean): string[] {
  const channelsById = new Map(shakerChannels.map(c => [c.id, c]));
  return records.map(r => {
    const channel = channelsById.get(r.channelId);
    const isTyreEffect = TYRE_EFFECTS.has(r.effect.toLowerCase());
    const effectiveDevid = dspEnabled && channel
      ? dspEffectSinkName(channel.devid, r.effect)
      : (channel?.devid ?? '');
    const effectiveVolume = dspEnabled ? 100 : r.volume;
    const lines = [
      `            device       = "Sound";`,
      `            effect       = "${r.effect}";`,
      // Only emitted for tyre-capable effects — Monocoque's gettyre() is
      // only ever called when effect_type is TYRESLIP/TYRELOCK/ABSBRAKES/
      // SUSPENSION (confirmed directly against confighelper.c this
      // session), so omitting the line entirely for engine/gear cannot hit
      // the known uninitialized-pointer crash in gettyre() — that code path
      // is simply never reached for them. `channel?.position` is always
      // real once a position has been picked; "AllFour" is only a fallback
      // for the rare case a tyre effect exists before its channel has one.
      ...(isTyreEffect ? [`            tyre         = "${channel?.position ?? 'AllFour'}";`] : []),
      `            devid        = "${effectiveDevid}";`,
      `            channels     = ${channel?.channels ?? 4};`,
      `            pan          = ${channel?.pan ?? 0};`,
      `            volume       = ${effectiveVolume};`,
      `            modulation   = "${r.modulation}";`,
      ...(r.frequency != null ? [`            frequency    = ${r.frequency};`] : []),
      ...(r.frequencyMax != null ? [`            frequencyMax = ${r.frequencyMax};`] : []),
      ...(r.amplitude != null ? [`            amplitude    = ${r.amplitude};`] : []),
      ...(r.amplitudeMax != null ? [`            amplitudeMax = ${r.amplitudeMax};`] : []),
    ];
    return `        {\n${lines.join('\n')}\n        }`;
  });
}

// ShiftLightRec.deviceKind picks which of monocoque's two wire shapes a row
// exports as — see MonocoqueShiftLight's backend doc comment. "usb" is the
// original Tachometer/Revburner shape; "serial" is a wheelbase's built-in
// strip (Moza R5/R12/R3/R8, KS Pro Wheel — confirmed field names/casing
// against monocoque/src/monocoque/helper/confighelper.c: `subtype`,
// `devpath`, `baud`, all lowercase, no camelCase, unlike this app's own
// GraphQL fields).
export function buildShiftLightBlocks(records: ShiftLightRec[]): string[] {
  return records.map(r => {
    if (r.deviceKind === 'serial') {
      const lines = [
        `            device       = "Serial";`,
        `            type         = "Wheel";`,
        `            subtype      = "${r.subtype}";`,
        `            devpath      = "${r.devpath ?? ''}";`,
        `            baud         = ${r.baud ?? 115200};`,
      ];
      return `        {\n${lines.join('\n')}\n        }`;
    }
    const lines = [
      `            device       = "USB";`,
      `            type         = "Tachometer";`,
      `            devid        = "${r.devid}";`,
      `            subtype      = "${r.subtype}";`,
      `            granularity  = ${r.granularity};`,
      `            config       = "${r.config}";`,
    ];
    return `        {\n${lines.join('\n')}\n        }`;
  });
}

export function buildLedsDeviceBlocks(records: LedsDeviceRec[]): string[] {
  return records.map(r => {
    const lines = [
      `            device       = "Serial";`,
      `            type         = "Simleds";`,
      `            numleds      = ${r.numLeds};`,
      `            startled     = ${r.startLed};`,
      `            endled       = ${r.endLed};`,
      `            config       = "${r.config}";`,
      `            baud         = ${r.baud};`,
      `            devpath      = "${r.devpath}";`,
    ];
    return `        {\n${lines.join('\n')}\n        }`;
  });
}

export function buildSimWindDeviceBlocks(records: SimWindDeviceRec[]): string[] {
  return records.map(r => {
    const lines = [
      `            device       = "Serial";`,
      `            type         = "SimWind";`,
      `            config       = "${r.config}";`,
      `            baud         = ${r.baud};`,
      `            devpath      = "${r.devpath}";`,
      `            fanpower     = ${r.fanPower};`,
    ];
    return `        {\n${lines.join('\n')}\n        }`;
  });
}

export function wrapMonocoqueConfigBlocks(blocks: string[]): string {
  return `configs = (\n    {\n        sim = "default";\n        car = "default";\n        devices = (\n${blocks.join(',\n')}\n        );\n    }\n);\n`;
}

export interface MonocoqueDeviceSets {
  shakerRecords: ShakerRec[];
  shakerChannels: ShakerChannel[];
  dspEnabled: boolean;
  shiftLights: ShiftLightRec[];
  ledsDevices: LedsDeviceRec[];
  simWindDevices: SimWindDeviceRec[];
}

// The single combined config text every "Export to Config" button in this
// app should write — see this file's own top-of-file doc comment for why
// partial exports are unsafe.
export function buildFullMonocoqueConfig(sets: MonocoqueDeviceSets): string {
  const blocks = [
    ...buildSoundDeviceBlocks(sets.shakerRecords, sets.shakerChannels, sets.dspEnabled),
    ...buildShiftLightBlocks(sets.shiftLights),
    ...buildLedsDeviceBlocks(sets.ledsDevices),
    ...buildSimWindDeviceBlocks(sets.simWindDevices),
  ];
  return wrapMonocoqueConfigBlocks(blocks);
}
