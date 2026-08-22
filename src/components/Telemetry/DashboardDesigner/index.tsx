import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Stack, IconButton, getTheme, useQuery } from '../../../lib/denim/lib';
import { useSubscription } from '@apollo/client/react';
import dispatcher from '../../../lib/denim/lib/queries';
import { useNavigate } from 'react-router';
import Canvas, { CanvasTool } from './Canvas';
import ObjectExplorer from './ObjectExplorer';
import { DASHBOARD_UPDATES_SUB } from './queries';
import { Photo360Handle } from './components/Photo360Viewer';
import Photo360CrossfadeViewer from './components/Photo360CrossfadeViewer';
import { useDashboard } from './useDashboard';
import { useTemplates } from './useTemplates';
import { builtInSprites } from '../../../mock/dashboardMock';
import { useTelemetryPlayback, computeStaticFrame, SequenceConfig, DEFAULT_SWEEP_CONFIG } from './useTelemetryPlayback';
import { computeTelemetryValues } from '../useLiveTelemetry';
import { useMappingWatcher } from '../useMappingWatcher';
import { useGlobalNightMode, NightModeFeedProvider } from '../useGlobalNightMode';
import { useGlobalPreviewCar, PreviewCarFeedProvider } from '../useGlobalPreviewCar';
import { GET_CARS, parseCarIds, CarRecord } from '../carQueries';
import { GET_CAR_DASH_PANS, CAR_DASH_PAN_CHANGED } from '../carDashPanQueries';
import { useHealthPoll } from '../../../graphql/health';
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

  const handleKioskButton = () => {
    if (kioskMode) navigate(-1);
    else navigate(`/telemetryadmin/dashboards/${encodeURIComponent(dashboardName)}/show`);
  };

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
  const [simStatus, setSimStatus] = useState('');

  // This is the ONE place on a DashboardDesigner page that opens the real
  // nightModeUpdates/previewCarChanged subscriptions — each hook's own
  // `feed` (part of its return value) is re-provided via context below so
  // anything nested under this tree (DayNightSimPanel, via Canvas.tsx's gear
  // popup) reuses it instead of opening a second connection. See
  // useGlobalNightMode.ts/useGlobalPreviewCar.ts's doc comments for why a
  // second always-on subscription on the same page is a real bug here
  // (browser per-origin HTTP connection exhaustion hung unrelated mutations).
  const { isNight, nightAmount, simTimeMs, toggleNightMode, feed: nightModeFeed } = useGlobalNightMode(undefined, { liveClock: kioskMode });
  const { previewCarId, feed: previewCarFeed } = useGlobalPreviewCar();

  const { data: carsData } = useQuery(GET_CARS, {
    skip: dashboard?.baseDashType !== '360',
    fetchPolicy: 'cache-and-network',
  });
  const cars: CarRecord[] = (carsData as any)?.getCars ?? [];

  const { data: carDashPansData, refetch: refetchCarDashPans } = useQuery(GET_CAR_DASH_PANS, {
    skip: dashboard?.baseDashType !== '360',
    fetchPolicy: 'cache-and-network',
  });
  const carDashPans: Array<{ carId: string; dashName: string; yaw: number; pitch: number; fov: number; roll: number }> =
    (carDashPansData as any)?.getCarDashPans ?? [];

  // A per-car pan override edited on the Cars page (DashPanEditor) must reach
  // an already-open kiosk live — that's the whole point of previewing pan
  // edits without needing to actually drive the car. The list is small, so a
  // full refetch on any change is simpler and safer than merging the payload
  // into local state by hand.
  useSubscription(CAR_DASH_PAN_CHANGED, {
    skip: dashboard?.baseDashType !== '360',
    onData: () => { refetchCarDashPans(); },
  });

  const { handleDeviceDefaultEvent } = useMappingWatcher(
    () => navigate('/telemetryadmin/default', { replace: true }),
    !kioskMode,
    car,
    simStatus,
  );

  // computeTelemetryValues builds a brand-new `values` object on every call
  // (even `{}` when there's no live frame at all), so calling setLiveValues
  // unconditionally at the subscription's ~60Hz tick rate committed a new
  // object reference every single tick regardless of whether any value
  // actually changed — a permanent, edit-mode-and-kiosk-mode-agnostic
  // re-render source for the whole DashboardDesigner tree. setCar/
  // setSimStatus don't have this problem (React already bails out of a
  // state update when the new value is a primitive `Object.is`-equal to the
  // old one), only the object-valued `values` does. liveValuesRef mirrors
  // the last *committed* values so this can compare-before-set without
  // depending on stale closure state inside this useCallback.
  const liveValuesRef = useRef<Record<string, number>>({});
  const handleSubscriptionData = useCallback(({ data }: any) => {
    const event = (data.data as any)?.dashboardUpdates;
    if (!event) return;
    const typename = event.__typename;
    if (typename === 'DashboardEntryChanged') handleDashboardUpdate(event);
    else if (typename === 'DashTemplateChanged') refetchTemplates();
    else if (typename === 'DeviceDefaultChanged' && kioskMode) handleDeviceDefaultEvent(event);
    else if (typename === 'TelemetryEvent' && kioskMode) {
      // Not consumed at all while editing — baseTelemetry (below) only reads
      // liveValues when `kioskMode && kioskSweepDone`; the editor always
      // shows playbackData (manual/sweep test data) instead. So this ~60Hz
      // event stream has zero visual purpose in edit mode, only a 60Hz
      // re-render cost — skip touching state for it entirely there rather
      // than computing-and-discarding a value nothing reads.
      const { values, car: c, simStatus: s } = computeTelemetryValues(event.frame);
      if (!shallowEqualRecord(liveValuesRef.current, values)) {
        liveValuesRef.current = values;
        setLiveValues(values);
      }
      setCar(c);
      setSimStatus(s);
    }
  }, [handleDashboardUpdate, refetchTemplates, handleDeviceDefaultEvent, kioskMode]);

  // A backend restart (e.g. a dev-mode rebuild) breaks the underlying
  // multipart HTTP stream this subscription runs over — Apollo surfaces
  // that as onError and does NOT auto-retry, so without this the active
  // dashboard's telemetry/live-update feed would stay dead until a manual
  // reload (confirmed by user report). `subscriptionDown` toggles `skip` to
  // tear the subscription down the moment it errors, then `useHealthPoll`
  // brings it back the moment the server actually answers again — plain
  // exponential-less retry-on-error would just error again identically
  // while the server is still down.
  const [subscriptionDown, setSubscriptionDown] = useState(false);
  useHealthPoll(subscriptionDown, () => setSubscriptionDown(false));

  // Skip until dashboard is loaded — avoids a useSyncExternalStore commit during
  // the initial mount burst when Apollo is already processing multiple queries.
  useSubscription(DASHBOARD_UPDATES_SUB, {
    fetchPolicy: 'no-cache',
    skip: !dashboard || subscriptionDown,
    variables: { includeTelemetry: kioskMode },
    onData: handleSubscriptionData,
    onError: () => setSubscriptionDown(true),
  });

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
    await savePhotoEditing(true);
    setViewing360(true);
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

  const handle360Change = useCallback((y: number, p: number, f: number, r: number) => {
    trackedSetDashboard(prev => prev ? { ...prev, photo360Yaw: y, photo360Pitch: p, photo360Fov: f, photo360Roll: r } : prev);
    savePanCoordinates(y, p, f, r);
  }, [trackedSetDashboard, savePanCoordinates]);

  const handleFlip = useCallback(() => setPanelSide(s => s === 'left' ? 'right' : 'left'), []);
  const handleTogglePlay = useCallback(() => setPlaying(p => !p), []);
  const handleOnSave = useCallback(async () => {
    setSelectedId(null);
    await new Promise(r => requestAnimationFrame(r));
    await saveDashboard();
  }, [saveDashboard]);
  const handleDeleteDashboard = useCallback(async () => {
    await deleteDashboard();
    navigate('/telemetryadmin/dashboards');
  }, [deleteDashboard, navigate]);

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
  // Whether the car has a distinct night photo at all — not gated by the
  // current nightAmount, since Photo360CrossfadeViewer already blends the
  // two photos correctly across the *entire* 0..1 range on its own; gating
  // this by isNight would un-suppress Canvas's generic darkening overlay
  // partway through a transition and double-darken the scene.
  const hasCarNightPhoto = !!carNightPhoto;
  const defaultPhoto360Sprite = dashboard.baseDashType === '360' && dashboard.photo360File
    ? sprites.find(s => s.file === dashboard.photo360File)
    : undefined;
  const photo360Url = (ref?: { url: string }) =>
    ref ? `http://${window.location.hostname}:9000${ref.url}` : undefined;
  const dayPhoto360Url = photo360Url(carDayPhoto) ?? defaultPhoto360Sprite?.thumbnail ?? '';
  const nightPhoto360Url = photo360Url(carNightPhoto);
  const photoUrl = show360 ? dayPhoto360Url : '';

  // Per-car pan override for this dashboard — lets the same dashboard be reused
  // across cars whose 360° photos don't line up identically with the dashboard's
  // own base pan. Only affects the kiosk live viewer, not the designer's own
  // edit-360 pan (which always edits the dashboard's base values). Keyed by
  // the matched Car's own id (not the raw effectiveCar id) — pan alignment is
  // shared across every game/raw car_id that Car appears under.
  const carDashPan = matchedCar
    ? carDashPans.find(p => p.carId === matchedCar.id && p.dashName === dashboard.name)
    : undefined;
  const kioskPan = {
    yaw:   carDashPan?.yaw   ?? dashboard.photo360Yaw   ?? 0,
    pitch: carDashPan?.pitch ?? dashboard.photo360Pitch ?? 0,
    fov:   carDashPan?.fov   ?? dashboard.photo360Fov   ?? 90,
    roll:  carDashPan?.roll  ?? dashboard.photo360Roll  ?? 0,
  };

  const liveBackground360 = show360 && dayPhoto360Url ? (
    <Photo360CrossfadeViewer
      ref={viewer360Ref}
      dayPhotoUrl={dayPhoto360Url}
      nightPhotoUrl={nightPhoto360Url}
      nightAmount={nightAmount}
      yaw={dashboard.photo360Yaw ?? 0}
      pitch={dashboard.photo360Pitch ?? 0}
      fov={dashboard.photo360Fov ?? 90}
      roll={dashboard.photo360Roll ?? 0}
      displayWidth={dashboard.canvasWidth}
      displayHeight={dashboard.canvasHeight}
      onChange={handle360Change}
    />
  ) : undefined;

  // Kiosk: show live viewer when actively editing (photo360Editing) OR when the
  // dashboard is configured to always use the live viewer (photo360LiveKiosk).
  const kioskLive360 = kioskMode && dashboard.baseDashType === '360' &&
    (dashboard.photo360Editing || dashboard.photo360LiveKiosk) && dayPhoto360Url ? (
    <Photo360CrossfadeViewer
      dayPhotoUrl={dayPhoto360Url}
      nightPhotoUrl={nightPhoto360Url}
      nightAmount={nightAmount}
      yaw={kioskPan.yaw}
      pitch={kioskPan.pitch}
      fov={kioskPan.fov}
      roll={kioskPan.roll}
      displayWidth={dashboard.canvasWidth}
      displayHeight={dashboard.canvasHeight}
      onChange={() => {}}
      telemetryData={telemetryData}
      swayEnabled={dashboard.neckFx}
      swayGainX={dashboard.neckFxGainX}
      swayGainY={dashboard.neckFxGainY}
      swayDisableX={dashboard.neckFxDisableX}
      swayDisableY={dashboard.neckFxDisableY}
      readOnly
    />
  ) : undefined;

  const showingLive360 = show360 || !!kioskLive360;

  const canvasEl = (
    <Canvas
      dashboard={showingLive360 ? { ...dashboard, background: undefined } : dashboard}
      sprites={sprites}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onUpdate={updateNode}
      onUpdateDashboard={updateDashboard}
      isNight={isNight}
      nightAmount={nightAmount}
      simTimeMs={simTimeMs}
      onToggleNightMode={toggleNightMode}
      kioskMode={kioskMode}
      onKioskButton={handleKioskButton}
      telemetryData={telemetryData}
      kioskSweepActive={kioskMode && !kioskSweepDone}
      ref={canvasRef}
      forceNightPreview={forceNightPreview}
      skipTransition={forceNightPreview !== undefined}
      globalSteerMaxDeg={globalSteerMaxDeg}
      panBgMode={panBgMode && !show360}
      liveBackground={liveBackground360 ?? kioskLive360}
      liveBackgroundIsNightPhoto={showingLive360 && hasCarNightPhoto}
      liveBackgroundInteractive={viewing360 && !kioskMode}
      gamepadMappings={gamepadMappings}
      simStatus={simStatus}
      onDragCommit={handleDragCommit}
      activeTool={activeTool}
      key={dashboardName}
    />
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
            title="Open live 360° photo viewer to adjust pan/zoom"
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
      <NightModeFeedProvider value={nightModeFeed}>
      <PreviewCarFeedProvider value={previewCarFeed}>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1001, background: '#000' }}>
        {canvasEl}
      </div>
      </PreviewCarFeedProvider>
      </NightModeFeedProvider>
    );
  }

  // ── Mobile layout: canvas top, explorer bottom, picker as overlay ──────────
  if (isMobile) {
    return (
      <NightModeFeedProvider value={nightModeFeed}>
      <PreviewCarFeedProvider value={previewCarFeed}>
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
              onClick={() => navigate('/telemetryadmin/dashboards')}
              styles={{ root: { height: 30, width: 30 } }}
            />
            <span style={{ fontSize: '0.9em', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {dashboardName}
            </span>
          </Stack>
          <ObjectExplorer {...explorerProps} />
        </div>
      </Stack>
      </PreviewCarFeedProvider>
      </NightModeFeedProvider>
    );
  }

  // ── Desktop layout: horizontal panels ──────────────────────────────────────
  return (
    <NightModeFeedProvider value={nightModeFeed}>
    <PreviewCarFeedProvider value={previewCarFeed}>
    <Stack horizontal style={{ height: 'calc(100vh - 3.85em)', width: '100%', overflow: 'hidden' }}>
      {panelSide === 'left' && <ObjectExplorer {...explorerProps} />}
      <Stack.Item grow style={{ position: 'relative', overflow: 'hidden' }}>
        {editAreaEl}
      </Stack.Item>
      {panelSide === 'right' && <ObjectExplorer {...explorerProps} />}
    </Stack>
    </PreviewCarFeedProvider>
    </NightModeFeedProvider>
  );
};

export default DashboardDesigner;
