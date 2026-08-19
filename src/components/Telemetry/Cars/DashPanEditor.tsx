import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Stack, Form, IconButton, getTheme } from '../../../lib/denim/lib';
import { GET_DASHBOARDS } from '../DashboardDesigner/queries';
import Photo360CrossfadeViewer from '../DashboardDesigner/components/Photo360CrossfadeViewer';
import { captureCanvasScreenshot } from '../DashboardDesigner/useScreenshot';
import { useGlobalNightMode } from '../useGlobalNightMode';
import { UPLOAD_CAR_THUMBNAIL } from '../carQueries';
import {
  GET_CAR_DASH_PANS,
  ADD_CAR_DASH_PAN,
  UPDATE_CAR_DASH_PAN,
  REMOVE_CAR_DASH_PAN,
  CarDashPanRecord,
} from '../carDashPanQueries';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';

const THUMB_W = 280;

interface Pan {
  yaw: number;
  pitch: number;
  fov: number;
  roll: number;
}

const DEFAULT_PAN: Pan = { yaw: 0, pitch: 0, fov: 90, roll: 0 };

function parseDashBasePan(elements: string | undefined): Pan {
  try {
    const p = JSON.parse(elements ?? '{}');
    return {
      yaw: p.photo360Yaw ?? 0,
      pitch: p.photo360Pitch ?? 0,
      fov: p.photo360Fov ?? 90,
      roll: p.photo360Roll ?? 0,
    };
  } catch {
    return DEFAULT_PAN;
  }
}

// The dash picker lives in the same form as the pan sliders (rather than a
// separate form below) so picking a dashboard and nudging its pan read as
// one cohesive control, not two disconnected ones — the sliders are simply
// disabled (not hidden) while dashName is '' (freelook), since there's
// nothing dashboard-specific to persist in that state.
const buildDashPanSchema = (dashOptions: Array<{ text: string; value: string }>, disabled: boolean) => ({
  dashName: { type: 'select' as const, label: 'Dashboard', options: dashOptions },
  yaw:   { type: 'slider' as const, label: 'Yaw (°)',      min: -360, max: 360, step: 1, disabled },
  pitch: { type: 'slider' as const, label: 'Pitch (°)',    min: -85,  max: 85,  step: 1, disabled },
  fov:   { type: 'slider' as const, label: 'Zoom (FOV °)', min: 5,    max: 120, step: 1, disabled },
  roll:  { type: 'slider' as const, label: 'Roll (°)',     min: -180, max: 180, step: 1, disabled },
});

// One viewer + slider session for a single (dashboard, override) pairing. Remounted
// (via the parent's `key`) only when the dashboard selection changes or the override
// is explicitly reset — never as a side effect of the first auto-save completing, so
// an in-progress drag never gets interrupted by its own save round-trip.
const PanSession: React.FC<{
  carId: string;
  dashName: string; // '' = freelook, nothing persisted
  dashOptions: Array<{ text: string; value: string }>;
  onDashNameChange: (name: string) => void;
  photoUrl: string;
  nightPhotoUrl?: string;
  isNight: boolean;
  nightAmount: number;
  onToggleNightMode: () => void;
  width: number;
  height: number;
  initialPan: Pan;
  existingId?: string;
  onPersisted: () => void;
  photoId?: string;
  hasThumbnail?: boolean;
  onThumbnailChanged?: () => void;
}> = ({
  carId, dashName, dashOptions, onDashNameChange, photoUrl, nightPhotoUrl, isNight, nightAmount, onToggleNightMode, width, height,
  initialPan, existingId, onPersisted, photoId, hasThumbnail, onThumbnailChanged,
}) => {
  const [pan, setPan] = useState<Pan>(initialPan);
  const idRef = useRef(existingId);
  // GET_CAR_DASH_PANS is still in flight (cache-and-network) when this often
  // mounts, so `existingId` frequently arrives undefined on the very first
  // render and only resolves once the network response lands a moment later.
  // Adopting it here (once, whenever it first becomes known) keeps `persist`
  // below routed to updatePan on the real record — without this, a pan
  // dragged before the query settles falls through to addPan and creates an
  // orphaned duplicate override that the live kiosk view never picks up
  // (its own lookup keeps matching the original, now-stale record).
  if (!idRef.current && existingId) idRef.current = existingId;
  const initialPanRef = useRef(initialPan);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const [addPan] = useMutation(ADD_CAR_DASH_PAN);
  const [updatePan] = useMutation(UPDATE_CAR_DASH_PAN);
  const [uploadCarThumbnail] = useMutation(UPLOAD_CAR_THUMBNAIL);

  const persist = (next: Pan) => {
    if (!dashName) return;
    // The Form control fires its onChange once on mount with the untouched
    // initial values (per-form's normal lifecycle) — skip that so selecting a
    // dashboard, or resetting, doesn't immediately recreate an override that's
    // just a copy of the default.
    const initial = initialPanRef.current;
    if (next.yaw === initial.yaw && next.pitch === initial.pitch && next.fov === initial.fov && next.roll === initial.roll) {
      return;
    }
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (idRef.current) {
        await updatePan({ variables: { id: idRef.current, update: next } });
      } else {
        const res = await addPan({ variables: { values: { carId, dashName, ...next } } });
        idRef.current = (res.data as any)?.addCarDashPan?.id;
        onPersisted();
      }
    }, 500);
  };

  const handleChange = (yaw: number, pitch: number, fov: number, roll: number) => {
    const next = { yaw, pitch, fov, roll };
    setPan(next);
    persist(next);
  };

  // Same multi-field onChange convention as CarDetail's own forms: fires on
  // ANY field change with the full raw values, so branch by comparing each
  // tracked field against its current known value rather than the form name.
  const handleDashPanFormChange = (_n: string, { raw }: any) => {
    const newDashName = String(raw.dashName ?? '');
    if (newDashName !== dashName) {
      onDashNameChange(newDashName);
      return;
    }
    handleChange(Number(raw.yaw ?? 0), Number(raw.pitch ?? 0), Number(raw.fov ?? 90), Number(raw.roll ?? 0));
  };

  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [windowSize, setWindowSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === fullscreenRef.current);
    const onResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else fullscreenRef.current?.requestFullscreen();
  };

  const [thumbSaving, setThumbSaving] = useState(false);
  const autoCapturedRef = useRef(false);
  const viewerWrapRef = useRef<HTMLDivElement>(null);

  const captureThumbnail = async () => {
    if (!photoId || thumbSaving) return;
    setThumbSaving(true);
    try {
      // A texture finishing decode (onLoaded) doesn't guarantee the renderer
      // has actually painted a frame with it yet — that happens on the next
      // rAF tick. Give it a couple of frames before capturing, or the
      // thumbnail comes out solid black.
      await new Promise(r => setTimeout(r, 150));
      const captureW = isFullscreen ? windowSize.w : width;
      const captureH = isFullscreen ? windowSize.h : height;
      const dataUrl = await captureCanvasScreenshot(viewerWrapRef, captureW, captureH, { width: THUMB_W });
      if (dataUrl) {
        await uploadCarThumbnail({ variables: { id: photoId, data: dataUrl } });
        onThumbnailChanged?.();
      }
    } finally {
      setThumbSaving(false);
    }
  };

  // Auto-capture the very first time the freelook viewer renders a photo that
  // doesn't have a thumbnail yet — this is what generates the car card image
  // without needing a separate hidden viewer per card. Only fires in freelook
  // mode (dashName === ''); a dashboard-specific pan session never owns the
  // car's thumbnail. Anytime after that, the user re-captures via the button.
  const handleViewerLoaded = () => {
    if (autoCapturedRef.current) return;
    if (dashName || hasThumbnail || !photoId) return;
    autoCapturedRef.current = true;
    captureThumbnail();
  };

  return (
    <Stack tokens={{ childrenGap: 8 }}>
      <div ref={fullscreenRef} style={{ position: 'relative', width: isFullscreen ? '100vw' : width, height: isFullscreen ? '100vh' : height, background: '#000' }}>
        <div ref={viewerWrapRef} style={{ position: 'relative' }}>
          <Photo360CrossfadeViewer
            dayPhotoUrl={photoUrl}
            nightPhotoUrl={nightPhotoUrl}
            nightAmount={nightAmount}
            yaw={pan.yaw}
            pitch={pan.pitch}
            fov={pan.fov}
            roll={pan.roll}
            displayWidth={isFullscreen ? windowSize.w : width}
            displayHeight={isFullscreen ? windowSize.h : height}
            onChange={handleChange}
            onLoaded={handleViewerLoaded}
          />
          {!nightPhotoUrl && (
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(0, 0, 0, 0.850)',
              opacity: nightAmount,
              transition: 'opacity 2s ease',
              pointerEvents: 'none',
            }} />
          )}
        </div>
        <Stack horizontal tokens={{ childrenGap: 4 }} style={{ position: 'absolute', right: 8, bottom: 8 }}>
          {!dashName && photoId && (
            <button
              onClick={captureThumbnail}
              disabled={thumbSaving}
              title="Update the car card thumbnail from this view"
              style={{
                background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6, width: 40, height: 40, cursor: thumbSaving ? 'default' : 'pointer',
                fontSize: 20, color: '#fff', opacity: thumbSaving ? 0.6 : 1,
              }}
            >{thumbSaving ? '⏳' : '📷'}</button>
          )}
          <button
            onClick={onToggleNightMode}
            title={isNight ? 'Switch to day' : 'Switch to night'}
            style={{
              background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6, width: 40, height: 40, cursor: 'pointer',
              fontSize: 20, color: '#fff',
            }}
          >{isNight ? '☀️' : '🌙'}</button>
          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            style={{
              background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 6, width: 40, height: 40, cursor: 'pointer',
              fontSize: 20, color: '#fff',
            }}
          >{isFullscreen ? '⤡' : '⤢'}</button>
        </Stack>
      </div>
      <Form
        key="dash-pan-form"
        form={buildDashPanSchema(dashOptions, !dashName)}
        name="carDashPan"
        initialValues={{ dashName, ...pan }}
        onChange={handleDashPanFormChange}
      />
    </Stack>
  );
};

interface Props {
  carId: string;
  photoId?: string;
  photoUrl?: string;
  nightPhotoUrl?: string;
  hasThumbnail?: boolean;
  onThumbnailChanged?: () => void;
}

const DashPanEditor: React.FC<Props> = ({ carId, photoId, photoUrl, nightPhotoUrl, hasThumbnail, onThumbnailChanged }) => {
  const theme = getTheme();
  const [selectedDashName, setSelectedDashName] = useState('');
  const [resetCounter, setResetCounter] = useState(0);
  const { isNight, nightAmount, toggleNightMode } = useGlobalNightMode();

  const { data: dashData } = useQuery(GET_DASHBOARDS, { fetchPolicy: 'cache-and-network' });
  const { data: panData, refetch: refetchPans } = useQuery(GET_CAR_DASH_PANS, { fetchPolicy: 'cache-and-network' });
  const [removePan] = useMutation(REMOVE_CAR_DASH_PAN);

  const dash360s: Array<{ name: string; elements: string }> =
    ((dashData as any)?.getDashboardEntries ?? [])
      .filter((d: any) => d.dashboard?.baseDashType === '360')
      .map((d: any) => ({ name: d.name, elements: d.dashboard?.elements }));
  const carDashPans: CarDashPanRecord[] = (panData as any)?.getCarDashPans ?? [];
  const override = carDashPans.find(p => p.carId === carId && p.dashName === selectedDashName);
  const selectedDash = dash360s.find(d => d.name === selectedDashName);
  const basePan = selectedDash ? parseDashBasePan(selectedDash.elements) : DEFAULT_PAN;
  const initialPan: Pan = selectedDashName ? (override ?? basePan) : DEFAULT_PAN;

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);
  const height = Math.round(width * 9 / 16);

  const handleReset = async () => {
    if (!override) return;
    if (!(await confirmAsync(`Reset this car's pan for "${selectedDashName}" back to the dashboard's default?`, { danger: true, confirmText: 'Reset' }))) return;
    await removePan({ variables: { id: override.id } });
    await refetchPans();
    setResetCounter(c => c + 1);
  };

  const dashOptions = [
    { text: '— look around freely —', value: '' },
    ...dash360s.map(d => ({ text: d.name, value: d.name })),
  ];

  return (
    <Stack tokens={{ childrenGap: 8 }}>
      <Stack horizontal horizontalAlign="space-between" verticalAlign="start">
        <Stack tokens={{ childrenGap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: '0.95em' }}>Per-Dashboard Pan</span>
          <span style={{ fontSize: '0.82em', opacity: 0.6 }}>
            The same dashboard can be reused across cars whose photos don't line up identically.
            Pick a dashboard to nudge this car's pan; leave it unselected to just look around.
          </span>
        </Stack>
        {selectedDashName && override && (
          <IconButton
            iconProps={{ iconName: 'Delete' }}
            title="Reset to dashboard default"
            onClick={handleReset}
          />
        )}
      </Stack>

      <div ref={containerRef} style={{ width: '100%' }}>
        {photoUrl ? (
          <PanSession
            key={`${selectedDashName}-${resetCounter}`}
            carId={carId}
            dashName={selectedDashName}
            dashOptions={dashOptions}
            onDashNameChange={setSelectedDashName}
            photoUrl={photoUrl}
            nightPhotoUrl={nightPhotoUrl}
            isNight={isNight}
            nightAmount={nightAmount}
            onToggleNightMode={toggleNightMode}
            width={width}
            height={height}
            initialPan={initialPan}
            existingId={override?.id}
            onPersisted={refetchPans}
            photoId={photoId}
            hasThumbnail={hasThumbnail}
            onThumbnailChanged={onThumbnailChanged}
          />
        ) : (
          <Stack
            verticalAlign="center"
            horizontalAlign="center"
            style={{ width: '100%', aspectRatio: '16 / 9', background: theme.palette.neutralLighter, borderRadius: 4 }}
          >
            <span style={{ opacity: 0.5, fontSize: '0.85em' }}>Upload a 360° photo for this car above to preview it here.</span>
          </Stack>
        )}
      </div>
    </Stack>
  );
};

export default DashPanEditor;
