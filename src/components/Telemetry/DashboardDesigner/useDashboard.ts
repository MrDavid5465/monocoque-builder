import { useState, useEffect, useCallback, useRef, RefObject } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { DashboardConfig, BaseDashType, ComponentNode, ComponentType, SpriteElement } from '../../../types/dashboard';
import { mockDashboard, mockSprites, builtInSprites } from '../../../mock/dashboardMock';
import { captureDayNightThumbnails } from './useScreenshot';
import { CanvasHandle } from './Canvas';
import { DEFAULT_SWEEP_CONFIG } from './useTelemetryPlayback';
import {
  GET_DASHBOARD_ENTRY,
  ADD_DASHBOARD,
  UPDATE_DASHBOARD_ENTRY,
  UPDATE_DASHBOARD,
  REMOVE_DASHBOARD,
  SYNC_DASHBOARD_FILES,
  UPLOAD_DASHBOARD_FILE,
  DELETE_DASHBOARD_FILE,
  UPLOAD_DASHBOARD_THUMBNAILS,
} from './queries';

interface SpriteFile {
  file: string;
  label: string;
  thumbnail: string;
  id?: string;
  path?: string;
}

interface UseDashboardResult {
  dashboard: DashboardConfig | null;
  setDashboard: React.Dispatch<React.SetStateAction<DashboardConfig | null>>;
  sprites: SpriteFile[];
  isDirty: boolean;
  saveDashboard: () => Promise<void>;
  deleteDashboard: () => Promise<void>;
  savePanCoordinates: (yaw: number, pitch: number, fov: number, roll: number) => void;
  savePhotoEditing: (editing: boolean) => Promise<void>;
  uploadSprite: (file: File) => Promise<void>;
  deleteSprite: (spriteId: string) => Promise<void>;
  refetchSprites: () => void;
  copyBuiltinSprite: (filename: string) => Promise<void>;
  uploadSpriteData: (filename: string, dataUrl: string) => Promise<void>;
  uploadBackground: (dataUrl: string) => Promise<void>;
  loading: boolean;
  saving: boolean;
  canvasRef: RefObject<CanvasHandle>;
  forceNightPreview: boolean | undefined;
  rawDashboardId: string | undefined;
  handleDashboardUpdate: (event: any) => void;
}

function apiBase() {
  return `http://${window.location.hostname}:9000`;
}

function fileProxyUrl(absolutePath: string) {
  return `${apiBase()}/file-proxy?path=${encodeURIComponent(absolutePath)}`;
}

async function urlToDataUrl(url: string): Promise<string | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Migrate v1 flat SpriteElement[] to v2 ComponentNode[].
// Needle x/y in v1 = canvas pivot; in v2 x/y = image top-left.
function migrateV1(v1: any[]): ComponentNode[] {
  const typeMap: Record<string, ComponentType> = {
    'sprite-static': 'static-sprite',
    'sprite-needle': 'needle-gauge',
    'sprite-bar':    'bar-gauge',
  };
  return (v1 as SpriteElement[]).map(el => {
    const type: ComponentType = typeMap[el.type] ?? 'static-sprite';
    return {
      id:      el.id,
      type,
      name:    el.id,
      x:       el.x,   // needles already stored pivot-point coords in v1
      y:       el.y,
      file:    el.file,
      width:   el.width,
      height:  el.height,
      backlit: el.backlit,
      rotationX: el.rotationX,
      rotationY: el.rotationY,
      binding:   el.binding,
    } as ComponentNode;
  });
}

function parseDashboardExtra(raw: string | null | undefined): Partial<DashboardConfig> {
  try {
    const p = JSON.parse(raw ?? '{}');
    if (typeof p !== 'object' || !p) return {};
    return {
      bgOverflow:           p.bgOverflow,
      bgOffsetX:            p.bgOffsetX,
      bgOffsetY:            p.bgOffsetY,
      neckFxGainX:          p.neckFxGainX,
      neckFxGainY:          p.neckFxGainY,
      neckFxDisableX:       p.neckFxDisableX,
      neckFxDisableY:       p.neckFxDisableY,
      photo360Yaw:          p.photo360Yaw   ?? 0,
      photo360Pitch:        p.photo360Pitch ?? 0,
      photo360Fov:          p.photo360Fov   ?? 90,
      photo360Roll:         p.photo360Roll  ?? 0,
      photo360Editing:      p.photo360Editing,
      photo360LiveKiosk:    p.photo360LiveKiosk,
      nightModeButton:      p.nightModeButton ?? false,
      intendedScreenWidth:  p.intendedScreenWidth,
      intendedScreenHeight: p.intendedScreenHeight,
      sequenceConfig:       p.sequenceConfig ?? DEFAULT_SWEEP_CONFIG,
    };
  } catch { return {}; }
}

function parseComponents(raw: string | null | undefined): ComponentNode[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 2 && Array.isArray(parsed.components)) return parsed.components;
    if (Array.isArray(parsed)) return migrateV1(parsed);
  } catch {}
  return [];
}

// `entry` is a DashboardEntry (id/name/path + nested `dashboard` content,
// possibly null for a brand-new record with no content yet).
function parseGqlDashboard(entry: any): DashboardConfig {
  const raw = entry.dashboard ?? {};
  // Normalize GQL nulls to typed defaults so Form.tsx onChange-on-mount comparisons
  // always match the initial form values, avoiding extra setDashboard commits.
  return {
    name:         entry.name,
    baseDashType: raw.baseDashType as BaseDashType,
    path:         entry.path,
    canvasWidth:  raw.canvasWidth  ?? 1920,
    canvasHeight: raw.canvasHeight ?? 1080,
    background:   raw.background ?? undefined,
    dayNight:     raw.dayNight ?? false,
    neckFx:       raw.neckFx   ?? false,
    ...parseDashboardExtra(raw.elements),
    components:   parseComponents(raw.elements),
    kioskExitButton: { x: raw.kioskX ?? 0, y: raw.kioskY ?? 0, opacity: raw.kioskOpacity ?? 0 },
    groupIds: (() => { try { return JSON.parse(raw.groupIds ?? '[]'); } catch { return []; } })(),
  };
}

// Entry-level fields (updateDashboardEntry) — everything else in
// DashboardConfig lives on the content record (dashboardToInput below).
function dashboardEntryToInput(config: DashboardConfig) {
  return {
    name: config.name,
    path: config.path,
  };
}

function dashboardToInput(config: DashboardConfig) {
  return {
    baseDashType: config.baseDashType,
    canvasWidth:  config.canvasWidth,
    canvasHeight: config.canvasHeight,
    background:   config.background ?? null,
    dayNight:     config.dayNight,
    neckFx:       config.neckFx,
    elements:     JSON.stringify({
      v: 2,
      components:           config.components,
      bgOverflow:           config.bgOverflow,
      bgOffsetX:            config.bgOffsetX,
      bgOffsetY:            config.bgOffsetY,
      neckFxGainX:          config.neckFxGainX,
      neckFxGainY:          config.neckFxGainY,
      neckFxDisableX:       config.neckFxDisableX,
      neckFxDisableY:       config.neckFxDisableY,
      photo360Yaw:          config.photo360Yaw,
      photo360Pitch:        config.photo360Pitch,
      photo360Fov:          config.photo360Fov,
      photo360Roll:         config.photo360Roll,
      photo360Editing:      config.photo360Editing,
      photo360LiveKiosk:    config.photo360LiveKiosk,
      nightModeButton:      config.nightModeButton,
      intendedScreenWidth:  config.intendedScreenWidth,
      intendedScreenHeight: config.intendedScreenHeight,
      sequenceConfig:       config.sequenceConfig,
    }),
    kioskX:       config.kioskExitButton.x,
    kioskY:       config.kioskExitButton.y,
    kioskOpacity: config.kioskExitButton.opacity,
    // thumbnailDay/thumbnailNight are deliberately omitted — they're set
    // exclusively via uploadDashboardThumbnails (see saveDashboard below),
    // never through this generic update. Omitting them here leaves whatever
    // is already stored untouched, same as explicitly re-sending it.
    groupIds:     JSON.stringify(config.groupIds ?? []),
  };
}

export function useDashboard(dashboardName: string): UseDashboardResult {
  const [localDashboard, setLocalDashboardState] = useState<DashboardConfig | null>(null);
  const [sprites, setSprites] = useState<SpriteFile[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [forceNightPreview, setForceNightPreview] = useState<boolean | undefined>(undefined);
  const savedRef = useRef<string>('');
  const canvasRef = useRef<CanvasHandle>(null);
  const rawDashboardRef = useRef<any>(null);
  const isDirtyRef = useRef(false);
  const localDashboardRef = useRef<DashboardConfig | null>(null);
  const panSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: dashEntryData, loading: listLoading } = useQuery(GET_DASHBOARD_ENTRY, {
    variables: { name: dashboardName },
    fetchPolicy: 'cache-and-network',
  });

  const rawDashboard = (dashEntryData as any)?.getDashboardEntry ?? null;
  rawDashboardRef.current = rawDashboard;

  const { data: filesData, refetch: refetchFiles } = useQuery(SYNC_DASHBOARD_FILES, {
    variables: { dashboardId: rawDashboard?.id ?? '' },
    skip: !rawDashboard?.id,
    fetchPolicy: 'cache-and-network',
  });

  const [updateDashboardEntryMutation] = useMutation(UPDATE_DASHBOARD_ENTRY);
  const [updateDashboardMutation] = useMutation(UPDATE_DASHBOARD);
  const [removeDashboardMutation] = useMutation(REMOVE_DASHBOARD);
  const [uploadFileMutation]      = useMutation(UPLOAD_DASHBOARD_FILE);
  const [deleteFileMutation]      = useMutation(DELETE_DASHBOARD_FILE);
  const [uploadThumbnailsMutation] = useMutation(UPLOAD_DASHBOARD_THUMBNAILS);

  const handleDashboardUpdate = useCallback((event: any) => {
    if (!event || event.operationName !== 'update') return;
    if (event.value?.id !== rawDashboardRef.current?.id) return;
    if (isDirtyRef.current) return;
    const parsed = parseGqlDashboard(event.value);
    if (JSON.stringify(parsed) === savedRef.current) return;
    setLocalDashboardState(parsed);
    savedRef.current = JSON.stringify(parsed);
  }, []);

  useEffect(() => {
    if (rawDashboard) {
      const parsed = parseGqlDashboard(rawDashboard);
      const serialized = JSON.stringify(parsed);
      // Bail out if data hasn't actually changed (catches Strict Mode double-invocation
      // and cache-and-network returning identical data on the network pass).
      if (serialized === savedRef.current) return;
      setLocalDashboardState(parsed);
      savedRef.current = serialized;
      isDirtyRef.current = false;
      setIsDirty(false);
    } else if (!listLoading) {
      setLocalDashboardState(mockDashboard);
      savedRef.current = JSON.stringify(mockDashboard);
      setIsDirty(false);
      const api = apiBase();
      const apiMockSprites = mockSprites.map(s => ({
        ...s,
        thumbnail: `${api}/dash-sprites/${s.file}`,
      }));
      const dashPath = mockDashboard.path;
      const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif']);
      fetch(`${api}/list-files?path=${encodeURIComponent(dashPath)}`)
        .then(r => r.json())
        .then((files: string[]) => {
          if (!Array.isArray(files) || files.length === 0) { setSprites(apiMockSprites); return; }
          const scanned: SpriteFile[] = files
            .filter(f => IMAGE_EXTS.has(f.split('.').pop()?.toLowerCase() ?? ''))
            .map(f => ({ file: f, label: f.replace(/\.\w+$/, ''), thumbnail: fileProxyUrl(`${dashPath}/${f}`) }));
          setSprites(scanned.length ? scanned : apiMockSprites);
        })
        .catch(() => setSprites(apiMockSprites));
    }
  }, [rawDashboard?.id, listLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const files = (filesData as any)?.syncDashboardFiles;
    if (!rawDashboard || !files) return;
    const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif']);
    const newSprites: SpriteFile[] = files
      .filter((f: any) => IMAGE_EXTS.has(f.filename.split('.').pop()?.toLowerCase() ?? ''))
      .map((f: any) => ({
        id:        f.id,
        path:      f.path,
        file:      f.filename,
        label:     f.filename.replace(/\.\w+$/, ''),
        thumbnail: `${apiBase()}${f.url}`,
      }));
    const api = apiBase();
    const builtIn = builtInSprites.map(s => ({ ...s, thumbnail: `${api}/dash-sprites/${s.file}` }));
    const userFileSet = new Set(newSprites.map(s => s.file));
    setSprites([...builtIn.filter(s => !userFileSet.has(s.file)), ...newSprites]);
  }, [filesData, rawDashboard?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDashboard: React.Dispatch<React.SetStateAction<DashboardConfig | null>> = useCallback((update) => {
    setLocalDashboardState(prev => {
      const next = typeof update === 'function' ? (update as any)(prev) : update;
      // Bail out without a state update if nothing actually changed, preventing
      // infinite loops when schema-driven forms fire onChange on mount.
      if (next && prev && JSON.stringify(next) === JSON.stringify(prev)) return prev;
      const dirty = !!(next && JSON.stringify(next) !== savedRef.current);
      isDirtyRef.current = dirty;
      setIsDirty(dirty);
      return next;
    });
  }, []);

  const saveDashboard = useCallback(async () => {
    if (!localDashboard) return;
    setSaving(true);
    try {
      const canvasEl = canvasRef.current?.getCanvasEl();
      let thumbnails: { thumbnailDay?: string; thumbnailNight?: string } = {};
      if (canvasEl) {
        const ref = { current: canvasEl } as RefObject<HTMLDivElement>;
        thumbnails = await captureDayNightThumbnails(
          ref,
          localDashboard.canvasWidth,
          localDashboard.canvasHeight,
          localDashboard.dayNight,
          (isDark) => setForceNightPreview(isDark),
        );
        setForceNightPreview(undefined);
      }
      const raw = rawDashboardRef.current;
      if (raw?.id) {
        await updateDashboardEntryMutation({
          variables: { id: raw.id, update: dashboardEntryToInput(localDashboard) },
        });
        await updateDashboardMutation({
          variables: { id: raw.id, update: dashboardToInput(localDashboard) },
        });
        if (thumbnails.thumbnailDay || thumbnails.thumbnailNight) {
          await uploadThumbnailsMutation({
            variables: { id: raw.id, dayData: thumbnails.thumbnailDay, nightData: thumbnails.thumbnailNight },
          });
        }
      } else {
        console.log('Mock save (no backend dashboard):', localDashboard);
      }
      savedRef.current = JSON.stringify(localDashboard);
      isDirtyRef.current = false;
      setIsDirty(false);
    } finally {
      setSaving(false);
    }
  }, [localDashboard, updateDashboardEntryMutation, updateDashboardMutation, uploadThumbnailsMutation]);

  const uploadSprite = useCallback(async (file: File) => {
    const raw = rawDashboardRef.current;
    if (!raw?.id) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await uploadFileMutation({
      variables: { dashboardId: raw.id, name: file.name, data: dataUrl },
    });
    refetchFiles();
  }, [uploadFileMutation, refetchFiles]);

  const deleteSprite = useCallback(async (path: string) => {
    const raw = rawDashboardRef.current;
    if (!raw?.id) return;
    await deleteFileMutation({ variables: { dashboardId: raw.id, path } });
    refetchFiles();
  }, [deleteFileMutation, refetchFiles]);

  const deleteDashboard = useCallback(async () => {
    const raw = rawDashboardRef.current;
    if (raw?.id) await removeDashboardMutation({ variables: { id: raw.id } });
  }, [removeDashboardMutation]);

  const uploadBackground = useCallback(async (dataUrl: string) => {
    const raw = rawDashboardRef.current;
    if (!raw?.id) return;
    const filename = `background_${Date.now()}.png`;
    await uploadFileMutation({
      variables: { dashboardId: raw.id, name: filename, data: dataUrl },
    });
    // Persist the new background filename immediately so it survives page reloads.
    // Use the server's current state as the base to avoid auto-saving unsaved local changes.
    // thumbnailDay/thumbnailNight no longer need explicit preservation here —
    // dashboardToInput omits them entirely, which the generic update already
    // treats as "leave untouched".
    const baseParsed = parseGqlDashboard(raw);
    await updateDashboardMutation({
      variables: {
        id: raw.id,
        update: dashboardToInput({ ...baseParsed, background: filename }),
      },
    });
    savedRef.current = JSON.stringify({ ...baseParsed, background: filename });
    setDashboard(prev => prev ? { ...prev, background: filename } : null);
    refetchFiles();
  }, [uploadFileMutation, updateDashboardMutation, setDashboard, refetchFiles]);

  const uploadSpriteData = useCallback(async (filename: string, dataUrl: string) => {
    const raw = rawDashboardRef.current;
    if (!raw?.id) return;
    await uploadFileMutation({
      variables: { dashboardId: raw.id, name: filename, data: dataUrl },
    });
    refetchFiles();
  }, [uploadFileMutation, refetchFiles]);

  const copyBuiltinSprite = useCallback(async (filename: string) => {
    const dataUrl = await urlToDataUrl(`${apiBase()}/dash-sprites/${encodeURIComponent(filename)}`);
    if (!dataUrl) return;
    await uploadSpriteData(filename, dataUrl);
  }, [uploadSpriteData]);

  // Keep ref in sync so savePanCoordinates can read the current state without
  // adding localDashboard to its useCallback deps (which would recreate it on every render).
  useEffect(() => {
    localDashboardRef.current = localDashboard;
  }, [localDashboard]);

  // Debounced auto-save of 360° pan coordinates. Saves only the pan fields applied on top
  // of the last persisted state, so any other unsaved edits remain dirty.
  const savePanCoordinates = useCallback((yaw: number, pitch: number, fov: number, roll: number) => {
    if (panSaveTimeoutRef.current) clearTimeout(panSaveTimeoutRef.current);
    panSaveTimeoutRef.current = setTimeout(async () => {
      const raw = rawDashboardRef.current;
      if (!raw?.id || !savedRef.current) return;
      const savedState = JSON.parse(savedRef.current) as DashboardConfig;
      const panUpdated = { ...savedState, photo360Yaw: yaw, photo360Pitch: pitch, photo360Fov: fov, photo360Roll: roll };
      try {
        await updateDashboardMutation({ variables: { id: raw.id, update: dashboardToInput(panUpdated) } });
        savedRef.current = JSON.stringify(panUpdated);
        setIsDirty(!!(localDashboardRef.current && JSON.stringify(localDashboardRef.current) !== savedRef.current));
      } catch {
        // best-effort; no user feedback — the main Save button is always available
      }
    }, 800);
  }, [updateDashboardMutation]);

  // Immediately saves the photo360Editing flag so the kiosk knows to switch between
  // live viewer and baked screenshot. Not debounced — needs to happen right away.
  const savePhotoEditing = useCallback(async (editing: boolean) => {
    const raw = rawDashboardRef.current;
    if (!raw?.id || !savedRef.current) return;
    const savedState = JSON.parse(savedRef.current) as DashboardConfig;
    const updated = { ...savedState, photo360Editing: editing };
    try {
      await updateDashboardMutation({ variables: { id: raw.id, update: dashboardToInput(updated) } });
      savedRef.current = JSON.stringify(updated);
    } catch {}
  }, [updateDashboardMutation]);

  return {
    dashboard: localDashboard,
    setDashboard,
    sprites,
    isDirty,
    saveDashboard,
    deleteDashboard,
    savePanCoordinates,
    savePhotoEditing,
    uploadSprite,
    deleteSprite,
    refetchSprites: refetchFiles,
    copyBuiltinSprite,
    uploadSpriteData,
    uploadBackground,
    loading: listLoading && !localDashboard,
    saving,
    canvasRef,
    forceNightPreview,
    rawDashboardId: rawDashboard?.id as string | undefined,
    handleDashboardUpdate,
  };
}

export function useCreateDashboard() {
  const [addDashboard] = useMutation(ADD_DASHBOARD);

  const create = useCallback(async (input: { name: string; baseDashType: BaseDashType; path: string }) => {
    const entry = { name: input.name, path: input.path };
    const content = {
      baseDashType: input.baseDashType,
      canvasWidth:  1280,
      canvasHeight: 800,
      background:   null,
      dayNight:     false,
      neckFx:       false,
      elements:     JSON.stringify({ v: 2, components: [] }),
      kioskX:       1240,
      kioskY:       20,
      kioskOpacity: 0.15,
      thumbnailDay:   null,
      thumbnailNight: null,
      groupIds:       '[]',
    };

    try {
      const result = await addDashboard({ variables: { entry, content } });
      return (result.data as any)?.addDashboard ?? null;
    } catch (e) {
      console.error('Failed to create dashboard:', e);
      return null;
    }
  }, [addDashboard]);

  return { create };
}
