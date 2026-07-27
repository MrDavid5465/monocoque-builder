import type { SchemaDefinition } from '../../lib/per-form';

const MODULATION_OPTIONS = [
  { key: 'frequency', text: 'Frequency', value: 'frequency' },
  { key: 'amplitude', text: 'Amplitude', value: 'amplitude' },
];

// Shared by every slider field that should defer its outer (network-
// mutating) commit until pointer release rather than firing on every drag
// tick — see EffectRow.tsx's own doc comment for the full dragging-ref
// mechanism this plugs into.
interface DragHooks {
  onActivate: () => void;
  onDeactivate: () => void;
}

// Modulation/frequency/amplitude — config-export-only fields (no live DSP
// equivalent), always in their own "Advanced" section, collapsed by
// default, present in both the DSP-on and DSP-off schemas below. Tyre/
// position moved to ShakerChannel — one picker per channel (ShakerMatrix's
// column header), not per effect — so it's no longer part of this per-effect
// Advanced section at all.
function advancedFields(drag: DragHooks): SchemaDefinition<any> {
  return {
    modulation: { type: 'select', label: 'Modulation', options: MODULATION_OPTIONS, section: 'Advanced', sectionCollapsed: true },
    frequency: {
      type: 'slider', label: 'Freq (Hz)', min: 0, max: 200, step: 1, section: 'Advanced', sectionCollapsed: true,
      onActivate: drag.onActivate, onDeactivate: drag.onDeactivate,
    },
    frequencyMax: {
      type: 'slider', label: 'Freq Max', min: 0, max: 200, step: 1, section: 'Advanced', sectionCollapsed: true,
      onActivate: drag.onActivate, onDeactivate: drag.onDeactivate,
    },
    amplitude: {
      type: 'slider', label: 'Amplitude', min: 0, max: 100, step: 1, section: 'Advanced', sectionCollapsed: true,
      onActivate: drag.onActivate, onDeactivate: drag.onDeactivate,
    },
    amplitudeMax: {
      type: 'slider', label: 'Amp Max', min: 0, max: 100, step: 1, section: 'Advanced', sectionCollapsed: true,
      onActivate: drag.onActivate, onDeactivate: drag.onDeactivate,
    },
  };
}

// DSP disabled: Enabled + Volume unsectioned (always visible), Advanced
// fields in their own collapsed section — no separate "adv" toggle button
// needed, the section header itself does that job.
export function dspOffSchema(opts: { label: string; enabled: boolean; drag: DragHooks }): SchemaDefinition<any> {
  return {
    enabled: { type: 'checkbox', label: 'Enabled' },
    ...(opts.enabled ? {
      volume: {
        type: 'slider', label: 'Volume', min: 0, max: 100, step: 1,
        onActivate: opts.drag.onActivate, onDeactivate: opts.drag.onDeactivate,
      },
      ...advancedFields(opts.drag),
    } : {}),
  };
}

// DSP enabled: Enabled + Fader unsectioned (always visible), LPF in its own
// collapsed section, Advanced fields below that in their own collapsed
// section. Mute is deliberately NOT a schema field — it's rendered as a
// standalone icon button in the cell's top-right corner instead (see
// EffectRow.tsx), committing directly via onDspChange rather than through
// this Form's own commit-diffing.
//
// `lpfHz` is *always* present alongside `lpfOn` here — not conditionally
// included only once lpfOn is checked. That conditional-inclusion design
// was tried first and produced a real, confirmed bug: per-form's Form only
// initializes its internal `values` state once at mount, from whichever
// fields exist in the schema *at that moment* (see useForm.ts's
// `defaultValues()`) — so a field added to the schema later, after the
// user checks the box, never gets backfilled from `initialValues` at all.
// Reproduced live: checking LPF and immediately typing a frequency
// silently discarded it, because the very *commit for checking the box*
// fired from a still-stale schema/values snapshot that didn't have lpfHz
// in it yet, sending `lpfHz: undefined` (which downstream code correctly,
// but unhelpfully, treated as null) instead of a real number. Always
// including the field sidesteps the whole class of bug: `values.lpfHz`
// is correctly seeded from `initialValues.lpfHz` at mount, before the user
// ever touches anything.
export function dspOnSchema(opts: { label: string; enabled: boolean; drag: DragHooks }): SchemaDefinition<any> {
  return {
    enabled: { type: 'checkbox', label: 'Enabled' },
    ...(opts.enabled ? {
      fader: {
        type: 'slider', label: 'Fader', min: 0, max: 100, step: 1,
        onActivate: opts.drag.onActivate, onDeactivate: opts.drag.onDeactivate,
      },
      lpfOn: { type: 'checkbox', label: 'LPF', section: 'LPF', sectionCollapsed: true },
      lpfHz: {
        type: 'slider', label: 'LPF Hz', min: 20, max: 2000, step: 10, section: 'LPF', sectionCollapsed: true,
        onActivate: opts.drag.onActivate, onDeactivate: opts.drag.onDeactivate,
      },
      ...advancedFields(opts.drag),
    } : {}),
  };
}

// LFE's per-corner cell: Enabled + Fader, unsectioned, no LPF section and no
// Advanced section at all — LFE has no tyre/modulation/frequency concept of
// its own (it's not a Monocoque effect), and its LPF is one shared control
// across every corner (see ShakerMatrix's global LFE LPF Hz control), not a
// per-cell one like the other 6 effects. Mute is a standalone top-right icon
// button (see LfeRow.tsx), same rationale as dspOnSchema above.
export function lfeSchema(opts: { enabled: boolean; drag: DragHooks }): SchemaDefinition<any> {
  return {
    enabled: { type: 'checkbox', label: 'Enabled' },
    ...(opts.enabled ? {
      fader: {
        type: 'slider', label: 'Fader', min: 0, max: 100, step: 1,
        onActivate: opts.drag.onActivate, onDeactivate: opts.drag.onDeactivate,
      },
    } : {}),
  };
}
