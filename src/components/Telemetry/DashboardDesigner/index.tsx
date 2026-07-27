import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Stack, IconButton, PrimaryButton, DefaultButton, getTheme, useQuery } from '../../../lib/denim/lib';
import { useSubscription } from '@apollo/client/react';
import dispatcher from '../../../lib/denim/lib/queries';
import { useNavigate } from 'react-router';
import Canvas from './Canvas';
import ObjectExplorer from './ObjectExplorer';
import { DASHBOARD_UPDATES_SUB } from './queries';
import { Photo360Handle } from './components/Photo360Viewer';
import Photo360CrossfadeViewer from './components/Photo360CrossfadeViewer';
import { useDashboard } from './useDashboard';
import { useTemplates } from './useTemplates';
import { builtInSprites } from '../../../mock/dashboardMock';
import { useTelemetryPlayback, SequenceConfig, DEFAULT_SWEEP_CONFIG } from './useTelemetryPlayback';
import { computeTelemetryValues } from '../useLiveTelemetry';
import { useMappingWatcher } from '../useMappingWatcher';
import { useGlobalNightMode } from '../useGlobalNightMode';
import { useGlobalPreviewCar } from '../useGlobalPreviewCar';
import { GET_CARS, parseCarIds, CarRecord } from '../carQueries';
import { GET_CAR_DASH_PANS, CAR_DASH_PAN_CHANGED } from '../carDashPanQueries';
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

const MOBILE_BREAKPOINT = 768;
const MIN_EXPLORER_HEIGHT = 120;
const MAX_EXPLORER_HEIGHT = 600;
const DEFAULT_EXPLORER_HEIGHT = 280;

const DashboardDesigner: React.FC<Props> = ({ dashboardName, kioskMode }) => {
  const navigate = useNavigate();
  const theme = getTheme();
  const border = `1px solid ${theme.palette.neutralLight}`;

  const handleKioskButton = () => {
    if (kioskMode) navigate(-1);
    else navigate(`/telemetryadmin/dashboards/${encodeURIComponent(dashboardName)}/show`);
  };

  const { dashboard, setDashboard, saveDashboard, deleteDashboard, savePanCoordinates, savePhotoEditing, uploadSprite, deleteSprite, refetchSprites, copyBuiltinSprite, uploadBackground, isDirty, sprites, loading, canvasRef, forceNightPreview, handleDashboardUpdate } = useDashboard(dashboardName);
  const { isNight, toggleNightMode } = useGlobalNightMode();
  const { previewCarId } = useGlobalPreviewCar();
  const builtInSpriteFileSet = useMemo(() => new Set(builtInSprites.map(s => s.file)), []);
  const { data: myData } = useQuery(dispatcher.my, { fetchPolicy: 'cache-first' });
  const globalSteerMaxDeg: number = (myData as any)?.my?.settings?.steerMaxDeg ?? 400;
  const gamepadMappings = (myData as any)?.my?.settings?.gamepadMappings ?? [];
  const { templates, saveTemplate, removeTemplate, uploadThumbnail, refetchTemplates } = useTemplates();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewing360, setViewing360] = useState(false);
  const viewer360Ref = useRef<Photo360Handle>(null);
  const [panBgMode, setPanBgMode] = useState(false);
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

  const handleSubscriptionData = useCallback(({ data }: any) => {
    const event = (data.data as any)?.dashboardUpdates;
    if (!event) return;
    const typename = event.__typename;
    if (typename === 'DashboardEntryChanged') handleDashboardUpdate(event);
    else if (typename === 'DashTemplateChanged') refetchTemplates();
    else if (typename === 'DeviceDefaultChanged' && kioskMode) handleDeviceDefaultEvent(event);
    else if (typename === 'TelemetryEvent') {
      const { values, car: c, simStatus: s } = computeTelemetryValues(event.frame);
      setLiveValues(values);
      setCar(c);
      setSimStatus(s);
    }
  }, [handleDashboardUpdate, refetchTemplates, handleDeviceDefaultEvent, kioskMode]);

  // Skip until dashboard is loaded — avoids a useSyncExternalStore commit during
  // the initial mount burst when Apollo is already processing multiple queries.
  useSubscription(DASHBOARD_UPDATES_SUB, {
    fetchPolicy: 'no-cache',
    skip: !dashboard,
    onData: handleSubscriptionData,
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

  const startupSweep = useMemo<SequenceConfig>(() => DEFAULT_SWEEP_CONFIG, []);

  const activeSequence = useMemo<SequenceConfig | null>(() => {
    if (kioskMode) return kioskSweepDone ? null : startupSweep;
    return playing ? sequenceConfig : null;
  }, [kioskMode, kioskSweepDone, startupSweep, playing, sequenceConfig]);

  const flatNodes = useMemo(() => dashboard ? flattenNodes(dashboard.components) : [], [dashboard]);
  const playbackData = useTelemetryPlayback(
    activeSequence,
    flatNodes,
    () => { if (kioskMode) setKioskSweepDone(true); else setPlaying(false); },
  );
  const baseTelemetry = kioskMode && kioskSweepDone ? liveValues : playbackData;
  const telemetryData = previewTelemetry ? { ...baseTelemetry, ...previewTelemetry } : baseTelemetry;
  const getCanvasEl = useCallback(
    () => canvasRef.current?.getCanvasEl() ?? null,
    [canvasRef],
  );

  const generateThumbnails = useCallback(async () => {
    if (!dashboard) return new Map<string, string>();
    return captureAllNodeThumbnails(getCanvasEl, dashboard.components, dashboard.canvasWidth, dashboard.canvasHeight);
  }, [getCanvasEl, dashboard]);

  const handleSaveTemplate = useCallback(async (node: ComponentNode) => {
    const id = await saveTemplate(node);
    if (!id) return;
    if (!dashboard) return;
    const thumb = await captureNodeThumbnail(getCanvasEl, node, dashboard.canvasWidth, dashboard.canvasHeight);
    if (thumb) await uploadThumbnail(id, thumb);
  }, [saveTemplate, uploadThumbnail, getCanvasEl, dashboard]);

  const updateNode = useCallback((id: string, patch: Partial<ComponentNode>) => {
    setDashboard(prev => {
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
  }, [setDashboard]);

  const updateDashboard = useCallback((patch: Partial<DashboardConfig>) => {
    setDashboard(prev => prev ? { ...prev, ...patch } : prev);
  }, [setDashboard]);

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
    setDashboard(prev => prev ? {
      ...prev,
      components: addChildToNode(prev.components, parentId, node),
    } : prev);
    setSelectedId(node.id);
  }, [setDashboard]);

  const deleteNode = useCallback((id: string) => {
    setDashboard(prev => prev ? {
      ...prev,
      components: deleteNodeById(prev.components, id),
    } : prev);
    setSelectedId(prev => prev === id ? null : prev);
  }, [setDashboard]);

  const handleMoveNode = useCallback((nodeId: string, targetId: string, mode: 'before' | 'after' | 'inside') => {
    setDashboard(prev => {
      if (!prev || nodeId === targetId) return prev;
      if (isDescendantOf(prev.components, nodeId, targetId)) return prev;
      return { ...prev, components: moveNode(prev.components, nodeId, targetId, mode) };
    });
  }, [setDashboard]);

  const handle360Change = useCallback((y: number, p: number, f: number, r: number) => {
    setDashboard(prev => prev ? { ...prev, photo360Yaw: y, photo360Pitch: p, photo360Fov: f, photo360Roll: r } : prev);
    savePanCoordinates(y, p, f, r);
  }, [setDashboard, savePanCoordinates]);

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
  // crossfades between them as isNight changes instead of cutting instantly.
  const matchedCar = cars.find(c => parseCarIds(c).includes(effectiveCar));
  const carPhoto360 = matchedCar;
  const carDayPhoto = carPhoto360?.dayPhoto;
  const carNightPhoto = carPhoto360?.nightPhoto;
  const usingCarNightPhoto = isNight && !!carNightPhoto;
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
      isNight={isNight}
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
      isNight={isNight}
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
      onToggleNightMode={toggleNightMode}
      kioskMode={kioskMode}
      onKioskButton={handleKioskButton}
      telemetryData={telemetryData}
      ref={canvasRef}
      forceNightPreview={forceNightPreview}
      skipTransition={forceNightPreview !== undefined}
      globalSteerMaxDeg={globalSteerMaxDeg}
      panBgMode={panBgMode && !show360}
      liveBackground={liveBackground360 ?? kioskLive360}
      liveBackgroundIsNightPhoto={showingLive360 && usingCarNightPhoto}
      liveBackgroundInteractive={viewing360 && !kioskMode}
      gamepadMappings={gamepadMappings}
      simStatus={simStatus}
    />
  );

  const editAreaEl = (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Floating toolbar */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, display: 'flex', gap: 4 }}>
        {dashboard.baseDashType === '360' && !viewing360 && (
          <DefaultButton
            onClick={enter360Edit}
            title="Open live 360° photo viewer to adjust pan/zoom"
            styles={{ root: { height: 28, fontSize: '0.82em' } }}
          >
            Edit 360°
          </DefaultButton>
        )}
        {viewing360 && (
          <>
            <PrimaryButton
              onClick={save360}
              title="Capture current view as background image and exit"
              styles={{ root: { height: 28, fontSize: '0.82em' } }}
            >
              Save
            </PrimaryButton>
            <DefaultButton
              onClick={cancel360}
              title="Exit 360° editing without saving"
              styles={{ root: { height: 28, fontSize: '0.82em' } }}
            >
              Cancel
            </DefaultButton>
          </>
        )}
        {!show360 && dashboard.background && (() => {
          const PanBgButton = panBgMode ? PrimaryButton : DefaultButton;
          return (
            <PanBgButton
              onClick={() => setPanBgMode(m => !m)}
              title={panBgMode ? 'Stop panning background' : 'Drag to pan background image'}
              styles={{ root: { height: 28, fontSize: '0.82em' } }}
            >
              Pan BG
            </PanBgButton>
          );
        })()}
        {dashboard.dayNight && !kioskMode && (() => {
          const NightButton = isNight ? PrimaryButton : DefaultButton;
          return (
            <NightButton
              onClick={toggleNightMode}
              title={isNight ? 'Switch to day mode (all screens)' : 'Switch to night mode (all screens)'}
              iconProps={{ iconName: isNight ? 'ClearNight' : 'Sunny' }}
              styles={{ root: { height: 28, fontSize: '0.82em' } }}
            >
              {isNight ? 'Day' : 'Night'}
            </NightButton>
          );
        })()}
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
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1001, background: '#000' }}>
        {canvasEl}
      </div>
    );
  }

  // ── Mobile layout: canvas top, explorer bottom, picker as overlay ──────────
  if (isMobile) {
    return (
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
    );
  }

  // ── Desktop layout: horizontal panels ──────────────────────────────────────
  return (
    <Stack horizontal style={{ height: 'calc(100vh - 3.85em)', width: '100%', overflow: 'hidden' }}>
      {panelSide === 'left' && <ObjectExplorer {...explorerProps} />}
      <Stack.Item grow style={{ position: 'relative', overflow: 'hidden' }}>
        {editAreaEl}
      </Stack.Item>
      {panelSide === 'right' && <ObjectExplorer {...explorerProps} />}
    </Stack>
  );
};

export default DashboardDesigner;
