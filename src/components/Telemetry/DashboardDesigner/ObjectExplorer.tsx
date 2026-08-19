import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Stack, IconButton, Icon, PrimaryButton, DefaultButton, getTheme, useQuery, Form } from '../../../lib/denim/lib';
import { ComponentNode, DashboardConfig, ComponentType } from '../../../types/dashboard';
import { SequenceConfig, DEFAULT_SWEEP_CONFIG, DEFAULT_SINE_CONFIG } from './useTelemetryPlayback';
import { getSchema, ALL_SCHEMAS } from './components/registry';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';
import { findNodeById, flattenNodes, isDescendantOf } from './components/utils';
import { GET_DASH_GROUPS } from '../Groups/queries';
import { Section } from '../../../lib/per-form';
import { GamepadMapping } from '../../../lib/denim/lib/queries';
import ComponentPicker, { PICKER_WIDTH } from './ComponentPicker';
import { DashTemplate } from './useTemplates';
import { DraggingBindingField, buildBindingFieldSchema, buildBindingInitialValues, reassembleBinding } from './components/telemetryBinding';

type DropMode = 'before' | 'after' | 'inside';

interface SpriteFile { file: string; label: string; thumbnail: string; id?: string; }

interface Props {
  dashboard: DashboardConfig;
  sprites: SpriteFile[];
  gamepadMappings?: GamepadMapping[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<ComponentNode>) => void;
  onUpdateDashboard: (patch: Partial<DashboardConfig>) => void;
  onDelete: (id: string) => void;
  onDeleteDashboard: () => void;
  onFlip: () => void;
  isDirty: boolean;
  onSave: () => void;
  onMoveNode: (nodeId: string, targetId: string, mode: DropMode) => void;
  // Bumped by the parent whenever a canvas drag/resize commits, so the
  // properties Form below (uncontrolled, snapshots once) remounts and
  // re-syncs to the node's latest x/y/width/height.
  formRevision?: number;
  // Editor-only manual telemetry preview — see PlaybackPanel.
  manualPreviewFraction?: number | null;
  onManualPreviewFractionChange?: (v: number | null) => void;
  // Editor-only: forces every bound element into the test sweep, ignoring
  // per-binding startupSweep opt-out — see PlaybackPanel.
  forceAllParticipate?: boolean;
  onForceAllParticipateChange?: (v: boolean) => void;
  onSaveTemplate: (node: ComponentNode) => void;
  sequenceConfig: SequenceConfig;
  onSequenceConfigChange: (config: SequenceConfig) => void;
  playing: boolean;
  onTogglePlay: () => void;
  onPreviewTelemetry: (data: Record<string, number> | null) => void;
  // Callback to generate per-node thumbnails from the live canvas.
  // Returns an empty Map when a screenshot isn't possible; caller falls back to icons.
  onGenerateThumbnails?: () => Promise<Map<string, string>>;
  isTemplate?: boolean;
  editing360?: boolean;
  onChange360?: (yaw: number, pitch: number, fov: number, roll: number) => void;
  templates: DashTemplate[];
  onAdd: (element: ComponentNode, parentId: string | null) => void;
  onRemoveTemplate: (id: string) => void;
  onUpload?: (file: File) => Promise<void>;
  onDeleteSprite?: (spriteId: string) => Promise<void>;
  builtInSpriteFiles?: Set<string>;
  onCopyBuiltinSprite?: (filename: string) => Promise<void>;
  onUploadSpriteData?: (filename: string, dataUrl: string) => Promise<void>;
  onReloadSprites?: () => void;
}

const LIST_FULL_WIDTH = 200;
const LIST_MINI_WIDTH = 64;
const PROPERTIES_WIDTH = 320;

const ObjectExplorer: React.FC<Props> = ({
  dashboard, sprites, gamepadMappings = [], selectedId, onSelect, onUpdate, onUpdateDashboard,
  onDelete, onDeleteDashboard, onFlip, isDirty, onSave, onMoveNode, formRevision, onSaveTemplate,
  manualPreviewFraction, onManualPreviewFractionChange,
  forceAllParticipate, onForceAllParticipateChange,
  sequenceConfig, onSequenceConfigChange, playing, onTogglePlay, onPreviewTelemetry,
  onGenerateThumbnails, isTemplate, editing360, onChange360,
  templates, onAdd, onRemoveTemplate, onUpload, onDeleteSprite,
  builtInSpriteFiles, onCopyBuiltinSprite, onUploadSpriteData, onReloadSprites,
}) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [listExpanded, setListExpanded] = React.useState(true);
  const [propertiesOpen, setPropertiesOpen] = React.useState(false);

  React.useEffect(() => {
    if (editing360) setPropertiesOpen(true);
  }, [editing360]);
  const [thumbnails, setThumbnails] = React.useState<Map<string, string>>(new Map());
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(() => {
    const ids = new Set<string>();
    flattenNodes(dashboard.components).forEach(n => { if (n.children?.length) ids.add(n.id); });
    return ids;
  });
  const [dragNodeId, setDragNodeId] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{ nodeId: string; mode: DropMode } | null>(null);
  // Tree reordering uses pointer events rather than the native HTML5 Drag and
  // Drop API — draggable/dragstart/dragover/drop is unreliable in the native
  // Tauri window (WebKitGTK's DnD bridge under Wayland silently rejects every
  // drop, always showing the "not allowed" cursor, even though the same code
  // works fine in a plain browser tab). Canvas.tsx's node-dragging already
  // avoids this the same way, via onPointerDown/pointermove — mirrored here.
  const dragStateRef = useRef<{ nodeId: string; startX: number; startY: number; dragging: boolean } | null>(null);
  const dropTargetRef = useRef<{ nodeId: string; mode: DropMode } | null>(null);
  const didDragRef = useRef(false);
  const DRAG_THRESHOLD_PX = 4;

  // Regenerate thumbnails 800ms after the node structure settles (debounced to
  // avoid firing during rapid drag). Falls back to icons for any node that
  // can't be captured (incomplete config, canvas not yet mounted, etc.).
  React.useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const map = onGenerateThumbnails ? await onGenerateThumbnails() : new Map<string, string>();
      if (!cancelled) setThumbnails(map);
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [dashboard.components]); // eslint-disable-line react-hooks/exhaustive-deps

  const theme = getTheme();
  const border = `1px solid ${theme.palette.neutralLight}`;
  const selectedBg = theme.palette.neutralQuaternaryAlt;
  const listW = listExpanded ? LIST_FULL_WIDTH : LIST_MINI_WIDTH;
  const propsW = propertiesOpen ? PROPERTIES_WIDTH : 0;

  const selectedNode = selectedId ? findNodeById(dashboard.components, selectedId) : null;

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleNodeClick = (id: string | null) => {
    if (id === selectedId && propertiesOpen) {
      setPropertiesOpen(false);
    } else {
      onSelect(id);
      setPropertiesOpen(true);
    }
  };

  const TYPE_ICON: Record<ComponentType, string> = {
    'group':               'GroupObject',
    'static-sprite':       'Picture',
    'needle-gauge':        'Rotate',
    'bar-gauge':           'ProgressRingDots',
    'sprite-bar-gauge':    'ProgressRingDots',
    'text-gauge':          'Font',
    'sprite-text-gauge':   'NumberSymbol',
    'graph-bar-gauge':     'BarChart4',
    'flag-display':        'Flag',
    'flag-display-sprite': 'Flag',
    'button-control':      'ToggleLeft',
    'slider-control':      'Slider',
    'encoder-control':     'Settings',
    'gif-gauge':             'GIF',
    'arc-gauge-face':        'CircleRing',
    'sprite-arc-gauge-face': 'NumberField',
    'transform-sprite':      'ArrowTallUpRight',
    'sprite-arc-fill':       'CircleHalfFull',
    'clock-text':            'Clock',
    'clock-sprite':          'Clock',
  };

  // Hit-tests whatever tree row is actually under the pointer (via elementFromPoint,
  // since pointer capture keeps move/up events targeted at the origin row rather than
  // whatever's under the cursor) and computes the same before/after/inside drop mode
  // the old dragover-based calcDropMode used, just fed a real DOM rect instead of one
  // off a DragEvent.
  const dropTargetAtPoint = (clientX: number, clientY: number, draggedNodeId: string): { nodeId: string; mode: DropMode } | null => {
    const el = document.elementFromPoint(clientX, clientY);
    const row = (el as HTMLElement | null)?.closest('[data-tree-node-id]') as HTMLElement | null;
    const nodeId = row?.dataset.treeNodeId;
    if (!row || !nodeId || nodeId === draggedNodeId) return null;
    if (isDescendantOf(dashboard.components, draggedNodeId, nodeId)) return null;
    const targetNode = findNodeById(dashboard.components, nodeId);
    if (!targetNode) return null;
    const rect = row.getBoundingClientRect();
    const pct = (clientY - rect.top) / rect.height;
    const mode: DropMode = pct < 0.28 ? 'before' : pct > 0.72 ? 'after' : (targetNode.type === 'group' ? 'inside' : (pct > 0.5 ? 'after' : 'before'));
    return { nodeId, mode };
  };

  const updateDropTarget = (val: { nodeId: string; mode: DropMode } | null) => {
    dropTargetRef.current = val;
    setDropTarget(val);
  };

  const handleTreePointerDown = (e: React.PointerEvent<HTMLElement>, nodeId: string) => {
    if (e.button !== 0) return;
    // preventDefault suppresses WebKitGTK's native text-selection-drag gesture,
    // which native draggable used to swallow as a side effect — pointer events
    // alone don't, so without this a drag also highlights the row's text.
    e.preventDefault();
    dragStateRef.current = { nodeId, startX: e.clientX, startY: e.clientY, dragging: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleTreePointerMove = (e: React.PointerEvent<HTMLElement>, nodeId: string) => {
    const state = dragStateRef.current;
    if (!state || state.nodeId !== nodeId) return;
    if (!state.dragging) {
      if (Math.hypot(e.clientX - state.startX, e.clientY - state.startY) < DRAG_THRESHOLD_PX) return;
      state.dragging = true;
      didDragRef.current = true;
      setDragNodeId(nodeId);
    }
    updateDropTarget(dropTargetAtPoint(e.clientX, e.clientY, nodeId));
  };

  const handleTreePointerUp = (e: React.PointerEvent<HTMLElement>, nodeId: string) => {
    const state = dragStateRef.current;
    if (state?.dragging && dropTargetRef.current) {
      onMoveNode(nodeId, dropTargetRef.current.nodeId, dropTargetRef.current.mode);
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    dragStateRef.current = null;
    setDragNodeId(null);
    updateDropTarget(null);
  };

  // The browser still fires a normal click after a drag's pointerdown/pointerup pair
  // (pointer capture keeps both targeted at the origin row) — swallow that one click
  // so finishing a real drag doesn't also re-select the node that was just dropped.
  const handleTreeClick = (nodeId: string) => {
    if (didDragRef.current) { didDragRef.current = false; return; }
    handleNodeClick(nodeId);
  };

  const dropStyle = (nodeId: string): React.CSSProperties => {
    if (!dropTarget || dropTarget.nodeId !== nodeId) return {};
    if (dropTarget.mode === 'before') return { borderTop: `2px solid ${theme.palette.themePrimary}` };
    if (dropTarget.mode === 'after')  return { borderBottom: `2px solid ${theme.palette.themePrimary}` };
    return { background: theme.palette.neutralQuaternaryAlt, outline: `1px solid ${theme.palette.themePrimary}` };
  };

  const renderTreeNode = (node: ComponentNode, depth: number) => {
    const isSelected = node.id === selectedId && propertiesOpen;
    const isExpanded = expandedIds.has(node.id);
    const hasChildren = !!node.children?.length;
    const indent = depth * 14;

    return (
      <React.Fragment key={node.id}>
        <Stack
          horizontal
          verticalAlign="center"
          tokens={{ childrenGap: 2 }}
          data-tree-node-id={node.id}
          onPointerDown={e => handleTreePointerDown(e, node.id)}
          onPointerMove={e => handleTreePointerMove(e, node.id)}
          onPointerUp={e => handleTreePointerUp(e, node.id)}
          onClick={() => handleTreeClick(node.id)}
          style={{
            padding: `0.3em 0.4em 0.3em ${0.4 + indent / 16}em`,
            cursor: 'grab',
            background: isSelected ? selectedBg : undefined,
            userSelect: 'none',
            WebkitUserSelect: 'none',
            opacity: dragNodeId === node.id ? 0.4 : 1,
            boxSizing: 'border-box',
            ...dropStyle(node.id),
          }}
          title={node.name || node.type}
        >
          {hasChildren ? (
            <Icon
              iconName={isExpanded ? 'ChevronDown' : 'ChevronRight'}
              style={{ fontSize: 10, width: 14, flexShrink: 0, color: theme.palette.neutralTertiary }}
              onClick={e => toggleExpand(node.id, e)}
            />
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}
          {thumbnails.has(node.id) ? (
            <img
              src={thumbnails.get(node.id)}
              alt=""
              style={{ width: 28, height: 28, objectFit: 'contain', flexShrink: 0, borderRadius: 2, display: 'block' }}
            />
          ) : (
            <Icon
              iconName={TYPE_ICON[node.type] ?? 'Unknown'}
              style={{ fontSize: 16, width: 28, textAlign: 'center', flexShrink: 0 }}
            />
          )}
          {listExpanded && (
            <span style={{ fontSize: '0.85em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.name || node.type}
            </span>
          )}
        </Stack>
        {hasChildren && isExpanded && node.children!.map(child => renderTreeNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  if (pickerOpen) {
    return (
      <Stack
        style={{
          width: PICKER_WIDTH,
          flexShrink: 0,
          borderRight: border,
          height: '100%',
          overflow: 'hidden',
          transition: 'width 200ms ease',
        }}
      >
        <ComponentPicker
          sprites={sprites}
          dashboard={dashboard}
          selectedId={selectedId}
          templates={templates}
          onAdd={onAdd}
          onRemoveTemplate={onRemoveTemplate}
          onUpload={onUpload}
          onDeleteSprite={onDeleteSprite}
          builtInSpriteFiles={builtInSpriteFiles}
          onCopyBuiltinSprite={onCopyBuiltinSprite}
          onUploadSpriteData={onUploadSpriteData}
          onReloadSprites={onReloadSprites}
          onClose={() => setPickerOpen(false)}
        />
      </Stack>
    );
  }

  return (
    <Stack
      style={{
        width: listW + propsW,
        flexShrink: 0,
        borderRight: border,
        height: '100%',
        overflow: 'hidden',
        transition: 'width 200ms ease',
      }}
    >
      {/* Header */}
      <Stack
        horizontal
        verticalAlign="center"
        tokens={{ childrenGap: 4 }}
        style={{ padding: '0 0.25em 0 0.5em', borderBottom: border, flexShrink: 0 }}
      >
        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dashboard.name}
        </span>
        <IconButton
          iconProps={{ iconName: playing ? 'Stop' : 'Play' }}
          title={playing ? 'Stop sweep' : 'Gauge sweep'}
          onClick={onTogglePlay}
          styles={{ root: { height: 28, width: 28 } }}
        />
        <IconButton
          iconProps={{ iconName: 'Add' }}
          title="Add component"
          onClick={() => setPickerOpen(true)}
          styles={{ root: { height: 28, width: 28 } }}
        />
        <IconButton
          iconProps={{ iconName: 'Switch' }}
          title="Mirror panel layout"
          onClick={onFlip}
          styles={{ root: { height: 28, width: 28 } }}
        />
      </Stack>

      <Stack horizontal style={{ flex: 1, overflow: 'hidden' }}>
        {/* Tree list */}
        <Stack
          style={{
            width: listW, flexShrink: 0, borderRight: border,
            overflow: 'hidden', transition: 'width 200ms ease',
          }}
        >
          <Stack horizontal horizontalAlign="end" style={{ borderBottom: border, flexShrink: 0 }}>
            <IconButton
              iconProps={{ iconName: listExpanded ? 'DoubleChevronLeft' : 'DoubleChevronRight' }}
              title={listExpanded ? 'Collapse' : 'Expand'}
              onClick={() => setListExpanded(v => !v)}
              styles={{ root: { height: 28, width: 28 } }}
            />
          </Stack>

          <Stack style={{ overflowY: 'auto', flex: 1 }}>
            {/* Dashboard settings entry */}
            <Stack
              horizontal
              verticalAlign="center"
              tokens={{ childrenGap: 4 }}
              onClick={() => handleNodeClick(null)}
              style={{
                padding: '0.4em',
                cursor: 'pointer',
                background: selectedId === null && propertiesOpen ? selectedBg : undefined,
                borderBottom: border,
                userSelect: 'none',
              }}
              title={isTemplate ? 'Template settings' : 'Dashboard settings'}
            >
              <span style={{ width: 14, flexShrink: 0 }} />
              <Icon iconName="Settings" style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }} />
              {listExpanded && (
                <span style={{ fontSize: '0.85em', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isTemplate ? 'Template' : 'Dashboard'}
                </span>
              )}
            </Stack>

            {dashboard.components.map(node => renderTreeNode(node, 0))}
          </Stack>
        </Stack>

        {/* Properties panel */}
        {propertiesOpen && (
          <Stack style={{ width: PROPERTIES_WIDTH, flexShrink: 0, height: '100%', overflow: 'hidden' }}>
            {/* Props header */}
            <Stack
              horizontal
              verticalAlign="center"
              style={{ padding: '0 0.25em 0 0.5em', borderBottom: border, flexShrink: 0 }}
            >
              <span style={{ flex: 1, fontSize: '0.85em', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {editing360 ? '360° Pan' : selectedNode ? (selectedNode.name || selectedNode.type) : (isTemplate ? 'Template settings' : 'Dashboard settings')}
              </span>
              {!editing360 && selectedNode && (
                <IconButton
                  iconProps={{ iconName: 'Delete' }}
                  title="Delete component"
                  onClick={() => { onDelete(selectedNode.id); setPropertiesOpen(false); }}
                  styles={{ root: { height: 28, width: 28 } }}
                />
              )}
              <IconButton
                iconProps={{ iconName: 'Cancel' }}
                title="Close properties"
                onClick={() => setPropertiesOpen(false)}
                styles={{ root: { height: 28, width: 28 } }}
              />
            </Stack>

            {/* Scrollable content */}
            <Stack style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '0.5em' }} tokens={{ childrenGap: 8 }}>
              {editing360 ? (
                <Photo360PanForm dashboard={dashboard} onChange={onChange360} />
              ) : selectedNode ? (
                <ComponentPropertiesPanel
                  node={selectedNode}
                  sprites={sprites}
                  gamepadMappings={gamepadMappings}
                  onUpdate={patch => onUpdate(selectedNode.id, patch)}
                  onPreviewTelemetry={onPreviewTelemetry}
                  onSaveAsTemplate={selectedNode.type === 'group' ? () => onSaveTemplate(selectedNode) : undefined}
                  formRevision={formRevision}
                />
              ) : (
                <DashboardPropertiesPanel
                  dashboard={dashboard}
                  sprites={sprites}
                  onUpdate={onUpdateDashboard}
                  sequenceConfig={sequenceConfig}
                  onSequenceConfigChange={onSequenceConfigChange}
                  playing={playing}
                  onTogglePlay={onTogglePlay}
                  manualPreviewFraction={manualPreviewFraction}
                  onManualPreviewFractionChange={onManualPreviewFractionChange}
                  forceAllParticipate={forceAllParticipate}
                  onForceAllParticipateChange={onForceAllParticipateChange}
                />
              )}
            </Stack>

            {/* Bottom save bar — not shown while pan-editing, which auto-saves */}
            {!editing360 && (
              <Stack style={{ padding: '0.5em', borderTop: border, flexShrink: 0 }} tokens={{ childrenGap: 6 }}>
                {selectedId === null && (
                  <IconButton
                    iconProps={{ iconName: 'Delete' }}
                    title="Remove dashboard from config (files kept)"
                    onClick={async () => {
                      if (await confirmAsync('Remove this dashboard? Files on disk will not be deleted.', { danger: true, confirmText: 'Remove' })) {
                        onDeleteDashboard();
                      }
                    }}
                    styles={{ root: { alignSelf: 'flex-start' } }}
                  />
                )}
                <PrimaryButton disabled={!isDirty} onClick={onSave}>Save</PrimaryButton>
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// 360° pan controls (yaw/pitch/fov/roll) — shown in place of the normal
// properties panel content while live-editing a 360° dashboard's background.
// ---------------------------------------------------------------------------
const PHOTO360_PAN_SCHEMA = {
  photo360Yaw:   { type: 'slider', label: 'Yaw (°)',      min: -360, max: 360, step: 1 },
  photo360Pitch: { type: 'slider', label: 'Pitch (°)',    min: -85,  max: 85,  step: 1 },
  photo360Fov:   { type: 'slider', label: 'Zoom (FOV °)', min: 5,    max: 120, step: 1 },
  photo360Roll:  { type: 'slider', label: 'Roll (°)',     min: -180, max: 180, step: 1 },
};

const Photo360PanForm: React.FC<{
  dashboard: DashboardConfig;
  onChange?: (yaw: number, pitch: number, fov: number, roll: number) => void;
}> = ({ dashboard, onChange }) => {
  const initial = {
    photo360Yaw:   dashboard.photo360Yaw   ?? 0,
    photo360Pitch: dashboard.photo360Pitch ?? 0,
    photo360Fov:   dashboard.photo360Fov   ?? 90,
    photo360Roll:  dashboard.photo360Roll  ?? 0,
  };

  return (
    <Stack tokens={{ childrenGap: 4 }}>
      <span style={{ fontSize: '0.78em', opacity: 0.6 }}>
        Drag the 360° preview to pan, or use these sliders for precise adjustments.
      </span>
      <Form
        key={dashboard.path || dashboard.name}
        form={PHOTO360_PAN_SCHEMA}
        name="photo360Pan"
        initialValues={initial}
        onChange={(_n: string, { raw }: any) => onChange?.(
          Number(raw.photo360Yaw ?? 0),
          Number(raw.photo360Pitch ?? 0),
          Number(raw.photo360Fov ?? 90),
          Number(raw.photo360Roll ?? 0),
        )}
      />
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Component properties panel
// ---------------------------------------------------------------------------
const TYPE_SELECT_SCHEMA = {
  type: { type: 'select' as const, label: 'Type', options: ALL_SCHEMAS.map(s => ({ text: s.label, value: s.type })) },
};

const ComponentPropertiesPanel: React.FC<{
  node: ComponentNode;
  sprites: { file: string; label: string; thumbnail: string }[];
  gamepadMappings: GamepadMapping[];
  onUpdate: (patch: Partial<ComponentNode>) => void;
  onPreviewTelemetry?: (data: Record<string, number> | null) => void;
  onSaveAsTemplate?: () => void;
  formRevision?: number;
}> = ({ node, sprites, gamepadMappings, onUpdate, onPreviewTelemetry, onSaveAsTemplate, formRevision }) => {
  const theme = getTheme();
  // Runtime data schema factory functions need to fill in field options they
  // can't know statically — today, just the sprite file list (see
  // components/types.ts's SchemaProps / ComponentSchemaSource). getSchema
  // resolves both plain-object and factory-function schemas the same way.
  const spriteOptions = useMemo(
    () => [{ text: '— none —', value: '' }, ...sprites.map(s => ({ text: s.label, value: s.file }))],
    [sprites],
  );
  const schema = useMemo(() => getSchema(node.type, { spriteOptions }), [node.type, spriteOptions]);

  // Telemetry binding's "Advanced expression" always starts collapsed, even
  // if an expression was previously saved (matches the field's original,
  // documented behavior) — local UI state, not derived from node data, so it
  // must be reset explicitly on node switch since this panel isn't remounted
  // per node (only the Form below is, via its own key).
  const [advancedEnabled, setAdvancedEnabled] = useState(false);
  useEffect(() => setAdvancedEnabled(false), [node.id]);
  const draggingBindingField = useRef<DraggingBindingField>(null);

  // The min/max drag preview (below) deliberately stays applied after you let
  // go, instead of reverting to inputMin — otherwise every binding you edit
  // snaps back to its rest position the instant you release, defeating the
  // point of previewing where the boundary lands. It only needs clearing when
  // you move on to a different node/binding, so that stops being confusing.
  useEffect(() => {
    return () => { onPreviewTelemetry?.(null); };
  }, [node.id, onPreviewTelemetry]);

  const hasBinding = !!node.binding;
  const hasInfluence = !!node.binding?.influence;

  // `schema` above already has real sprite `options` baked in (resolved via
  // getSchema/spriteOptions) — the one runtime-injection left here is
  // `gamepad-select`, whose mapping list isn't part of SchemaProps (it's
  // slated for replacement by a generalized `list` field, not migrated to
  // the schema-factory pattern — see the form-schema skill). Bindable
  // schemas (`schema.bindable`) get the telemetry binding sub-schema merged
  // directly into this same fields object — same Form, same Section
  // grouping, not a field type or a Form of its own.
  const perFormSchema = useMemo(() => {
    const out: Record<string, any> = {};
    for (const [key, field] of Object.entries(schema.fields)) {
      out[key] = field.type === 'gamepad-select' ? { ...field, gamepadMappings } : field;
    }
    if (schema.bindable) {
      Object.assign(out, buildBindingFieldSchema(
        node.binding, advancedEnabled,
        f => { draggingBindingField.current = f; },
        () => { draggingBindingField.current = null; },
        schema.bindingHint,
      ));
    }
    return out;
  }, [schema, gamepadMappings, node.binding, advancedEnabled, onPreviewTelemetry]);

  // per-form's onChange fires with the whole current form state on every
  // change, always passing the form's own name (not the changed field) as
  // the first arg — diff against node's current values and patch only what
  // actually changed. Object-shaped fields (binding) compare by value, not
  // reference, since per-form's internal state may hand back a new object
  // reference for a field that wasn't touched.
  const handleFormChange = (_formName: string, { raw }: any) => {
    const patch: Partial<ComponentNode> = {};
    let changed = false;
    for (const key of Object.keys(schema.fields)) {
      const nextVal = raw[key];
      const curVal = (node as any)[key];
      const isEqual = typeof nextVal === 'object' || typeof curVal === 'object'
        ? JSON.stringify(nextVal ?? null) === JSON.stringify(curVal ?? null)
        : nextVal === curVal;
      if (!isEqual) {
        (patch as any)[key] = nextVal;
        changed = true;
      }
    }

    if (schema.bindable) {
      if (raw.advancedEnabled !== advancedEnabled) setAdvancedEnabled(!!raw.advancedEnabled);
      const nextBinding = reassembleBinding(raw, advancedEnabled);
      if (JSON.stringify(nextBinding ?? null) !== JSON.stringify(node.binding ?? null)) {
        patch.binding = nextBinding;
        changed = true;
      }
      const dragging = draggingBindingField.current;
      if (dragging) {
        if (dragging === 'inputMin' || dragging === 'inputMax') {
          onPreviewTelemetry?.({ [raw.field]: raw[dragging] });
        } else {
          // Output sliders preview using the input side's configured range,
          // not the output value itself — showing what raw input produces
          // that output. Intentional asymmetry, matches the field's
          // original design.
          onPreviewTelemetry?.({ [raw.field]: dragging === 'outputMin' ? raw.inputMin : raw.inputMax });
        }
      }
    }

    if (changed) onUpdate(patch);
  };

  const initialValues = Object.fromEntries(
    Object.keys(schema.fields).map(key => [key, (node as any)[key]])
  );
  if (schema.bindable) {
    Object.assign(initialValues, buildBindingInitialValues(node.binding, advancedEnabled));
  }

  const handleTypeChange = (newType: ComponentType) => {
    if (newType === node.type) return;
    const patch: Partial<ComponentNode> = { type: newType, binding: undefined };
    const pivX = node.rotationX ?? Math.round((node.width ?? 100) / 2);
    const pivY = node.rotationY ?? Math.round((node.height ?? 100) * 0.94);

    if (node.type === 'needle-gauge' && newType !== 'needle-gauge') {
      // needle x/y = pivot → convert to top-left for non-needle types
      patch.x = node.x - pivX;
      patch.y = node.y - pivY;
      patch.rotationX = undefined;
      patch.rotationY = undefined;
    } else if (node.type !== 'needle-gauge' && newType === 'needle-gauge') {
      // top-left x/y → convert to pivot for needle
      const newRX = Math.round((node.width ?? 100) / 2);
      const newRY = Math.round((node.height ?? 100) * 0.94);
      patch.x = node.x + newRX;
      patch.y = node.y + newRY;
      patch.rotationX = newRX;
      patch.rotationY = newRY;
    } else {
      // non-needle to non-needle — no coord conversion needed
      patch.rotationX = undefined;
      patch.rotationY = undefined;
    }
    onUpdate(patch);
  };

  return (
    <Stack tokens={{ childrenGap: 8 }}>
      {/* Type selector */}
      <Form
        key={`type-${node.id}`}
        form={TYPE_SELECT_SCHEMA}
        name="componentType"
        initialValues={{ type: node.type }}
        onChange={(_n: string, { raw }: any) => handleTypeChange(raw.type as ComponentType)}
      />

      {node.type === 'group' && onSaveAsTemplate && (
        <DefaultButton
          onClick={onSaveAsTemplate}
          title="Save this group as a reusable global template"
          styles={{ root: { alignSelf: 'flex-start', height: 28, fontSize: '0.82em' } }}
        >
          Save as Template
        </DefaultButton>
      )}

      <div style={{ borderTop: `1px solid ${theme.palette.neutralLight}` }} />

      <Form
        key={`${node.id}-${hasBinding ? 'b' : 'nb'}-${advancedEnabled ? 'a' : 's'}-${hasInfluence ? 'i' : 'ni'}-${formRevision ?? 0}`}
        form={perFormSchema}
        name={`component-${node.id}`}
        initialValues={initialValues}
        onChange={handleFormChange}
      />

      {/* Encoder: per-position button mapping */}
      {node.type === 'encoder-control' && (() => {
        const count = node.encoderPositions ?? 5;
        const ids = node.encoderMappingIds ?? [];
        const btnMappings = gamepadMappings.filter(m => m.mappingType === 'button');
        return (
          <Stack tokens={{ childrenGap: 4 }} style={{ borderTop: `1px solid ${theme.palette.neutralLight}`, paddingTop: 6 }}>
            <span style={{ fontSize: '0.85em', fontWeight: 600 }}>Position → gamepad action</span>
            {Array.from({ length: count }, (_, i) => (
              <Stack key={i} horizontal verticalAlign="center" tokens={{ childrenGap: 6 }}>
                <span style={{ fontSize: '0.8em', minWidth: 56 }}>Position {i + 1}</span>
                <Stack style={{ flex: 1 }}>
                  <Form
                    key={`${node.id}-encoder-${i}`}
                    form={{
                      mapping: {
                        type: 'select' as const,
                        label: '',
                        options: [
                          { text: '— unassigned —', value: '' },
                          ...btnMappings.map(m => ({ text: `${m.name} (btn ${m.index})`, value: m.id })),
                        ],
                      },
                    }}
                    name={`encoderPos-${i}`}
                    initialValues={{ mapping: ids[i] ?? '' }}
                    onChange={(_n: string, { raw }: any) => {
                      const next = [...ids];
                      next[i] = String(raw.mapping ?? '');
                      onUpdate({ encoderMappingIds: next });
                    }}
                  />
                </Stack>
              </Stack>
            ))}
          </Stack>
        );
      })()}
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Dashboard settings panel
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Dashboard settings schemas
// ---------------------------------------------------------------------------
const DASH_CORE_SCHEMA = {
  name: { type: 'text', label: 'Name', required: true },
  path: { type: 'text', label: 'Folder path', styles: { field: { fontFamily: 'monospace', fontSize: '0.85em' } } },
  baseDashType: {
    type: 'select',
    label: 'Background type',
    section: 'Canvas',
    options: [
      { text: 'Image', value: 'sprite' },
      { text: '360° Photo', value: '360' },
    ],
  },
  canvasWidth: { type: 'slider', label: 'Canvas width', min: 320, max: 3840, step: 1, section: 'Canvas' },
  canvasHeight: { type: 'slider', label: 'Canvas height', min: 240, max: 2160, step: 1, section: 'Canvas' },
  dayNight: { type: 'checkbox', label: 'Day/Night mode', section: 'Canvas' },
  neckFx: { type: 'checkbox', label: 'NeckFX (motion sway)', section: 'Canvas' },
};

const DASH_DAY_NIGHT_SCHEMA = {
  nightModeButton: { type: 'checkbox', label: 'Show night toggle on kiosk' },
};

const DASH_BG_PARAMS_SCHEMA = {
  bgOverflow: { type: 'slider', label: 'Overflow (px each side)', min: 0, max: 2000, step: 10 },
  bgOffsetX: { type: 'slider', label: 'Offset X', min: -2000, max: 2000 },
  bgOffsetY: { type: 'slider', label: 'Offset Y', min: -2000, max: 2000 },
};

const DASH_NECKFX_SCHEMA = {
  neckFxGainX: { type: 'slider', label: 'X gain', min: 0, max: 5, step: 0.1 },
  neckFxGainY: { type: 'slider', label: 'Y gain', min: 0, max: 5, step: 0.1 },
  neckFxDisableX: { type: 'checkbox', label: 'Disable X axis' },
  neckFxDisableY: { type: 'checkbox', label: 'Disable Y axis' },
};

const DASH_KIOSK_SCHEMA = {
  x: { type: 'slider', label: 'X', min: 0, max: 3840 },
  y: { type: 'slider', label: 'Y', min: 0, max: 2160 },
  opacity: { type: 'slider', label: 'Opacity', min: 0, max: 1, step: 0.01 },
};

const DashboardPropertiesPanel: React.FC<{
  dashboard: DashboardConfig;
  sprites: { file: string; label: string }[];
  onUpdate: (patch: Partial<DashboardConfig>) => void;
  sequenceConfig: SequenceConfig;
  onSequenceConfigChange: (c: SequenceConfig) => void;
  playing: boolean;
  onTogglePlay: () => void;
  manualPreviewFraction?: number | null;
  onManualPreviewFractionChange?: (v: number | null) => void;
  forceAllParticipate?: boolean;
  onForceAllParticipateChange?: (v: boolean) => void;
}> = ({
  dashboard, sprites, onUpdate, sequenceConfig, onSequenceConfigChange, playing, onTogglePlay,
  manualPreviewFraction, onManualPreviewFractionChange,
  forceAllParticipate, onForceAllParticipateChange,
}) => {
  const { data: groupsData } = useQuery(GET_DASH_GROUPS);
  const groups: Array<{ id: string; name: string }> = (groupsData as any)?.getDashGroups ?? [];

  const bgSelectSchema = useMemo(() => ({
    background: {
      type: 'select',
      label: 'Background',
      options: [
        { text: 'None', value: '' },
        ...sprites.map(s => ({ text: s.label, value: s.file })),
      ],
    },
  }), [sprites]);

  const photo360Schema = useMemo(() => ({
    photo360File: {
      type: 'select',
      label: 'Default photo (fallback)',
      options: [
        { text: '— none —', value: '' },
        ...sprites.map(s => ({ text: s.label, value: s.file })),
      ],
    },
    intendedScreenWidth: { type: 'slider', label: 'Screen width (px)', min: 320, max: 7680 },
    intendedScreenHeight: { type: 'slider', label: 'Screen height (px)', min: 240, max: 4320 },
    photo360LiveKiosk: { type: 'checkbox', label: 'Always show live 360° (manage + kiosk)' },
  }), [sprites]);

  const formKey = dashboard.path || dashboard.name;

  // Memoize every initialValues object so per-form's useForm doesn't see a new
  // reference on every re-render and re-trigger its onChange useEffect.
  const coreInitial = useMemo(() => ({
    name: dashboard.name,
    path: dashboard.path,
    baseDashType: dashboard.baseDashType ?? 'sprite',
    canvasWidth: dashboard.canvasWidth,
    canvasHeight: dashboard.canvasHeight,
    dayNight: dashboard.dayNight ?? false,
    neckFx: dashboard.neckFx ?? false,
   
  }), [dashboard.name, dashboard.path, dashboard.baseDashType, dashboard.canvasWidth, dashboard.canvasHeight, dashboard.dayNight, dashboard.neckFx]);

  const bgInitial = useMemo(() => ({
    background: dashboard.background ?? '',
  }), [dashboard.background]);

  const bgParamsInitial = useMemo(() => ({
    bgOverflow: dashboard.bgOverflow ?? 0,
    bgOffsetX: dashboard.bgOffsetX ?? 0,
    bgOffsetY: dashboard.bgOffsetY ?? 0,
  }), [dashboard.bgOverflow, dashboard.bgOffsetX, dashboard.bgOffsetY]);

  const neckFxInitial = useMemo(() => ({
    neckFxGainX: dashboard.neckFxGainX ?? 1,
    neckFxGainY: dashboard.neckFxGainY ?? 1,
    neckFxDisableX: dashboard.neckFxDisableX ?? false,
    neckFxDisableY: dashboard.neckFxDisableY ?? false,
  }), [dashboard.neckFxGainX, dashboard.neckFxGainY, dashboard.neckFxDisableX, dashboard.neckFxDisableY]);

  const photo360Initial = useMemo(() => ({
    photo360File: dashboard.photo360File ?? '',
    intendedScreenWidth: dashboard.intendedScreenWidth ?? 1920,
    intendedScreenHeight: dashboard.intendedScreenHeight ?? 1080,
    photo360LiveKiosk: dashboard.photo360LiveKiosk ?? false,
  }), [dashboard.photo360File, dashboard.intendedScreenWidth, dashboard.intendedScreenHeight, dashboard.photo360LiveKiosk]);

  const dayNightInitial = useMemo(() => ({
    nightModeButton: dashboard.nightModeButton ?? false,
  }), [dashboard.nightModeButton]);

  const kioskInitial = useMemo(() => ({
    x: dashboard.kioskExitButton.x,
    y: dashboard.kioskExitButton.y,
    opacity: dashboard.kioskExitButton.opacity,
  }), [dashboard.kioskExitButton.x, dashboard.kioskExitButton.y, dashboard.kioskExitButton.opacity]);

  return (
    <Stack tokens={{ childrenGap: 8 }}>
      <Form
        key={formKey + '-core'}
        form={DASH_CORE_SCHEMA}
        name="dashCore"
        initialValues={coreInitial}
        onChange={(_n: string, { raw }: any) => onUpdate({
          name: String(raw.name ?? ''),
          path: String(raw.path ?? ''),
          baseDashType: raw.baseDashType ?? 'sprite',
          canvasWidth: Number(raw.canvasWidth),
          canvasHeight: Number(raw.canvasHeight),
          dayNight: Boolean(raw.dayNight),
          neckFx: Boolean(raw.neckFx),
        })}
      />

      <Section title="Background">
        <Form
          key={formKey + '-bg'}
          form={bgSelectSchema}
          name="dashBg"
          initialValues={bgInitial}
          onChange={(_n: string, { raw }: any) => onUpdate({ background: (raw.background as string) || undefined })}
        />
        {dashboard.background && (
          <Form
            key={formKey + '-bgparams'}
            form={DASH_BG_PARAMS_SCHEMA}
            name="dashBgParams"
            initialValues={bgParamsInitial}
            onChange={(_n: string, { raw }: any) => onUpdate({
              bgOverflow: Number(raw.bgOverflow ?? 0),
              bgOffsetX: Number(raw.bgOffsetX ?? 0),
              bgOffsetY: Number(raw.bgOffsetY ?? 0),
            })}
          />
        )}
      </Section>

      {dashboard.neckFx && (
        <Section title="NeckFX">
          <Form
            key={formKey + '-neckfx'}
            form={DASH_NECKFX_SCHEMA}
            name="dashNeckFx"
            initialValues={neckFxInitial}
            onChange={(_n: string, { raw }: any) => onUpdate({
              neckFxGainX: Number(raw.neckFxGainX ?? 1),
              neckFxGainY: Number(raw.neckFxGainY ?? 1),
              neckFxDisableX: Boolean(raw.neckFxDisableX),
              neckFxDisableY: Boolean(raw.neckFxDisableY),
            })}
          />
        </Section>
      )}

      {dashboard.dayNight && (
        <Section title="Day / Night">
          <Form
            key={formKey + '-daynight'}
            form={DASH_DAY_NIGHT_SCHEMA}
            name="dashDayNight"
            initialValues={dayNightInitial}
            onChange={(_n: string, { raw }: any) => onUpdate({
              nightModeButton: Boolean(raw.nightModeButton),
            })}
          />
        </Section>
      )}

      {dashboard.baseDashType === '360' && (
        <Section title="360° Source">
          <Form
            key={formKey + '-360'}
            form={photo360Schema}
            name="dash360"
            initialValues={photo360Initial}
            onChange={(_n: string, { raw }: any) => onUpdate({
              photo360File: (raw.photo360File as string) || undefined,
              intendedScreenWidth: Number(raw.intendedScreenWidth ?? 1920),
              intendedScreenHeight: Number(raw.intendedScreenHeight ?? 1080),
              photo360LiveKiosk: Boolean(raw.photo360LiveKiosk),
            })}
          />
        </Section>
      )}

      {groups.length > 0 && (
        <Section title="Groups">
          {groups.map((group) => {
            const checked = (dashboard.groupIds ?? []).includes(group.id);
            return (
              <Form
                key={`${formKey}-group-${group.id}`}
                form={{ checked: { type: 'checkbox' as const, label: group.name } }}
                name={`dashGroup-${group.id}`}
                initialValues={{ checked }}
                onChange={(_n: string, { raw }: any) => {
                  const current = dashboard.groupIds ?? [];
                  onUpdate({
                    groupIds: raw.checked
                      ? [...current, group.id]
                      : current.filter((g: string) => g !== group.id),
                  });
                }}
              />
            );
          })}
        </Section>
      )}

      <Section title="Kiosk exit button">
        <Form
          key={formKey + '-kiosk'}
          form={DASH_KIOSK_SCHEMA}
          name="dashKiosk"
          initialValues={kioskInitial}
          onChange={(_n: string, { raw }: any) => onUpdate({
            kioskExitButton: {
              ...dashboard.kioskExitButton,
              x: Number(raw.x ?? dashboard.kioskExitButton.x),
              y: Number(raw.y ?? dashboard.kioskExitButton.y),
              opacity: Number(raw.opacity ?? dashboard.kioskExitButton.opacity),
            },
          })}
        />
      </Section>

      <Section title="Test Sequence">
        <PlaybackPanel
          config={sequenceConfig}
          onChange={onSequenceConfigChange}
          playing={playing}
          onTogglePlay={onTogglePlay}
          formKey={formKey}
          manualPreviewFraction={manualPreviewFraction}
          onManualPreviewFractionChange={onManualPreviewFractionChange}
          forceAllParticipate={forceAllParticipate}
          onForceAllParticipateChange={onForceAllParticipateChange}
        />
      </Section>
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// Playback panel
// ---------------------------------------------------------------------------
const SEQUENCE_SWEEP_SCHEMA = {
  durationMs:  { type: 'slider', label: 'Ramp duration (ms)', min: 100, max: 10000, step: 100 },
  peakPercent: { type: 'slider', label: 'Peak (%)', min: 10, max: 100, step: 1 },
  holdMs:      { type: 'slider', label: 'Hold at peak (ms)', min: 0, max: 5000, step: 100 },
  loop:        { type: 'checkbox', label: 'Loop' },
};

const SEQUENCE_SINE_SCHEMA = {
  periodMs:         { type: 'slider', label: 'Period (ms)', min: 200, max: 30000, step: 100 },
  centerPercent:    { type: 'slider', label: 'Center (%)', min: 0, max: 100, step: 1 },
  amplitudePercent: { type: 'slider', label: 'Amplitude (%)', min: 1, max: 100, step: 1 },
  loop:             { type: 'checkbox', label: 'Loop' },
};

const MANUAL_PREVIEW_SCHEMA = {
  position: { type: 'slider', label: 'Preview position (%)', min: 0, max: 100, step: 1 },
};

const FORCE_PARTICIPATE_SCHEMA = {
  force: { type: 'checkbox', label: 'Force all elements to participate (ignore per-element opt-out)' },
};

const PlaybackPanel: React.FC<{
  config: SequenceConfig;
  onChange: (c: SequenceConfig) => void;
  playing: boolean;
  onTogglePlay: () => void;
  formKey?: string;
  manualPreviewFraction?: number | null;
  onManualPreviewFractionChange?: (v: number | null) => void;
  forceAllParticipate?: boolean;
  onForceAllParticipateChange?: (v: boolean) => void;
}> = ({
  config, onChange, playing, onTogglePlay, formKey = 'sequence',
  manualPreviewFraction, onManualPreviewFractionChange,
  forceAllParticipate = true, onForceAllParticipateChange,
}) => {
  const switchType = (type: 'sweep' | 'sine') => {
    if (type === config.type) return;
    onChange(type === 'sweep' ? DEFAULT_SWEEP_CONFIG : DEFAULT_SINE_CONFIG);
  };

  const PlayButton = playing ? DefaultButton : PrimaryButton;

  return (
    <Stack tokens={{ childrenGap: 8 }}>
      {onManualPreviewFractionChange && (
        <Stack tokens={{ childrenGap: 2 }}>
          <span style={{ fontSize: '0.78em', opacity: 0.6 }}>
            Holds every bound element at this value so hidden/rest-state elements
            (e.g. an arc fill at 0%) are visible to place. Suppressed while a test
            below is playing.
          </span>
          <Form
            key={`${formKey}-manualPreview`}
            form={MANUAL_PREVIEW_SCHEMA}
            name="manualPreview"
            initialValues={{ position: Math.round((manualPreviewFraction ?? 0) * 100) }}
            onChange={(_n: string, { raw }: any) => onManualPreviewFractionChange(Number(raw.position ?? 0) / 100)}
          />
        </Stack>
      )}

      {onForceAllParticipateChange && (
        <Form
          key={`${formKey}-forceParticipate`}
          form={FORCE_PARTICIPATE_SCHEMA}
          name="forceParticipate"
          initialValues={{ force: forceAllParticipate }}
          onChange={(_n: string, { raw }: any) => onForceAllParticipateChange(!!raw.force)}
        />
      )}

      <Stack horizontal verticalAlign="center" horizontalAlign="end">
        <PlayButton
          onClick={onTogglePlay}
          iconProps={{ iconName: playing ? 'Stop' : 'Play' }}
          styles={{ root: { height: 28 } }}
        >
          {playing ? 'Stop' : 'Play'}
        </PlayButton>
      </Stack>

      <Stack horizontal tokens={{ childrenGap: 4 }}>
        {(['sweep', 'sine'] as const).map(t => {
          const TypeButton = config.type === t ? PrimaryButton : DefaultButton;
          return (
            <TypeButton
              key={t}
              onClick={() => switchType(t)}
              styles={{ root: { flex: 1, height: 26, fontSize: '0.85em', minWidth: 0 } }}
            >
              {t === 'sweep' ? 'Gauge sweep' : 'Sine wave'}
            </TypeButton>
          );
        })}
      </Stack>

      {config.type === 'sweep' && (
        <Form
          key={`${formKey}-sweep`}
          form={SEQUENCE_SWEEP_SCHEMA}
          name="sequenceSweep"
          initialValues={{
            durationMs: config.params.durationMs,
            peakPercent: Math.round(config.params.peak * 100),
            holdMs: config.params.holdMs,
            loop: config.params.loop,
          }}
          onChange={(_n: string, { raw }: any) => onChange({
            type: 'sweep',
            params: {
              durationMs: Number(raw.durationMs ?? config.params.durationMs),
              peak: Number(raw.peakPercent ?? config.params.peak * 100) / 100,
              holdMs: Number(raw.holdMs ?? config.params.holdMs),
              loop: !!raw.loop,
            },
          })}
        />
      )}

      {config.type === 'sine' && (
        <Form
          key={`${formKey}-sine`}
          form={SEQUENCE_SINE_SCHEMA}
          name="sequenceSine"
          initialValues={{
            periodMs: config.params.periodMs,
            centerPercent: Math.round(config.params.center * 100),
            amplitudePercent: Math.round(config.params.amplitude * 100),
            loop: config.params.loop,
          }}
          onChange={(_n: string, { raw }: any) => onChange({
            type: 'sine',
            params: {
              periodMs: Number(raw.periodMs ?? config.params.periodMs),
              center: Number(raw.centerPercent ?? config.params.center * 100) / 100,
              amplitude: Number(raw.amplitudePercent ?? config.params.amplitude * 100) / 100,
              loop: !!raw.loop,
            },
          })}
        />
      )}
    </Stack>
  );
};

export default ObjectExplorer;
