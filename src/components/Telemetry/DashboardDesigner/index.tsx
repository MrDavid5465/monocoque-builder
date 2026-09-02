import React, { useState, useMemo, useRef, useEffect, useCallback, useContext } from 'react';
import { Stack, IconButton, getTheme, useQuery, useMutation } from '../../../lib/denim/lib';
import dispatcher from '../../../lib/denim/lib/queries';
import { useNavigate } from 'react-router';
import Canvas, { CanvasTool } from './Canvas';
import ObjectExplorer from './ObjectExplorer';
import { Photo360Handle } from './components/Photo360Viewer';
import Photo360CrossfadeViewer from './components/Photo360CrossfadeViewer';
import { useDashboard } from './useDashboard';
import { useTemplates } from './useTemplates';
import { builtInSprites } from '../../../mock/dashboardMock';
import { useTelemetryPlayback, computeStaticFrame, SequenceConfig, DEFAULT_SWEEP_CONFIG } from './useTelemetryPlayback';
import { computeTelemetryValues } from '../useLiveTelemetry';
import { useAcNeckFx } from '../useAcNeckFx';
import { useMappingWatcher } from '../useMappingWatcher';
import { useGlobalNightMode } from '../useGlobalNightMode';
import { useGlobalPreviewCar } from '../useGlobalPreviewCar';
import { LiveUpdatesContext, useHubListener, useLiveUpdatesDemand, useLiveUpdatesHub } from '../liveUpdatesHub';
import { ClockTimeContext } from './clockTimeContext';
import { GET_CARS, parseCarIds, CarRecord } from '../carQueries';
import { GET_CAR_DASH_PANS, ADD_CAR_DASH_PAN, UPDATE_CAR_DASH_PAN, REMOVE_CAR_DASH_PAN, CarDashPanRecord } from '../carDashPanQueries';
import { DashboardConfig, ComponentNode } from '../../../types/dashboard';
import {
  findNodeById,
  updateNodeById,
  deleteNodeById,
  addChildToNode,
  flattenNodes,
  moveNode,
  isDescendantOf,
} from './components/utils';
import { captureAllNodeThumbnails, captureNodeThumbnail } from './useScreenshot';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';

interface Props {
  dashboardName: string;
  kioskMode: boolean;
}

// Floating-toolbar action: icon button with its label to the right, both
// tinted the same color so an "active" state (e.g. Night is on) reads at a
// glance without a filled button background.
const ToolbarIconButton: React.FC<{
  icon: string;
  label: string;
  onClick: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
}> = ({ icon, label, onClick, title, active, disabled }) => {
  const theme = getTheme();
  const color = disabled ? theme.palette.neutralTertiaryAlt : active ? theme.palette.themePrimary : theme.palette.neutralPrimary;
  return (
    <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 2 }}>
      <IconButton
        iconProps={{ iconName: icon }}
        onClick={onClick}
        title={title}
        disabled={disabled}
        styles={{ root: { height: 28, width: 28 }, icon: { color, fontSize: 16 } }}
      />
      <span
        onClick={disabled ? undefined : onClick}
        style={{ color, fontSize: '0.82em', cursor: disabled ? 'default' : 'pointer', userSelect: 'none' }}
      >
        {label}
      </span>
    </Stack>
  );
};

const MOBILE_BREAKPOINT = 768;
const MIN_EXPLORER_HEIGHT = 120;
const MAX_EXPLORER_HEIGHT = 600;
const DEFAULT_EXPLORER_HEIGHT = 280;

// Telemetry's `values` record is flat (string -> number), so a one-level
// key comparison is enough — no need for a general deep-equal utility.
function shallowEqualRecord(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

const DashboardDesigner: React.FC<Props> = ({ dashboardName, kioskMode }) => {
  const navigate = useNavigate();
  const theme = getTheme();
  const border = `1px solid ${theme.palette.neutralLight}`;

  // useCallback so this stays a stable prop reference into Canvas (now
  // React.memo'd — see Canvas.tsx's own comment on why a fresh function
  // identity on every ~60Hz simTimeMs tick would defeat that memo).
  const handleKioskButton = useCallback(() => {
    if (kioskMode) navigate(-1);
    else navigate(`/dashboards/dashboards/${encodeURIComponent(dashboardName)}/show`);
  }, [kioskMode, navigate, dashboardName]);

  const { dashboard, setDashboard, saveDashboard, deleteDashboard, savePanCoordinates, savePhotoEditing, uploadSprite, deleteSprite, refetchSprites, copyBuiltinSprite, uploadSpriteData, uploadBackground, isDirty, sprites, loading, canvasRef, forceNightPreview, handleDashboardUpdate } = useDashboard(dashboardName);

  // Undo/redo — every edit funnels through trackedSetDashboard below (see the
  // 6 call sites that use it in place of the raw setDashboard). Rapid-fire
  // changes from the same gesture (dragging a slider, dragging a transform
  // handle, panning a 360 view) are coalesced into a single undo step by only
  // pushing a new snapshot when more than UNDO_COALESCE_MS has passed since
  // the last change — otherwise every pointermove during a drag would become
  // its own undo step. undo()/redo() themselves call the RAW setDashboard,
  // never trackedSetDashboard, since restoring a snapshot isn't itself a new
  // edit to record.
  const UNDO_COALESCE_MS = 400;
  const MAX_HISTORY = 100;
  const undoStackRef = useRef<DashboardConfig[]>([]);
  const redoStackRef = useRef<DashboardConfig[]>([]);
  const lastChangeAtRef = useRef(0);
  // The value itself is never read — its only job is forcing a re-render
  // when the (ref-based, so otherwise invisible to React) undo/redo stacks
  // change, so canUndo/canRedo below reflect the current stack state.
  const [, setHistoryTick] = useState(0);
  // Bumped whenever a canvas move/resize drag ends, OR an undo/redo fires, so
  // the properties panel's uncontrolled Form (which snapshots values once at
  // mount) re-syncs to the node's live x/y/width/height instead of showing
  // stale values from before the drag/undo/redo.
  const [formRevision, setFormRevision] = useState(0);
  const handleDragCommit = useCallback(() => setFormRevision(r => r + 1), []);

  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryTick(t => t + 1);
  }, [dashboardName]);

  const trackedSetDashboard = useCallback((updater: React.SetStateAction<DashboardConfig | null>) => {
    setDashboard(prev => {
      const next = typeof updater === 'function'
        ? (updater as (p: DashboardConfig | null) => DashboardConfig | null)(prev)
        : updater;
      if (prev && next && next !== prev) {
        const now = Date.now();
        if (now - lastChangeAtRef.current > UNDO_COALESCE_MS) {
          undoStackRef.current.push(prev);
          if (undoStackRef.current.length > MAX_HISTORY) undoStackRef.current.shift();
          redoStackRef.current = [];
          setHistoryTick(t => t + 1);
        }
        lastChangeAtRef.current = now;
      }
      return next;
    });
  }, [setDashboard]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const snapshot = undoStackRef.current.pop()!;
    setDashboard(current => {
      if (current) redoStackRef.current.push(current);
      return snapshot;
    });
    lastChangeAtRef.current = 0;
    setHistoryTick(t => t + 1);
    // The properties panel's Form is uncontrolled (snapshots values once at
    // mount) — without this it would keep showing pre-undo values even
    // though the underlying node data reverted correctly.
    setFormRevision(r => r + 1);
  }, [setDashboard]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const snapshot = redoStackRef.current.pop()!;
    setDashboard(current => {
      if (current) undoStackRef.current.push(current);
      return snapshot;
    });
    lastChangeAtRef.current = 0;
    setHistoryTick(t => t + 1);
    setFormRevision(r => r + 1);
  }, [setDashboard]);

  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  // Ctrl+Z / Ctrl+Y — skipped while typing in a text field, or in kiosk mode.
  useEffect(() => {
    if (kioskMode) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing) return;
      if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
      else if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, kioskMode]);
  const builtInSpriteFileSet = useMemo(() => new Set(builtInSprites.map(s => s.file)), []);
  const { data: myData } = useQuery(dispatcher.my, { fetchPolicy: 'cache-first' });
  const globalSteerMaxDeg: number = (myData as any)?.my?.settings?.steerMaxDeg ?? 400;
  const gamepadMappings = (myData as any)?.my?.settings?.gamepadMappings ?? [];
  // Local state (not a plain derived const, unlike globalSteerMaxDeg above)
  // because these two also update live from HuenicornSettingsChanged (see
  // the useHubListener call below `hub` is defined) — so a settings change
  // made from a different window/device (e.g. the Ambient Lights page on
  // another tablet) reaches an already-open kiosk dashboard without a
  // reload, the same live-config problem NightModeChanged already solves
  // for night-mode settings.
  const settingsAmbientTintIntensity: number = (myData as any)?.my?.settings?.ambientTintIntensity ?? 0;
  const settingsAmbientPrimaryChannel: number | null =
    (myData as any)?.my?.settings?.ambientPrimaryChannel ?? null;
  const settingsAmbientSaturationBoostDay: number =
    (myData as any)?.my?.settings?.ambientSaturationBoostDay ?? 1;
  const settingsAmbientSaturationBoostNight: number =
    (myData as any)?.my?.settings?.ambientSaturationBoostNight ?? 1;
  const [ambientTintIntensity, setAmbientTintIntensity] = useState(settingsAmbientTintIntensity);
  const [ambientPrimaryChannel, setAmbientPrimaryChannel] = useState(settingsAmbientPrimaryChannel);
  const [ambientSaturationBoostDay, setAmbientSaturationBoostDay] = useState(settingsAmbientSaturationBoostDay);
  const [ambientSaturationBoostNight, setAmbientSaturationBoostNight] = useState(settingsAmbientSaturationBoostNight);
  useEffect(() => {
    setAmbientTintIntensity(settingsAmbientTintIntensity);
  }, [settingsAmbientTintIntensity]);
  useEffect(() => {
    setAmbientPrimaryChannel(settingsAmbientPrimaryChannel);
  }, [settingsAmbientPrimaryChannel]);
  useEffect(() => {
    setAmbientSaturationBoostDay(settingsAmbientSaturationBoostDay);
  }, [settingsAmbientSaturationBoostDay]);
  useEffect(() => {
    setAmbientSaturationBoostNight(settingsAmbientSaturationBoostNight);
  }, [settingsAmbientSaturationBoostNight]);
  const { templates, saveTemplate, removeTemplate, uploadThumbnail, refetchTemplates } = useTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewing360, setViewing360] = useState(false);
  const viewer360Ref = useRef<Photo360Handle>(null);
  const [panBgMode, setPanBgMode] = useState(false);
  const [activeTool, setActiveTool] = useState<CanvasTool>('transform');
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('left');
  const [explorerHeight, setExplorerHeight] = useState(DEFAULT_EXPLORER_HEIGHT);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  const isMobile = windowWidth < MOBILE_BREAKPOINT;

  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (kioskMode) setSelectedId(null);
  }, [kioskMode]);

  // When this device's mapping changes while in kiosk mode, re-resolve the route.
  const [liveValues, setLiveValues] = useState<Record<string, number>>({});
  const [car, setCar] = useState('');
  const [track, setTrack] = useState('');
  const [simStatus, setSimStatus] = useState('');

  // This is the ONE place on a DashboardDesigner page that opens the real
  // dashboardUpdates subscription — every event type it carries (dashboard/
  // template/device-default/telemetry/night-mode/night-clock/preview-car/
  // car-dash-pan) is demultiplexed from this single connection by the hub,
  // and re-provided via context below so anything nested under this tree
  // (DayNightSimPanel, via Canvas.tsx's gear popup) shares it automatically
  // instead of opening a second connection. See liveUpdatesHub.tsx's own
  // doc comment for why this matters beyond just one page: several
  // dashboard kiosk windows open at once (all sharing one browser's
  // per-origin HTTP/1.1 connection budget) used to need 4 separate
  // subscriptions *each*, exhausting that shared budget with just 2 windows
  // open (confirmed live — one window's requests stalled until the other's
  // connections were released).
  // Normally the app-root provider (see App.tsx), in which case nothing is
  // opened here at all. The own-hub fallback stays for the case where this is
  // rendered outside that provider — same established pattern as
  // useGlobalNightMode/Controls.
  const ambientHub = useContext(LiveUpdatesContext);
  const [ownHub, hubSubscriber] = useLiveUpdatesHub({
    // Skip until dashboard is loaded — avoids a useSyncExternalStore commit
    // during the initial mount burst when Apollo is already processing
    // multiple queries.
    skip: !!ambientHub || !dashboard,
    includeNightClock: false,
  });
  const hub = ambientHub ?? ownHub;

  // What this dashboard needs the shared connection to carry. Declared as a
  // demand rather than as options on a private hub, so it reaches whichever
  // hub is actually in use and is withdrawn when this unmounts.
  useLiveUpdatesDemand(hub, {
    includeTelemetry: kioskMode,
    // includeNightClock is deliberately NOT declared here: useGlobalNightMode
    // below demands it for itself, in both modes, and it is the thing that
    // actually consumes the tick. Declaring it here too would mean two places
    // deciding when the clock streams, which is how the editor ended up
    // frozen (see that call's own comment).
    // Only a kiosk 360 dashboard with the feature actually dialed up needs
    // this stream; the editor never does.
    includeAmbientColor: kioskMode && ambientTintIntensity > 0,
    // Same again for Assetto Corsa's head movement: the highest-rate member
    // on this stream, and only a kiosk dashboard with NeckFX sway switched on
    // has any use for it.
    includeAcTelemetry: kioskMode && !!dashboard?.neckFx,
  });

  // liveClock is on in BOTH modes, throttled instead of switched off outside
  // kiosk. It used to be `liveClock: kioskMode`, which left the editor with no
  // clock ticks at all — so simTimeMs and lightSuggestion fell back to
  // GET_NIGHT_CLOCK_SNAPSHOT, a one-shot query with no poll, and the editor's
  // day/night froze at whatever the clock read when the page was loaded.
  // Harmless when the simulated clock ran near real time; obvious once it can
  // run at 1200% (a 2-hour day) or be overridden by the game's own clock,
  // where a page open for a while showed deep night against a 6am session.
  //
  // 1Hz outside kiosk keeps the reason that flag existed — the editor must not
  // re-render at the tick's native ~60Hz — while still tracking reality. Same
  // trade DayNightSimPanel already makes for the same reason.
  const { isNight, nightAmount, simTimeMs, toggleNightMode } = useGlobalNightMode(hub, {
    liveClock: true,
    tickThrottleMs: kioskMode ? 0 : 1000,
  });

  // v1 picks one channel from the per-channel array to actually drive the
  // 360 viewer's tint (the wire format already carries all channels — see
  // AmbientColorChanged's own doc comment — so a later per-region effect is
  // additive, not a rework). Prefers the user's ambientPrimaryChannel pick
  // (AmbientLights/index.tsx's select field); falls back to whichever
  // channel Huenicorn reports first if unset or not found.
  const [ambientColor, setAmbientColor] = useState<{ r: number; g: number; b: number } | null>(null);
  // The element Canvas paints the ambient tint into when its night overlay is
  // up (that overlay would otherwise swallow an in-shader tint). Stable
  // identity, written imperatively by Photo360Viewer's render loop — so it is
  // deliberately NOT in kioskLive360Deps below.
  const ambientOverlayRef = useRef<HTMLDivElement>(null);
  useHubListener(hub, 'AmbientColorChanged', kioskMode ? (event: any) => {
    const colors = event?.colors ?? [];
    const picked = (ambientPrimaryChannel != null
      ? colors.find((c: any) => c.channelId === ambientPrimaryChannel)
      : undefined) ?? colors[0];
    setAmbientColor(picked ? { r: picked.r, g: picked.g, b: picked.b } : null);
  } : undefined);
  // Unconditional (not kioskMode-gated like AmbientColorChanged above) —
  // HuenicornSettingsChanged is cheap/low-frequency (only fires on an
  // actual settings save), so there's no cost concern gating it the way
  // the ~30Hz color stream needs.
  useHubListener(hub, 'HuenicornSettingsChanged', (event: any) => {
    setAmbientTintIntensity(event.ambientTintIntensity);
    setAmbientPrimaryChannel(event.ambientPrimaryChannel ?? null);
    setAmbientSaturationBoostDay(event.ambientSaturationBoostDay ?? 1);
    setAmbientSaturationBoostNight(event.ambientSaturationBoostNight ?? 1);
  });
  const { previewCarId } = useGlobalPreviewCar(hub);

  const { data: carsData, refetch: refetchCars } = useQuery(GET_CARS, {
    skip: dashboard?.baseDashType !== '360',
    fetchPolicy: 'cache-and-network',
  });
  const cars: CarRecord[] = (carsData as any)?.getCars ?? [];

  const { data: carDashPansData, refetch: refetchCarDashPans } = useQuery(GET_CAR_DASH_PANS, {
    skip: dashboard?.baseDashType !== '360',
    fetchPolicy: 'cache-and-network',
  });
  const carDashPans: CarDashPanRecord[] =
    (carDashPansData as any)?.getCarDashPans ?? [];

  // A per-car pan override edited on the Cars page (DashPanEditor) must reach
  // an already-open kiosk live — that's the whole point of previewing pan
  // edits without needing to actually drive the car. The list is small, so a
  // full refetch on any change is simpler and safer than merging the payload
  // into local state by hand.
  const onCarDashPanChanged = useCallback(() => { refetchCarDashPans(); }, [refetchCarDashPans]);
  useHubListener(hub, 'CarDashPanChanged', dashboard?.baseDashType === '360' ? onCarDashPanChanged : undefined);

  // Which car a dashboard shows can change with no dashboard edit at all —
  // starring a different favourite is the case that exposed this, since with
  // no live sim the favourite IS the displayed car. Refetches the list rather
  // than patching the one record in the event: `favorite` is a cross-record
  // invariant (promoting one demotes another), so a partial update would
  // leave two cars looking starred.
  const onCarChanged = useCallback(() => { refetchCars(); }, [refetchCars]);
  useHubListener(hub, 'CarChanged', dashboard?.baseDashType === '360' ? onCarChanged : undefined);

  const { handleDeviceDefaultEvent } = useMappingWatcher(
    () => navigate('/dashboards/default', { replace: true }),
    !kioskMode,
    car,
    simStatus,
    track,
  );

  useHubListener(hub, 'DashboardEntryChanged', handleDashboardUpdate);
  // Sprites live in the dashboard's own file table, not its content, so a
  // file upload/delete leaves the content byte-identical — handleDashboardUpdate
  // above deliberately bails on that, which is why file changes need their own
  // signal (backend publishes operationName 'files'; see dashboard_files.rs).
  const onDashboardFilesChanged = useCallback((event: any) => {
    if (event?.operationName !== 'files') return;
    if (event?.value?.name !== dashboardName) return;
    refetchSprites();
  }, [dashboardName, refetchSprites]);
  useHubListener(hub, 'DashboardEntryChanged', onDashboardFilesChanged);
  useHubListener(hub, 'DashTemplateChanged', refetchTemplates);
  useHubListener(hub, 'DeviceDefaultChanged', kioskMode ? handleDeviceDefaultEvent : undefined);

  // computeTelemetryValues builds a brand-new `values` object on every call
  // (even `{}` when there's no live frame at all), so calling setLiveValues
  // unconditionally at the subscription's ~60Hz tick rate committed a new
  // object reference every single tick regardless of whether any value
  // actually changed — a permanent re-render source for the whole
  // DashboardDesigner tree. setCar/setSimStatus don't have this problem
  // (React already bails out of a state update when the new value is a
  // primitive `Object.is`-equal to the old one), only the object-valued
  // `values` does. liveValuesRef mirrors the last *committed* values so
  // this can compare-before-set without depending on stale closure state.
  const liveValuesRef = useRef<Record<string, number>>({});
  const onTelemetryEvent = useCallback((event: any) => {
    const { values, car: c, track: trk, simStatus: s } = computeTelemetryValues(event.frame);
    if (!shallowEqualRecord(liveValuesRef.current, values)) {
      liveValuesRef.current = values;
      setLiveValues(values);
    }
    setCar(c);
    setTrack(trk);
    setSimStatus(s);
  }, []);
  // Not registered at all while editing — baseTelemetry (below) only reads
  // liveValues when `kioskMode && kioskSweepDone`; the editor always shows
  // playbackData (manual/sweep test data) instead, and the hub doesn't even
  // request TelemetryEvent from the server when includeTelemetry is false,
  // so this is purely a "would never fire anyway" guard, not a real gate.
  useHubListener(hub, 'TelemetryEvent', kioskMode ? onTelemetryEvent : undefined);

  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(DEFAULT_EXPLORER_HEIGHT);

  const onResizeStart = (e: React.MouseEvent) => {
    resizingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = explorerHeight;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = startYRef.current - e.clientY;
      setExplorerHeight(Math.max(MIN_EXPLORER_HEIGHT, Math.min(MAX_EXPLORER_HEIGHT, startHeightRef.current + delta)));
    };
    const onUp = () => { resizingRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Persisted with the dashboard (DashboardConfig.sequenceConfig) — not local
  // state. See onSequenceConfigChange below (defined after updateDashboard).
  const sequenceConfig = dashboard?.sequenceConfig ?? DEFAULT_SWEEP_CONFIG;
  const [playing, setPlaying] = useState(false);
  const [kioskSweepDone, setKioskSweepDone] = useState(false);
  const [previewTelemetry, setPreviewTelemetry] = useState<Record<string, number> | null>(null);
  // Editor-only manual "preview position" (0–1) — holds every bound field at
  // a fixed fraction so elements that are otherwise invisible at rest (e.g. a
  // sprite-arc-fill or a hidden-below-inputMin needle) can be seen and placed
  // without running a sweep. Persists across edits; automatically suppressed
  // while a sweep/sine test is actually playing (see telemetryData below) and
  // reasserts itself once the test stops.
  const [manualPreviewFraction, setManualPreviewFraction] = useState<number | null>(null);
  // Editor-only test-sequence override: the manual edit-mode Play sweep
  // normally already ignores each binding's startupSweep opt-out (that's
  // the kiosk boot sweep's job, not this one) — unchecking this lets you
  // preview the real kiosk boot sweep's opt-out behaviour instead, without
  // needing to launch kiosk mode. Ephemeral (not persisted with the dashboard).
  const [forceAllParticipate, setForceAllParticipate] = useState(true);

  const activeSequence = useMemo<SequenceConfig | null>(() => {
    if (kioskMode) return kioskSweepDone ? null : sequenceConfig;
    return playing ? sequenceConfig : null;
  }, [kioskMode, kioskSweepDone, playing, sequenceConfig]);

  const flatNodes = useMemo(() => dashboard ? flattenNodes(dashboard.components) : [], [dashboard]);
  // The manual edit-mode test sweep always sweeps every bound field — that's
  // its job. The kiosk boot sweep is a cosmetic startup animation and
  // respects each binding's opt-out (binding.startupSweep === false).
  const startupSweepNodes = useMemo(
    () => flatNodes.filter(n => n.binding?.startupSweep !== false),
    [flatNodes],
  );
  const sweepNodes = kioskMode ? startupSweepNodes : (forceAllParticipate ? flatNodes : startupSweepNodes);
  const playbackData = useTelemetryPlayback(
    activeSequence,
    sweepNodes,
    () => { if (kioskMode) setKioskSweepDone(true); else setPlaying(false); },
  );
  const baseTelemetry = kioskMode && kioskSweepDone ? liveValues : playbackData;
  const manualFrame = useMemo(
    () => (!kioskMode && !playing && manualPreviewFraction !== null)
      ? computeStaticFrame(manualPreviewFraction, flatNodes)
      : null,
    [kioskMode, playing, manualPreviewFraction, flatNodes],
  );
  // previewTelemetry (binding min/max drag preview) now stays pinned after
  // release instead of clearing — see ObjectExplorer's ComponentPropertiesPanel
  // — so it must defer to an actual test playing, same as manualFrame above,
  // or Play would never be able to override a still-pinned preview value.
  const previewOverride = !playing ? previewTelemetry : null;
  const telemetryData = { ...baseTelemetry, ...(manualFrame ?? {}), ...(previewOverride ?? {}) };

  // Assetto Corsa's applied head movement. Not folded into telemetryData
  // above — that frame is cross-sim and must not carry AC-only fields — but
  // it rides the SAME hub connection as everything else, so one more live
  // signal costs no extra socket. Read once here and handed to both sway
  // consumers (Canvas and the 360 viewer).
  //
  // `dashboard?.` — this sits above the component's null-dashboard guard,
  // because a hook can't be called conditionally. No dashboard means no sway,
  // which is the right answer anyway.
  const neckFxSampleRef = useAcNeckFx(hub, !!dashboard?.neckFx);
  const getCanvasEl = useCallback(
    () => canvasRef.current?.getCanvasEl() ?? null,
    [canvasRef],
  );

  const generateThumbnails = useCallback(async () => {
    if (!dashboard) return new Map<string, string>();
    return captureAllNodeThumbnails(getCanvasEl, dashboard.components, dashboard.canvasWidth, dashboard.canvasHeight);
  }, [getCanvasEl, dashboard]);

  const handleSaveTemplate = useCallback(async (node: ComponentNode) => {
    const id = await saveTemplate(node, sprites);
    if (!id) return;
    if (!dashboard) return;
    const thumb = await captureNodeThumbnail(getCanvasEl, node, dashboard.canvasWidth, dashboard.canvasHeight);
    if (thumb) await uploadThumbnail(id, thumb);
  }, [saveTemplate, sprites, uploadThumbnail, getCanvasEl, dashboard]);

  const updateNode = useCallback((id: string, patch: Partial<ComponentNode>) => {
    trackedSetDashboard(prev => {
      if (!prev) return prev;
      const node = findNodeById(prev.components, id);
      if (!node) return prev;

      const finalPatch = { ...patch };

      if (node.type === 'needle-gauge' && patch.type === undefined) {
        if (patch.width !== undefined && (node.width ?? 1) > 0 && node.rotationX !== undefined) {
          finalPatch.rotationX = Math.round(node.rotationX * patch.width / (node.width ?? 1));
        }
        if (patch.height !== undefined && (node.height ?? 1) > 0 && node.rotationY !== undefined) {
          finalPatch.rotationY = Math.round(node.rotationY * patch.height / (node.height ?? 1));
        }
      }

      return { ...prev, components: updateNodeById(prev.components, id, finalPatch) };
    });
  }, [trackedSetDashboard]);

  const updateDashboard = useCallback((patch: Partial<DashboardConfig>) => {
    trackedSetDashboard(prev => prev ? { ...prev, ...patch } : prev);
  }, [trackedSetDashboard]);

  const onSequenceConfigChange = useCallback((c: SequenceConfig) => {
    updateDashboard({ sequenceConfig: c });
  }, [updateDashboard]);

  const enter360Edit = useCallback(async () => {
    // Local state FIRST, persistence after. This used to await the mutation
    // before flipping, which left a window — as long as that round trip took
    // — where the 360 was already on screen (dashboards with photo360LiveKiosk
    // show it before editing starts) but not yet interactive, so a drag in
    // that window panned the canvas instead of the photo. The window is
    // invisible on a cold load, where the mutation resolves promptly, and
    // wide after client-side navigation, where it queues behind an
    // already-streaming subscription — which is exactly the reported
    // "navigate, edit, drag" repro against "refresh, edit, drag".
    //
    // Nothing local depends on the write: photo360Editing exists so KIOSK
    // screens know to switch to the live viewer, which is not urgent here.
    setViewing360(true);
    await savePhotoEditing(true);
  }, [savePhotoEditing]);

  const save360 = useCallback(async () => {
    if (!dashboard) return;
    if (!dashboard.photo360LiveKiosk && viewer360Ref.current) {
      const overflow = dashboard.bgOverflow ?? 0;
      const captureW = dashboard.canvasWidth + overflow * 2;
      const captureH = dashboard.canvasHeight + overflow * 2;
      const dataUrl = await viewer360Ref.current.capture(captureW, captureH);
      if (dataUrl) await uploadBackground(dataUrl);
    }
    await savePhotoEditing(false);
    setViewing360(false);
  }, [dashboard, uploadBackground, savePhotoEditing]);

  const cancel360 = useCallback(async () => {
    await savePhotoEditing(false);
    setViewing360(false);
  }, [savePhotoEditing]);

  const addNode = useCallback((node: ComponentNode, parentId: string | null) => {
    trackedSetDashboard(prev => prev ? {
      ...prev,
      components: addChildToNode(prev.components, parentId, node),
    } : prev);
    setSelectedId(node.id);
  }, [trackedSetDashboard]);

  const deleteNode = useCallback((id: string) => {
    trackedSetDashboard(prev => prev ? {
      ...prev,
      components: deleteNodeById(prev.components, id),
    } : prev);
    setSelectedId(prev => prev === id ? null : prev);
  }, [trackedSetDashboard]);

  const handleMoveNode = useCallback((nodeId: string, targetId: string, mode: 'before' | 'after' | 'inside') => {
    trackedSetDashboard(prev => {
      if (!prev || nodeId === targetId) return prev;
      if (isDescendantOf(prev.components, nodeId, targetId)) return prev;
      return { ...prev, components: moveNode(prev.components, nodeId, targetId, mode) };
    });
  }, [trackedSetDashboard]);

  // Assigned during render once the displayed car is known (see panCarId
  // below); read here rather than depended on, so a drag's ~60Hz of changes
  // doesn't rebuild this handler.
  const [addCarDashPan] = useMutation(ADD_CAR_DASH_PAN);
  const [updateCarDashPan] = useMutation(UPDATE_CAR_DASH_PAN);
  const [removeCarDashPan] = useMutation(REMOVE_CAR_DASH_PAN);
  const panTargetRef = useRef<{ carId: string; dashName: string; existingId?: string } | null>(null);
  // The row this component just created, so the rest of a drag updates it
  // instead of adding a second one — the refetch that would otherwise supply
  // the id arrives a round trip later. Carries which car/dash it belongs to,
  // so it can't be reused for a different one.
  const createdCarPanIdRef = useRef<{ id: string; carId: string; dashName: string } | undefined>(undefined);
  const carPanSaveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Same 800ms debounce as savePanCoordinates: onChange fires continuously
  // while dragging, and each of these is a mutation.
  const saveCarPan = useCallback((y: number, p: number, f: number, r: number) => {
    // Captured NOW, not when the timer fires: if the displayed car changes
    // within the debounce window, a pending edit must still belong to the car
    // it was made on rather than landing on whatever came into view.
    const target = panTargetRef.current;
    if (!target) return;
    if (carPanSaveTimeoutRef.current) clearTimeout(carPanSaveTimeoutRef.current);
    carPanSaveTimeoutRef.current = setTimeout(() => {
      const pan = { yaw: y, pitch: p, fov: f, roll: r };
      const created = createdCarPanIdRef.current;
      const existingId =
        target.existingId
        ?? (created && created.carId === target.carId && created.dashName === target.dashName
          ? created.id
          : undefined);
      if (existingId) {
        updateCarDashPan({ variables: { id: existingId, update: pan } });
      } else {
        addCarDashPan({
          variables: { values: { carId: target.carId, dashName: target.dashName, ...pan } },
        }).then((res: any) => {
          const id = res?.data?.addCarDashPan?.id;
          if (id) createdCarPanIdRef.current = { id, carId: target.carId, dashName: target.dashName };
        });
      }
    }, 800);
  }, [addCarDashPan, updateCarDashPan]);

  // Editing a 360 here writes BOTH: the registration-specific pan for the car
  // currently on screen, and the dashboard's own base pan.
  //
  // The dashboard values stay the default any car without an override of its
  // own falls back to, so adjusting here still improves the general case. The
  // per-registration row is what makes the same edit reachable from either
  // end — the car page for one car, this designer for whatever is showing —
  // and land in the same place.
  const handle360Change = useCallback((y: number, p: number, f: number, r: number) => {
    trackedSetDashboard(prev => prev ? { ...prev, photo360Yaw: y, photo360Pitch: p, photo360Fov: f, photo360Roll: r } : prev);
    savePanCoordinates(y, p, f, r);
    saveCarPan(y, p, f, r);
  }, [trackedSetDashboard, savePanCoordinates, saveCarPan]);

  const handleFlip = useCallback(() => setPanelSide(s => s === 'left' ? 'right' : 'left'), []);
  const handleTogglePlay = useCallback(() => setPlaying(p => !p), []);
  const handleOnSave = useCallback(async () => {
    setSelectedId(null);
    await new Promise(r => requestAnimationFrame(r));
    await saveDashboard();
  }, [saveDashboard]);
  const handleDeleteDashboard = useCallback(async () => {
    await deleteDashboard();
    navigate('/dashboards/dashboards');
  }, [deleteDashboard, navigate]);

  // Manual memo cache (not useMemo) for kioskLive360 below — everything past
  // the `loading`/`!dashboard` early return right below this is plain JS,
  // no hooks, since this component's very first render (while loading) never
  // reaches past that return: any hook placed after it would be called on
  // some renders and not others, tripping React's "rendered more hooks than
  // previous render" the moment loading actually completes. This ref itself
  // is unconditional (safe) — the comparison logic that reads/writes it runs
  // after the early return, as ordinary code, not a hook.
  const kioskLive360CacheRef = useRef<{ deps: unknown[]; el: React.ReactNode } | null>(null);

  if (loading || !dashboard) return <div>Loading dashboard...</div>;

  const explorerProps = {
    dashboard,
    sprites,
    selectedId,
    onSelect: setSelectedId,
    onUpdate: updateNode,
    onUpdateDashboard: updateDashboard,
    onDelete: deleteNode,
    onFlip: handleFlip,
    isDirty,
    onSave: handleOnSave,
    onDeleteDashboard: handleDeleteDashboard,
    onMoveNode: handleMoveNode,
    formRevision,
    manualPreviewFraction,
    onManualPreviewFractionChange: setManualPreviewFraction,
    forceAllParticipate,
    onForceAllParticipateChange: setForceAllParticipate,
    onSaveTemplate: handleSaveTemplate,
    onGenerateThumbnails: generateThumbnails,
    sequenceConfig,
    onSequenceConfigChange,
    playing,
    onTogglePlay: handleTogglePlay,
    onPreviewTelemetry: setPreviewTelemetry,
    gamepadMappings,
    editing360: viewing360,
    onChange360: handle360Change,
    // Every per-car override for THIS dashboard, so the panel can say how
    // many there are before offering to drop them.
    carPanOverrideCount: carDashPans.filter(p => p.dashName === dashboard.name).length,
    onResetAllCarPans: async () => {
      const doomed = carDashPans.filter(p => p.dashName === dashboard.name);
      if (doomed.length === 0) return;
      const ok = await confirmAsync(
        `Reset ${doomed.length} per-car pan override${doomed.length === 1 ? '' : 's'} for "${dashboard.name}"? `
        + 'Every car will fall back to this dashboard\'s own pan.',
        { danger: true, confirmText: 'Reset all' },
      );
      if (!ok) return;
      await Promise.all(doomed.map(p => removeCarDashPan({ variables: { id: p.id } })));
      // The subscription refetches too, but this component may be the one
      // that just removed the row it was reading — don't wait for the round
      // trip to stop showing a pan that no longer exists.
      createdCarPanIdRef.current = undefined;
      refetchCarDashPans();
    },
    templates,
    onAdd: addNode,
    onRemoveTemplate: removeTemplate,
    onUpload: uploadSprite,
    onDeleteSprite: deleteSprite,
    builtInSpriteFiles: builtInSpriteFileSet,
    onCopyBuiltinSprite: copyBuiltinSprite,
    onUploadSpriteData: uploadSpriteData,
    onReloadSprites: refetchSprites,
  };

  const show360 = !kioskMode && dashboard.baseDashType === '360' && (viewing360 || !!dashboard.photo360LiveKiosk);

  // While a kiosk isn't actually seeing a live sim, fall back to the globally
  // selected "preview car" (set from a car's config page) so 360° photo/pan
  // edits can be previewed on kiosks without needing to actually drive that car.
  // Real telemetry always wins the moment the sim goes active.
  const effectiveCar = kioskMode && simStatus !== 'Active' && previewCarId ? previewCarId : car;

  // Car-specific 360 photo takes priority; fall back to the dashboard's configured default.
  // When the car has a night variant (same camera position, different
  // lighting), both URLs are handed to Photo360CrossfadeViewer, which
  // crossfades between them continuously as nightAmount changes instead of
  // cutting instantly.
  const matchedCar = cars.find(c => parseCarIds(c).includes(effectiveCar));
  const carPhoto360 = matchedCar;
  const carDayPhoto = carPhoto360?.dayPhoto;
  const carNightPhoto = carPhoto360?.nightPhoto;
  // The stand-in when the live car has no photo of its own: the car marked
  // favourite, rather than a sprite file configured per dashboard.
  //
  // The old `dashboard.photo360File` had to be chosen again on every
  // dashboard, and being a loose image it carried no night variant and no pan
  // alignment — so a fallback always looked wrong at night and sat at
  // whatever rotation the sprite happened to have. A Car brings its day
  // photo, its night photo and its alignment with it, and one choice covers
  // every dashboard.
  const favoriteCar = cars.find(c => c.favorite);
  const photo360Url = (ref?: { url: string }) =>
    ref ? `http://${window.location.hostname}:9000${ref.url}` : undefined;
  const dayPhoto360Url =
    photo360Url(carDayPhoto) ?? photo360Url(favoriteCar?.dayPhoto) ?? '';
  // Falls back to the favourite's night photo only when the day photo also
  // came from the favourite — mixing one car's day frame with another's night
  // frame would crossfade between two different cockpits.
  const nightPhoto360Url = carDayPhoto
    ? photo360Url(carNightPhoto)
    : photo360Url(favoriteCar?.nightPhoto);
  // Whether a distinct night photo is actually in play — derived from the
  // resolved URL, not from the matched car, so it stays true when the night
  // frame came from the favourite instead. Getting that wrong would leave
  // Canvas's generic darkening overlay un-suppressed while the crossfade
  // viewer was already handling night, darkening the scene twice.
  //
  // Not gated by the current nightAmount: Photo360CrossfadeViewer blends
  // correctly across the entire 0..1 range on its own, and gating by isNight
  // would flip the overlay back on partway through a transition.
  const hasCarNightPhoto = !!nightPhoto360Url;
  const photoUrl = show360 ? dayPhoto360Url : '';

  // Whether entering 360 edit mode would actually get a live viewer. Note this
  // deliberately does NOT depend on `show360` — that's already true whenever
  // we're editing, so using it would make this vacuous exactly when it matters.
  const live360Ready = !!dayPhoto360Url;

  // The car whose 360 is actually on screen — which is not always
  // `matchedCar`. When the matched car has no photo of its own the
  // favourite's is displayed instead (see dayPhoto360Url above), and the pan
  // being looked at, and edited, belongs to that photo.
  const displayedCar = carDayPhoto ? matchedCar : favoriteCar;

  // Which REGISTRATION the pan belongs to. One Car can carry several raw car
  // ids — the same physical car as it appears in different games — and they
  // share one 360 photo (captured once, in AC) but not one alignment: the
  // cockpit sits differently in each game, so each needs its own pan to line
  // the photo up. So the key is the raw id, not the Car.
  //
  // When the displayed photo came from the favourite rather than from a
  // matched car there is no live raw id to use, so the favourite's primary
  // registration stands in.
  const panCarId = (displayedCar === matchedCar && effectiveCar)
    ? effectiveCar
    : (displayedCar ? parseCarIds(displayedCar)[0] : undefined);

  // Per-registration pan override for this dashboard, with the dashboard's
  // own base pan as the default for any registration without one.
  //
  // The legacy lookup is the migration: rows written before the key changed
  // hold the Car's uuid and so covered every registration at once. They're
  // still honoured as a starting value — nobody loses an alignment they'd
  // already dialled in — but a save always writes a raw-id row, so the first
  // edit per registration splits them apart naturally. Nothing rewrites the
  // old rows; they simply stop being found once a specific one exists.
  const carDashPan = panCarId
    ? carDashPans.find(p => p.carId === panCarId && p.dashName === dashboard.name)
      ?? (displayedCar
        ? carDashPans.find(p => p.carId === displayedCar.id && p.dashName === dashboard.name)
        : undefined)
    : undefined;
  // What an active dashboard would show. The designer renders this too, not
  // the dashboard's base values, so editing a 360 aims the shot you'll
  // actually get rather than one you have to mentally offset.
  const kioskPan = {
    yaw:   carDashPan?.yaw   ?? dashboard.photo360Yaw   ?? 0,
    pitch: carDashPan?.pitch ?? dashboard.photo360Pitch ?? 0,
    fov:   carDashPan?.fov   ?? dashboard.photo360Fov   ?? 90,
    roll:  carDashPan?.roll  ?? dashboard.photo360Roll  ?? 0,
  };

  // Where an edit in the designer is written, read by handle360Change (which
  // is defined earlier but only ever called from the viewer below, by which
  // point this has been assigned). A ref rather than a dependency so the
  // handler identity stays stable across the ~60Hz churn a drag produces.
  panTargetRef.current = panCarId
    ? {
        carId: panCarId,
        dashName: dashboard.name,
        // Only a row that already belongs to THIS registration is updated in
        // place. A legacy Car-keyed row found above is read but never written
        // through, or one game's adjustment would silently move every other
        // game's alignment — the exact thing keying by registration fixes.
        existingId: carDashPans.find(
          p => p.carId === panCarId && p.dashName === dashboard.name,
        )?.id,
      }
    : null;

  const liveBackground360 = show360 && dayPhoto360Url ? (
    <Photo360CrossfadeViewer
      ref={viewer360Ref}
      dayPhotoUrl={dayPhoto360Url}
      nightPhotoUrl={nightPhoto360Url}
      tintOverlayRef={ambientOverlayRef}
      nightAmount={nightAmount}
      yaw={kioskPan.yaw}
      pitch={kioskPan.pitch}
      fov={kioskPan.fov}
      roll={kioskPan.roll}
      displayWidth={dashboard.canvasWidth}
      displayHeight={dashboard.canvasHeight}
      onChange={handle360Change}
    />
  ) : undefined;

  // Kiosk: show live viewer when actively editing (photo360Editing) OR when the
  // dashboard is configured to always use the live viewer (photo360LiveKiosk).
  //
  // Manually memoized via kioskLive360CacheRef (declared above the
  // loading/!dashboard early return — see its own comment for why this
  // can't be a real useMemo here). This element gets passed all the way
  // down as Canvas's `liveBackground` prop, and Canvas is React.memo'd
  // specifically so the ~60Hz simTimeMs tick doesn't force a re-render (see
  // Canvas.tsx's own comment). Without this, a fresh JSX element here on
  // every tick (index.tsx itself re-renders that often in kiosk/live view)
  // would defeat that memo via prop-reference inequality on every 360-type
  // dashboard, regardless of whether the simTimeMs prop itself was removed
  // from Canvas.
  const kioskLive360Deps: unknown[] = [
    kioskMode, dashboard.baseDashType, dashboard.photo360Editing, dashboard.photo360LiveKiosk,
    dayPhoto360Url, nightPhoto360Url, nightAmount,
    kioskPan.yaw, kioskPan.pitch, kioskPan.fov, kioskPan.roll,
    dashboard.canvasWidth, dashboard.canvasHeight, telemetryData,
    dashboard.neckFx, dashboard.neckFxGainX, dashboard.neckFxGainY, dashboard.neckFxDisableX, dashboard.neckFxDisableY,
    ambientColor?.r ?? null, ambientColor?.g ?? null, ambientColor?.b ?? null, ambientTintIntensity,
    ambientSaturationBoostDay, ambientSaturationBoostNight,
  ];
  const kioskLive360CacheStale = !kioskLive360CacheRef.current ||
    kioskLive360Deps.some((d, i) => d !== kioskLive360CacheRef.current!.deps[i]);
  if (kioskLive360CacheStale) {
    kioskLive360CacheRef.current = {
      deps: kioskLive360Deps,
      el: kioskMode && dashboard.baseDashType === '360' &&
        (dashboard.photo360Editing || dashboard.photo360LiveKiosk) && dayPhoto360Url ? (
        <Photo360CrossfadeViewer
          dayPhotoUrl={dayPhoto360Url}
          nightPhotoUrl={nightPhoto360Url}
          tintOverlayRef={ambientOverlayRef}
          nightAmount={nightAmount}
          ambientColor={ambientColor}
          ambientTintIntensity={ambientTintIntensity}
          ambientSaturationBoostDay={ambientSaturationBoostDay}
          ambientSaturationBoostNight={ambientSaturationBoostNight}
          yaw={kioskPan.yaw}
          pitch={kioskPan.pitch}
          fov={kioskPan.fov}
          roll={kioskPan.roll}
          displayWidth={dashboard.canvasWidth}
          displayHeight={dashboard.canvasHeight}
          onChange={() => {}}
          telemetryData={telemetryData}
          neckFxRef={neckFxSampleRef}
          swayEnabled={dashboard.neckFx}
          swayGainX={dashboard.neckFxGainX}
          swayGainY={dashboard.neckFxGainY}
          swayDisableX={dashboard.neckFxDisableX}
          swayDisableY={dashboard.neckFxDisableY}
          readOnly
        />
      ) : undefined,
    };
  }
  const kioskLive360 = kioskLive360CacheRef.current!.el;

  const showingLive360 = show360 || !!kioskLive360;

  // simTimeMs is delivered via ClockTimeContext (wrapping Canvas from
  // outside) rather than as a Canvas prop — it ticks at ~60Hz (see
  // useGlobalNightMode's own doc comment) and Canvas is otherwise memoized
  // (see Canvas.tsx), so passing it as a prop would force Canvas's entire
  // node tree to re-render on every tick regardless. Only components that
  // actually read the context (ClockTextNode/ClockSpriteNode) re-render on
  // each tick this way — everything else in the tree is unaffected, same
  // reasoning as the Canvas node prop fanout convention (values only some
  // node types need go via context, not a prop threaded through every node).
  const canvasEl = (
    <ClockTimeContext.Provider value={simTimeMs ?? null}>
    <Canvas
      dashboard={showingLive360 ? { ...dashboard, background: undefined } : dashboard}
      sprites={sprites}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onUpdate={updateNode}
      onUpdateDashboard={updateDashboard}
      isNight={isNight}
      nightAmount={nightAmount}
      onToggleNightMode={toggleNightMode}
      kioskMode={kioskMode}
      onKioskButton={handleKioskButton}
      telemetryData={telemetryData}
      neckFxSampleRef={neckFxSampleRef}
      kioskSweepActive={kioskMode && !kioskSweepDone}
      ref={canvasRef}
      forceNightPreview={forceNightPreview}
      skipTransition={forceNightPreview !== undefined}
      globalSteerMaxDeg={globalSteerMaxDeg}
      panBgMode={panBgMode && !show360}
      liveBackground={liveBackground360 ?? kioskLive360}
      liveBackgroundHandlesNight={showingLive360 && hasCarNightPhoto}
      ambientOverlayRef={ambientOverlayRef}
      liveBackgroundInteractive={viewing360 && !kioskMode}
      gamepadMappings={gamepadMappings}
      simStatus={simStatus}
      onDragCommit={handleDragCommit}
      activeTool={activeTool}
      key={dashboardName}
    />
    </ClockTimeContext.Provider>
  );

  const editAreaEl = (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Floating toolbar */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: 4 }}>
        {!kioskMode && (
          <>
            <ToolbarIconButton
              icon="Undo"
              label="Undo"
              onClick={undo}
              title="Undo (Ctrl+Z)"
              disabled={!canUndo}
            />
            <ToolbarIconButton
              icon="Redo"
              label="Redo"
              onClick={redo}
              title="Redo (Ctrl+Y)"
              disabled={!canRedo}
            />
            <ToolbarIconButton
              icon="ZoomOut"
              label=""
              onClick={() => canvasRef.current?.zoomBy(1 / 1.25)}
              title="Zoom out"
            />
            <ToolbarIconButton
              icon="ZoomIn"
              label=""
              onClick={() => canvasRef.current?.zoomBy(1.25)}
              title="Zoom in"
            />
            <ToolbarIconButton
              icon="FullScreen"
              label=""
              onClick={() => canvasRef.current?.zoomReset()}
              title="Reset zoom (100%, centered)"
            />
          </>
        )}
        <ToolbarIconButton
          icon="TransitionEffect"
          label="Transform"
          onClick={() => setActiveTool('transform')}
          title="Transform tool — select an element in the tree, then drag its box handles to move/scale/rotate"
          active={activeTool === 'transform'}
        />
        <ToolbarIconButton
          icon="Crop"
          label="Crop"
          onClick={() => setActiveTool('crop')}
          title="Crop tool — select a sprite element, then drag its edges inward to trim it (telemetry-driven fill/rotation acts on what's left)"
          active={activeTool === 'crop'}
        />
        {dashboard.baseDashType === '360' && !viewing360 && (
          <ToolbarIconButton
            icon="EditPhoto"
            label="Edit 360°"
            onClick={enter360Edit}
            // Disabled until the photo this edits is actually resolvable.
            //
            // `dayPhoto360Url` comes from GET_CARS, which is `skip`ped until
            // the dashboard has loaded and turns out to be a 360 — so the
            // query only STARTS at the moment this button appears. Clicking it
            // in that window put the editor into 360 edit mode with no live
            // viewer to render (liveBackground360 is undefined without a URL),
            // so the canvas showed the baked background screenshot instead —
            // visually identical to the real thing, but a static image with no
            // pan handling behind it. Dragging did nothing, and that state
            // persisted for the whole session.
            //
            // Reproduced as: navigate in and click immediately (broken) vs
            // reload and click (fine) — the reload simply spends long enough
            // loading that the query has resolved first.
            disabled={!live360Ready}
            title={live360Ready
              ? 'Open live 360° photo viewer to adjust pan/zoom'
              : 'Loading the 360° photo…'}
          />
        )}
        {viewing360 && (
          <>
            <ToolbarIconButton
              icon="Save"
              label="Save"
              onClick={save360}
              title="Capture current view as background image and exit"
              active
            />
            <ToolbarIconButton
              icon="ChromeClose"
              label="Cancel"
              onClick={cancel360}
              title="Exit 360° editing without saving"
            />
          </>
        )}
        {!show360 && dashboard.background && (
          <ToolbarIconButton
            icon="Move"
            label="Pan BG"
            onClick={() => setPanBgMode(m => !m)}
            title={panBgMode ? 'Stop panning background' : 'Drag to pan background image'}
            active={panBgMode}
          />
        )}
        {dashboard.dayNight && !kioskMode && (
          <ToolbarIconButton
            icon={isNight ? 'ClearNight' : 'Sunny'}
            label={isNight ? 'Day' : 'Night'}
            onClick={toggleNightMode}
            title={isNight ? 'Switch to day mode (all screens)' : 'Switch to night mode (all screens)'}
            active={isNight}
          />
        )}
      </div>
      {show360 && !photoUrl ? (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          color: 'rgba(255,255,255,0.5)', fontSize: '0.9em', textAlign: 'center', padding: '2em',
          pointerEvents: 'none',
        }}>
          Upload a 360° equirectangular photo, then set it as the 360 source in Dashboard Settings.
        </div>
      ) : null}
      {canvasEl}
    </div>
  );

  if (kioskMode) {
    // Must wrap with both feed providers same as the mobile/desktop branches
    // below — the gear-icon popup (DayNightSimPanel, via Canvas.tsx) only
    // ever renders in kiosk mode, so skipping this here previously meant it
    // always fell back to opening its own standalone nightModeUpdates
    // subscription: a second persistent connection competing with
    // dashboardUpdates for the browser's ~6-connection HTTP/1.1 pool, which
    // queued the adjust-time mutation behind it until the popup closed and
    // released the connection (see useGlobalNightMode.ts's doc comment).
    return (
      <LiveUpdatesContext.Provider value={hub}>
      {hubSubscriber}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1001, background: '#000' }}>
        {canvasEl}
      </div>
      </LiveUpdatesContext.Provider>
    );
  }

  // ── Mobile layout: canvas top, explorer bottom, picker as overlay ──────────
  if (isMobile) {
    return (
      <LiveUpdatesContext.Provider value={hub}>
      {hubSubscriber}
      <Stack style={{ height: 'calc(100dvh - 3.85em)', width: '100%', overflow: 'hidden' }}>
        <Stack.Item grow style={{ position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          {editAreaEl}
        </Stack.Item>

        <div
          onMouseDown={onResizeStart}
          style={{
            height: 6,
            flexShrink: 0,
            cursor: 'ns-resize',
            background: theme.palette.neutralLight,
            borderTop: border,
            borderBottom: border,
          }}
        />

        <div style={{ height: explorerHeight, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {/* Back nav + dashboard name header on mobile */}
          <Stack
            horizontal
            verticalAlign="center"
            style={{ flexShrink: 0, borderBottom: border, padding: '0 4px' }}
            tokens={{ childrenGap: 4 }}
          >
            <IconButton
              iconProps={{ iconName: 'Back' }}
              title="Back to dashboards"
              onClick={() => navigate('/dashboards/dashboards')}
              styles={{ root: { height: 30, width: 30 } }}
            />
            <span style={{ fontSize: '0.9em', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dashboardName}
            </span>
          </Stack>
          <ObjectExplorer {...explorerProps} />
        </div>
      </Stack>
      </LiveUpdatesContext.Provider>
    );
  }

  // ── Desktop layout: horizontal panels ──────────────────────────────────────
  return (
    <LiveUpdatesContext.Provider value={hub}>
    {hubSubscriber}
    <Stack horizontal style={{ height: 'calc(100vh - 3.85em)', width: '100%', overflow: 'hidden' }}>
      {panelSide === 'left' && <ObjectExplorer {...explorerProps} />}
      <Stack.Item grow style={{ position: 'relative', overflow: 'hidden' }}>
        {editAreaEl}
      </Stack.Item>
      {panelSide === 'right' && <ObjectExplorer {...explorerProps} />}
    </Stack>
    </LiveUpdatesContext.Provider>
  );
};

export default DashboardDesigner;
