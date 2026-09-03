import { useCallback, useRef } from 'react';
import { LiveUpdatesHub, useHubListener } from './liveUpdatesHub';

/// The head movement Assetto Corsa actually applied, in car-local metres
/// relative to the driver's rest eye position (x right, y up, z forward).
export interface NeckFxSample {
  /// Head POSITION relative to the driver's rest eye point, car-local metres.
  x: number;
  y: number;
  z: number;
  /// Head ROTATION relative to the car, degrees.
  ///
  /// Preferred over the position above: NeckFX's effects (TRACK_FOLLOWING,
  /// SLIDING_LOOK, STEERING) all change where the head LOOKS, so on a typical
  /// configuration the position barely moves while these do. Measured that way
  /// on this rig — position-only reported near zero through hard cornering.
  ///
  /// Also the natural unit for the consumers, which pan in degrees; the
  /// position channel had to be converted through an invented degrees-per-metre
  /// gain, and this needs no such fudge.
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /// Whether the three above are real. Distinct from them being zero, which is
  /// also what a centred head looks like — consumers must fall back to their
  /// g-derived approximation rather than treating a zero as a measurement.
  active: boolean;
  /// `performance.now()` when this arrived. See `neckFxIsLive`.
  receivedAt: number;
}

const REST: NeckFxSample = {
  x: 0, y: 0, z: 0,
  yawDeg: 0, pitchDeg: 0, rollDeg: 0,
  active: false, receivedAt: 0,
};

/// How long a sample stays trusted with nothing newer behind it.
///
/// The backend emits nothing at all while AC is closed (its stream yields
/// None, and those are filtered out rather than sent 60 times a second as
/// empty events), so silence is the ONLY signal that the game went away —
/// without an age check the last offset received would stay latched forever.
/// Generous against a frame hitch at 60Hz, still quick enough that quitting
/// the game hands back to the g-derived sway within half a second.
const STALE_AFTER_MS = 500;

/// Whether a sample should be used, as opposed to falling back. Lives here so
/// both sway consumers apply the same rule rather than each inventing one.
export function neckFxIsLive(sample: NeckFxSample | null | undefined): boolean {
  return (
    !!sample && sample.active && performance.now() - sample.receivedAt < STALE_AFTER_MS
  );
}

/// Assetto Corsa's applied head movement, for the NeckFX sway loops.
///
/// Rides the shared hub rather than opening its own subscription — the hub is
/// where every live signal in the app is collected, precisely so adding one
/// more consumer costs zero extra connections (see liveUpdatesHub's own doc
/// comment on the per-origin pool exhaustion that motivated it). The `enabled`
/// flag here only stops this hook *listening*; the hub itself has to be opened
/// with `includeAcTelemetry`, which is what actually decides whether the
/// backend puts these frames on the wire.
///
/// Returns a ref, and never calls setState. Frames arrive at 60Hz and both
/// consumers read them from inside a requestAnimationFrame loop, so routing
/// this through React state would re-render the dashboard 60 times a second to
/// animate a transform — the failure this app has hit twice already (see
/// useGlobalNightMode's tickThrottleMs and DayNightSimPanel's React.memo).
/// `useHubListener` reads the callback through a ref and the subscriber leaf
/// renders null, so nothing re-renders unless a callback sets state, and this
/// one doesn't.
export function useAcNeckFx(
  hub: LiveUpdatesHub | null | undefined,
  enabled: boolean,
): React.RefObject<NeckFxSample> {
  const ref = useRef<NeckFxSample>({ ...REST });

  const onFrame = useCallback((event: any) => {
    ref.current = {
      x: event?.neckOffsetX ?? 0,
      y: event?.neckOffsetY ?? 0,
      z: event?.neckOffsetZ ?? 0,
      yawDeg: event?.neckYawDeg ?? 0,
      pitchDeg: event?.neckPitchDeg ?? 0,
      rollDeg: event?.neckRollDeg ?? 0,
      // In replays and for remote cars online the cockpit camera offset isn't
      // meaningful, and the Lua app says so rather than sending a
      // plausible-looking zero.
      active: !!event?.physicsAvailable,
      receivedAt: performance.now(),
    };
  }, []);

  // Passing `undefined` rather than not calling the hook is the established
  // way to listen conditionally here without breaking the rules of hooks.
  useHubListener(hub, 'AcTelemetry', enabled ? onFrame : undefined);

  // Switching sway off mid-session should hand back immediately rather than
  // waiting out STALE_AFTER_MS.
  if (!enabled && ref.current.active) ref.current = { ...REST };

  return ref;
}

export default useAcNeckFx;
