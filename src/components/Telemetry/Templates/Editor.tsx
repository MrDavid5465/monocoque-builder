import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Stack, IconButton, getTheme, useQuery } from '../../../lib/denim/lib';
import dispatcher from '../../../lib/denim/lib/queries';
import Canvas, { CanvasHandle } from '../DashboardDesigner/Canvas';
import ObjectExplorer from '../DashboardDesigner/ObjectExplorer';
import { useTelemetryPlayback, SequenceConfig } from '../DashboardDesigner/useTelemetryPlayback';
import { useLiveTelemetry } from '../useLiveTelemetry';
import { useTemplates, DashTemplate } from '../DashboardDesigner/useTemplates';
import { DashboardConfig, ComponentNode } from '../../../types/dashboard';
import { mockSprites } from '../../../mock/dashboardMock';
import { detectTemplateType } from '../DashboardDesigner/components/utils';
import { captureNodeThumbnail } from '../DashboardDesigner/useScreenshot';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';
import {
  findNodeById,
  updateNodeById,
  deleteNodeById,
  addChildToNode,
  flattenNodes,
  moveNode,
  isDescendantOf,
} from '../DashboardDesigner/components/utils';

interface Props {
  template: DashTemplate;
}

const SPRITE_FILES = mockSprites.map(s => ({ file: s.file, label: s.label, thumbnail: s.thumbnail }));

const TemplateEditor: React.FC<Props> = ({ template }) => {
  const navigate = useNavigate();
  const theme = getTheme();
  const border = `1px solid ${theme.palette.neutralLight}`;

  const { updateTemplate, saveTemplate, removeTemplate, uploadThumbnail, templates } = useTemplates();
  const canvasRef = useRef<CanvasHandle>(null);

  const [components, setComponents] = useState<ComponentNode[]>([template.component]);
  const [templateName, setTemplateName] = useState(template.name);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('left');

  // Keep local state in sync if the template is updated externally (subscription)
  useEffect(() => {
    setComponents([template.component]);
    setTemplateName(template.name);
    setIsDirty(false);
  }, [template.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const { editorCanvasW, editorCanvasH } = useMemo(() => {
    const PAD = 40;
    const MIN_W = 40, MIN_H = 40;
    function contentSize(node: ComponentNode): { w: number; h: number } {
      if (node.type === 'group' && node.children?.length) {
        let maxX = 0, maxY = 0;
        for (const child of node.children) {
          const { w, h } = contentSize(child);
          maxX = Math.max(maxX, (child.x ?? 0) + w);
          maxY = Math.max(maxY, (child.y ?? 0) + h);
        }
        return { w: maxX, h: maxY };
      }
      return { w: node.width ?? 100, h: node.height ?? 100 };
    }
    const root = components[0];
    if (!root) return { editorCanvasW: MIN_W, editorCanvasH: MIN_H };
    const { w, h } = contentSize(root);
    return {
      editorCanvasW: Math.max((root.x ?? 0) + w + PAD, MIN_W),
      editorCanvasH: Math.max((root.y ?? 0) + h + PAD, MIN_H),
    };
  }, [components]);

  const fakeDashboard = useMemo<DashboardConfig>(() => ({
    name: templateName,
    baseDashType: 'sprite',
    path: '',
    canvasWidth: editorCanvasW,
    canvasHeight: editorCanvasH,
    dayNight: false,
    neckFx: false,
    components,
    kioskExitButton: { x: 9999, y: 9999, opacity: 0 },
  }), [templateName, components, editorCanvasW, editorCanvasH]);

  // Telemetry playback for preview
  const [sequenceConfig, setSequenceConfig] = useState<SequenceConfig>({
    type: 'sweep',
    params: { durationMs: 2000, peak: 0.9, holdMs: 300, loop: false },
  });
  const [playing, setPlaying] = useState(false);
  const [previewTelemetry, setPreviewTelemetry] = useState<Record<string, number> | null>(null);
  const flatNodes = useMemo(() => flattenNodes(components), [components]);
  const playbackData = useTelemetryPlayback(playing ? sequenceConfig : null, flatNodes, () => setPlaying(false));
  const { values: liveData } = useLiveTelemetry(true);
  const { data: myData } = useQuery(dispatcher.my, { fetchPolicy: 'cache-first' });
  const globalSteerMaxDeg: number = (myData as any)?.my?.settings?.steerMaxDeg ?? 400;
  const telemetryData = previewTelemetry ? { ...liveData, ...previewTelemetry } : (playing ? playbackData : liveData);

  const markDirty = useCallback(() => setIsDirty(true), []);

  const updateNode = useCallback((id: string, patch: Partial<ComponentNode>) => {
    setComponents(prev => {
      const node = findNodeById(prev, id);
      if (!node) return prev;
      const finalPatch = { ...patch };
      if (node.type === 'needle-gauge' && patch.type === undefined) {
        if (patch.width !== undefined && (node.width ?? 1) > 0 && node.rotationX !== undefined)
          finalPatch.rotationX = Math.round(node.rotationX * patch.width / (node.width ?? 1));
        if (patch.height !== undefined && (node.height ?? 1) > 0 && node.rotationY !== undefined)
          finalPatch.rotationY = Math.round(node.rotationY * patch.height / (node.height ?? 1));
      }
      return updateNodeById(prev, id, finalPatch);
    });
    markDirty();
  }, [markDirty]);

  const addNode = useCallback((node: ComponentNode, parentId: string | null) => {
    setComponents(prev => addChildToNode(prev, parentId, node));
    setSelectedId(node.id);
    markDirty();
  }, [markDirty]);

  const deleteNode = useCallback((id: string) => {
    setComponents(prev => deleteNodeById(prev, id));
    if (selectedId === id) setSelectedId(null);
    markDirty();
  }, [selectedId, markDirty]);

  const handleMoveNode = useCallback((nodeId: string, targetId: string, mode: 'before' | 'after' | 'inside') => {
    setComponents(prev => {
      if (nodeId === targetId) return prev;
      if (isDescendantOf(prev, nodeId, targetId)) return prev;
      return moveNode(prev, nodeId, targetId, mode);
    });
    markDirty();
  }, [markDirty]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const rootComponent: ComponentNode = components.length === 1
        ? components[0]
        : { id: `group-template-${Date.now()}`, type: 'group', name: templateName, x: 0, y: 0, children: components };
      const gaugeType = detectTemplateType(rootComponent);
      await updateTemplate(template.id, { name: templateName, gaugeType, component: JSON.stringify(rootComponent) });

      const thumb = await captureNodeThumbnail(
        () => canvasRef.current?.getCanvasEl() ?? null,
        rootComponent,
        editorCanvasW,
        editorCanvasH,
      );
      if (thumb) await uploadThumbnail(template.id, thumb);

      setIsDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!(await confirmAsync(`Delete template "${templateName}"? This cannot be undone.`, { danger: true }))) return;
    await removeTemplate(template.id);
    navigate('/telemetryadmin/templates');
  };

  const onUpdateDashboard = useCallback((patch: Partial<DashboardConfig>) => {
    if (patch.name !== undefined) { setTemplateName(patch.name); setIsDirty(true); }
  }, []);

  const explorerProps = {
    isTemplate: true,
    dashboard: fakeDashboard,
    sprites: SPRITE_FILES,
    selectedId,
    onSelect: setSelectedId,
    onUpdate: updateNode,
    onUpdateDashboard,
    onDelete: deleteNode,
    onDeleteDashboard: handleDelete,
    onFlip: () => setPanelSide(s => s === 'left' ? 'right' : 'left'),
    isDirty,
    onSave: handleSave,
    onMoveNode: handleMoveNode,
    onSaveTemplate: saveTemplate,
    sequenceConfig,
    onSequenceConfigChange: setSequenceConfig,
    playing,
    onTogglePlay: () => setPlaying(p => !p),
    onPreviewTelemetry: setPreviewTelemetry,
    templates,
    onAdd: addNode,
    onRemoveTemplate: removeTemplate,
  };

  return (
    <Stack style={{ height: 'calc(100vh - 3.85em)', width: '100%', overflow: 'hidden' }}>
      {/* Header bar */}
      <Stack
        horizontal
        verticalAlign="center"
        tokens={{ childrenGap: 8 }}
        style={{ flexShrink: 0, padding: '0 12px', height: 36, borderBottom: border, background: theme.palette.neutralLighterAlt }}
      >
        <IconButton
          iconProps={{ iconName: 'Back' }}
          title="Back to templates"
          onClick={() => navigate('/telemetryadmin/templates')}
          styles={{ root: { height: 28, width: 28 } }}
        />
        <input
          value={templateName}
          onChange={e => { setTemplateName(e.target.value); markDirty(); }}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: `1px solid ${theme.palette.neutralTertiaryAlt}`,
            color: theme.palette.neutralPrimary,
            fontSize: '0.9em',
            fontWeight: 600,
            width: 240,
            padding: '2px 4px',
            outline: 'none',
          }}
        />
        <span style={{ fontSize: '0.75em', opacity: 0.5, marginLeft: 4 }}>Template</span>
        <Stack.Item grow />
        {isDirty && (
          <span style={{ fontSize: '0.78em', color: theme.palette.themePrimary, opacity: 0.8 }}>Unsaved changes</span>
        )}
        <button
          onClick={handleSave}
          disabled={!isDirty || saving}
          style={{
            padding: '4px 14px', border: 'none', borderRadius: 3, cursor: isDirty ? 'pointer' : 'default',
            background: isDirty ? theme.palette.themePrimary : theme.palette.neutralLight,
            color: isDirty ? '#fff' : theme.palette.neutralTertiary,
            fontSize: '0.82em', fontWeight: 600,
          }}
        >
          {saving ? 'Saving…' : 'Save Template'}
        </button>
      </Stack>

      {/* Designer panels — minHeight:0 lets the flex child actually fill remaining height */}
      <Stack horizontal style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
        {panelSide === 'left' && <ObjectExplorer {...explorerProps} />}
        <Stack.Item grow style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            <Canvas
              ref={canvasRef}
              dashboard={fakeDashboard}
              sprites={SPRITE_FILES}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onUpdate={updateNode}
              kioskMode={false}
              telemetryData={telemetryData}
              globalSteerMaxDeg={globalSteerMaxDeg}
              activeTool="transform"
            />
          </div>
        </Stack.Item>
        {panelSide === 'right' && <ObjectExplorer {...explorerProps} />}
      </Stack>
    </Stack>
  );
};

export default TemplateEditor;
