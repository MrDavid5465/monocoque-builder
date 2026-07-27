import React, { useRef } from 'react';
import { IconButton, Icon } from '@fluentui/react';
import { Form } from '../../lib/denim/lib';
import { getTheme } from '../../lib/denim/lib';
import { dspOffSchema, dspOnSchema } from './schemas';
import { ShakerDspChannel } from './dspQueries';

export interface ShakerRec {
  id: string;
  device: string;
  effect: string;
  // This row's channel — a direct reference to ShakerChannel.id. Replaced a
  // flat `pan` field once ShakerChannel.pan stopped being globally unique
  // (see ShakerChannel's backend doc comment) — `tyre`/`devid`/`channels`/
  // real `pan` all live on the channel this points at, not duplicated here.
  channelId: string;
  volume: number;
  modulation: string;
  frequency?: number | null;
  frequencyMax?: number | null;
  amplitude?: number | null;
  amplitudeMax?: number | null;
  profileId?: string | null;
  // This row's permanent isolated DSP capture-channel identity — distinct
  // from `pan`, which stays the row's real physical output-channel target
  // at all times. See MonocoqueSoundDevice.dsp_slot's backend doc comment.
  dspSlot?: number | null;
}

export const EFFECTS = ['engine', 'gear', 'suspension', 'tyreslip', 'tyrelock', 'abs'] as const;
export type EffectKey = (typeof EFFECTS)[number];

export const EFFECT_LABELS: Record<string, string> = {
  engine: 'Engine', gear: 'Gear', suspension: 'Suspension',
  tyreslip: 'Tyre Slip', tyrelock: 'Tyre Lock', abs: 'ABS',
};

export const TYRE_EFFECTS = new Set(['suspension', 'tyreslip', 'tyrelock', 'abs']);

export const TYRE_SHORT: Record<string, string> = {
  FrontLeft: 'FL', FrontRight: 'FR', RearLeft: 'RL', RearRight: 'RR',
  Front: 'F·F', Rear: 'R·R', Left: 'F·R L', Right: 'F·R R', All: 'All',
};

// ── EffectRow ─────────────────────────────────────────────────────────────────

interface EffectRowProps {
  rec: ShakerRec | null;
  label?: string;
  onToggle: () => void;
  onUpdate: (override: Partial<ShakerRec>) => void;
  // Per-slot DSP control, keyed by rec.dspSlot — optional since not every
  // caller wants it (CarLayout's cells intentionally omit it, per-effect
  // DSP tuning isn't its focus). Only rendered when both are provided.
  dspChannel?: ShakerDspChannel | null;
  onDspChange?: (override: { lpfHz?: number | null; fader?: number; muted?: boolean }) => void;
  // Global DSP on/off — picks the schema (dspOnSchema vs dspOffSchema), same
  // as it decides which volume control is meaningful: Monocoque's own
  // `volume` while off, the DSP fader+LPF while on, never both at once.
  // Defaults to false so callers that never pass dsp props at all
  // (CarLayout) just always use the plain-volume schema.
  dspEnabled?: boolean;
}

const ADVANCED_FIELDS = ['modulation', 'frequency', 'frequencyMax', 'amplitude', 'amplitudeMax'] as const;

export const EffectRow: React.FC<EffectRowProps> = ({ rec, label, onToggle, onUpdate, dspChannel, onDspChange, dspEnabled = false }) => {
  const theme = getTheme();
  const enabled = rec !== null;
  const showDsp = enabled && !!onDspChange && rec!.dspSlot != null && dspEnabled;
  const muted = dspChannel?.muted ?? false;

  // Shared by every slider in this one Form (volume, fader, LPF Hz, and the
  // four advanced fields) — only ONE can be dragged at a time, so a single
  // ref correctly gates all of them: defer the outer (network-mutating)
  // commit until pointer release instead of firing on every drag tick.
  // Checkboxes/selects/TyreGrid's own Apply button never touch this (no
  // onActivate wired to them), so they still commit immediately.
  const dragging = useRef(false);
  const pending = useRef<any>(null);
  const skipFirst = useRef(true);
  // Last snapshot actually forwarded to onToggle/onUpdate/onDspChange — lets
  // commit() diff a field-by-field Form-wide `clean` snapshot back down into
  // the three different narrower callbacks each field group belongs to.
  const prevRef = useRef<any>(null);

  // The inner <Form> below (keyed on rec/dspChannel identity, see its own
  // `key` prop) remounts with fresh internal values — and fires a fresh
  // mount-tick onChange — whenever `rec` or `dspChannel` transitions from
  // "still loading" (null) to real data, most commonly on first page load
  // before GET_ITEMS/GET_DSP_CHANNELS resolve. These refs live up here in
  // EffectRow, which itself never remounts (ShakerMatrix doesn't key it),
  // so without this reset `skipFirst` stays consumed from that first
  // (pre-data) mount, and the second mount's real-data onChange sails
  // straight into commit() as a phantom "user edit" — confirmed live via
  // this exact bug in the sibling LfeRow.tsx (infinite enable/disable
  // ping-pong on refresh) and via this row's own mass no-op
  // updateShakerDspChannel/applyShakerDspChannelLive calls firing for every
  // channel on every fresh page load. Resetting inline during render (not
  // in a useEffect) matters: the remounted Form's own mount-effect fires as
  // part of the same commit, effects run child-before-parent, so a parent
  // useEffect here would reset these refs one render too late.
  const identity = `${rec?.id ?? 'none'}|${dspChannel?.id ?? 'none'}|${showDsp}`;
  const lastIdentity = useRef(identity);
  if (lastIdentity.current !== identity) {
    lastIdentity.current = identity;
    skipFirst.current = true;
    prevRef.current = null;
  }

  const commit = (clean: any) => {
    const prev = prevRef.current ?? clean;

    if (clean.enabled !== prev.enabled) {
      onToggle();
      // The row's own identity (rec becoming null or non-null) is about to
      // change from the parent re-rendering with fresh data — nothing else
      // in this snapshot is still meaningful to also commit this tick.
      prevRef.current = clean;
      return;
    }

    if ('volume' in clean && clean.volume !== prev.volume) {
      onUpdate({ volume: clean.volume });
    }

    if ('fader' in clean) {
      const lpfHzOut = clean.lpfOn ? clean.lpfHz : null;
      const prevLpfHzOut = prev.lpfOn ? prev.lpfHz : null;
      if (clean.fader !== prev.fader || lpfHzOut !== prevLpfHzOut) {
        onDspChange!({ lpfHz: lpfHzOut, fader: clean.fader });
      }
    }

    if (ADVANCED_FIELDS.some(k => k in clean && clean[k] !== prev[k])) {
      onUpdate({
        modulation: clean.modulation, frequency: clean.frequency,
        frequencyMax: clean.frequencyMax, amplitude: clean.amplitude, amplitudeMax: clean.amplitudeMax,
      });
    }

    prevRef.current = clean;
  };

  const drag = {
    onActivate: () => { dragging.current = true; },
    onDeactivate: () => { dragging.current = false; if (pending.current) commit(pending.current); },
  };

  const schema = showDsp
    ? dspOnSchema({ label: label ?? '', enabled, drag })
    : dspOffSchema({ label: label ?? '', enabled, drag });

  const initialValues = {
    enabled,
    volume: rec?.volume ?? 100,
    fader: dspChannel?.fader ?? 100,
    lpfOn: dspChannel?.lpfHz != null,
    lpfHz: dspChannel?.lpfHz ?? 200,
    modulation: rec?.modulation ?? 'frequency',
    frequency: rec?.frequency ?? 0,
    frequencyMax: rec?.frequencyMax ?? 0,
    amplitude: rec?.amplitude ?? 0,
    amplitudeMax: rec?.amplitudeMax ?? 0,
  };

  return (
    <div style={{ position: 'relative' }}>
      <Form
        // Identity-only — deliberately NOT tied to any editable field's
        // *value* (fader/lpfHz/volume/tyre/...). Remounting on every value
        // change was the original design (to pick up external updates,
        // since per-form's Form only reads `initialValues` once at mount —
        // see useForm.ts), but it back fired: our own commits echo straight
        // back down as new props, so editing a value immediately remounted
        // the very Form the user was editing — collapsing any open Section
        // (its own open/closed state resets on remount) and, worse, racing
        // against in-flight local state like lpfOnLocal. Row/channel *rows*
        // being created or swapped (toggling a cell on/off, switching
        // profiles, loading a different mix) still change `rec?.id`/
        // `dspChannel?.id`, so a real remount-worthy identity change is still
        // caught — just not routine edits to a row that already exists.
        // dspEnabled/showDsp still forces a remount since that swaps the
        // schema shape entirely (dspOnSchema vs dspOffSchema).
        key={identity}
        form={schema}
        name="effect"
        initialValues={initialValues}
        onChange={(_name: string, { clean }: any) => {
          pending.current = clean;
          if (skipFirst.current) { skipFirst.current = false; prevRef.current = clean; return; }
          if (!dragging.current) commit(clean);
        }}
      />
      {showDsp && (
        <div style={{ position: 'absolute', top: 0, right: 0 }}>
          <IconButton title={muted ? 'Unmute' : 'Mute'} onClick={() => onDspChange!({ muted: !muted })}>
            <Icon iconName={muted ? 'Volume0' : 'Volume3'} style={{ color: muted ? theme.palette.redDark : undefined }} />
          </IconButton>
        </div>
      )}
    </div>
  );
};
