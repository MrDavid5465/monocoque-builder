import React, { useRef, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { Stack, IconButton, Icon, PrimaryButton, DefaultButton, getTheme } from '../../../lib/denim/lib';
import { DashboardConfig, ComponentNode, ComponentType } from '../../../types/dashboard';
import { ALL_SCHEMAS, SPRITE_TYPES, FREEFORM_TYPES } from './components/registry';
import { findNodeById } from './components/utils';
import { DashTemplate, TemplateSprite } from './useTemplates';
import { deepCopyNode, collectFileRefs } from './components/utils';
import { GET_BUILTIN_TEMPLATES } from './queries';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';

interface SpriteFile {
  file: string;
  label: string;
  thumbnail: string;
  id?: string;
  path?: string;
}

interface Props {
  sprites: SpriteFile[];
  dashboard: DashboardConfig;
  selectedId: string | null;
  templates: DashTemplate[];
  onAdd: (element: ComponentNode, parentId: string | null) => void;
  onRemoveTemplate: (id: string) => void;
  onUpload?: (file: File) => Promise<void>;
  onDeleteSprite?: (spriteId: string) => Promise<void>;
  onClose: () => void;
  builtInSpriteFiles?: Set<string>;
  onCopyBuiltinSprite?: (filename: string) => Promise<void>;
  onUploadSpriteData?: (filename: string, dataUrl: string) => Promise<void>;
  onReloadSprites?: () => void;
}

export const PICKER_WIDTH = 240;

type PickerTab = 'new' | 'templates' | 'builtin';

const TEMPLATE_TYPE_META: Record<string, { label: string; icon: string }> = {
  needle:      { label: 'Needle gauge',  icon: 'Rotate' },
  bar:         { label: 'Bar gauge',     icon: 'ProgressRingDots' },
  digital:     { label: 'Digital gauge', icon: 'Calculator' },
  combination: { label: 'Combination',   icon: 'GroupObject' },
  none:        { label: 'Component',     icon: 'GroupObject' },
  flag:        { label: 'Flag display',  icon: 'Flag' },
};

const ComponentPicker: React.FC<Props> = ({
  sprites, dashboard, selectedId, templates, onAdd, onRemoveTemplate,
  onUpload, onDeleteSprite, onClose,
  builtInSpriteFiles, onCopyBuiltinSprite, onUploadSpriteData, onReloadSprites,
}) => {
  const [uploading, setUploading] = useState(false);
  const [activeType, setActiveType] = useState<ComponentType>('static-sprite');
  const [tab, setTab] = useState<PickerTab>('new');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const theme = getTheme();
  const border = `1px solid ${theme.palette.neutralLight}`;

  // Skip fetching until the user actually opens this tab.
  const { data: builtInData } = useQuery(GET_BUILTIN_TEMPLATES, { fetchPolicy: 'cache-first', skip: tab !== 'builtin' });
  const builtInTemplates: Array<{ id: string; name: string; gaugeType: string; component: string }> =
    (builtInData as any)?.getBuiltinTemplates ?? [];

  const parentId = (): string | null => {
    if (!selectedId) return null;
    const node = findNodeById(dashboard.components, selectedId);
    return node?.type === 'group' ? selectedId : null;
  };

  // Templates (saved or built-in) reference sprite filenames that may not
  // exist in this dashboard's own folder yet. Prefer bytes bundled with the
  // template itself (see useTemplates.ts's saveTemplate); fall back to a
  // best-effort copy from the global /dash-sprites/ store so the drop still
  // renders for templates saved before bundling existed.
  const copyMissingSprites = (node: ComponentNode, templateSprites?: TemplateSprite[]) => {
    const existing = new Set(sprites.map(s => s.file));
    for (const file of collectFileRefs(node)) {
      if (existing.has(file)) continue;
      const bundled = templateSprites?.find(s => s.filename === file);
      if (bundled && onUploadSpriteData) onUploadSpriteData(file, bundled.data);
      else if (onCopyBuiltinSprite) onCopyBuiltinSprite(file);
    }
  };

  const addNode = (file?: string) => {
    const schema = ALL_SCHEMAS.find(s => s.type === activeType)!;
    const isNeedle = activeType === 'needle-gauge';
    const cx = Math.round(dashboard.canvasWidth / 2);
    const cy = Math.round(dashboard.canvasHeight / 2);
    const node: ComponentNode = {
      id: `${activeType}-${Date.now()}`,
      type: activeType,
      name: file ? file.replace(/\.\w+$/, '') : schema.label,
      x: isFreeform ? cx : 0,
      y: isFreeform ? cy : 0,
      ...(file ? {
        file,
        width: 100,
        height: 100,
        backlit: false,
        ...(isNeedle ? { rotationX: 50, rotationY: 94 } : {}),
      } : {}),
      ...(activeType === 'text-gauge' ? { fontSize: 36, color: '#ffffff', format: 'integer' as const } : {}),
      ...(activeType === 'graph-bar-gauge' ? { width: 200, height: 24, graphType: 'h-bar' as const, colorLow: '#00cc44', colorHigh: '#cc2200', backgroundColor: '#222' } : {}),
      ...(activeType === 'clock-text' ? { fontSize: 36, color: '#ffffff', clockSource: 'real' as const, clockFormat: '24h' as const } : {}),
      ...(activeType === 'clock-sprite' ? { clockSource: 'real' as const, clockFormat: '24h' as const } : {}),
    };
    onAdd(node, parentId());
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !onUpload) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) await onUpload(file);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteSprite = async (e: { stopPropagation(): void }, sprite: SpriteFile) => {
    e.stopPropagation();
    if (!sprite.id || !sprite.path || !onDeleteSprite) return;
    if (!(await confirmAsync(`Remove "${sprite.label}" from this dashboard?`, { danger: true, confirmText: 'Remove' }))) return;
    await onDeleteSprite(sprite.path);
  };

  const needsSprite = SPRITE_TYPES.has(activeType);
  const isFreeform  = FREEFORM_TYPES.has(activeType);
  const activeSchema = ALL_SCHEMAS.find(s => s.type === activeType)!;

  return (
    <Stack style={{ width: '100%', flexShrink: 0, borderLeft: 'none', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <Stack
        horizontal
        horizontalAlign="space-between"
        verticalAlign="center"
        style={{ padding: '0.25em 0.5em', borderBottom: border, flexShrink: 0 }}
      >
        <span style={{ fontWeight: 600 }}>Add Component</span>
        <Stack horizontal tokens={{ childrenGap: 0 }}>
          {onReloadSprites && (
            <IconButton
              iconProps={{ iconName: 'Refresh' }}
              title="Reload sprites"
              onClick={onReloadSprites}
              styles={{ root: { height: 28, width: 28 } }}
            />
          )}
          {onUpload && (
            <>
              <IconButton
                iconProps={{ iconName: uploading ? 'Sync' : 'Upload' }}
                title="Upload image"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                styles={{ root: { height: 28, width: 28 } }}
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </>
          )}
          <IconButton
            iconProps={{ iconName: 'Cancel' }}
            title="Close"
            onClick={onClose}
            styles={{ root: { height: 28, width: 28 } }}
          />
        </Stack>
      </Stack>

      {/* Tab strip */}
      <Stack horizontal style={{ borderBottom: border, flexShrink: 0 }}>
        {(['new', 'templates', 'builtin'] as PickerTab[]).map(t => {
          const TabButton = tab === t ? PrimaryButton : DefaultButton;
          return (
            <TabButton
              key={t}
              onClick={() => setTab(t)}
              styles={{ root: { flex: 1, height: 26, minWidth: 0, fontSize: '0.78em', border: 'none', borderRadius: 0 } }}
            >
              {t === 'new' ? 'New' : t === 'templates' ? `My${templates.length ? ` (${templates.length})` : ''}` : 'Built-in'}
            </TabButton>
          );
        })}
      </Stack>

      {/* My Templates panel */}
      {tab === 'templates' && (
        <Stack style={{ overflowY: 'auto', flex: 1 }}>
          {templates.length === 0 && (
            <span style={{ padding: '1em', opacity: 0.5, fontSize: '0.85em' }}>
              Select a group in the Object Explorer and click "Save as Template".
            </span>
          )}
          {templates.map(tmpl => {
            const meta = TEMPLATE_TYPE_META[tmpl.gaugeType] ?? TEMPLATE_TYPE_META['none'];
            const thumb = localStorage.getItem(`dash_tmpl_thumb_${tmpl.id}`);
            return (
              <Stack
                key={tmpl.id}
                horizontal
                verticalAlign="center"
                tokens={{ childrenGap: 8 }}
                style={{ padding: '0.4em 0.5em', borderBottom: `1px solid ${theme.palette.neutralLighter}` }}
              >
                {thumb ? (
                  <img src={thumb} alt="" style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0, borderRadius: 2 }} />
                ) : (
                  <Icon iconName={meta.icon} style={{ fontSize: 18, width: 40, textAlign: 'center', flexShrink: 0 }} />
                )}
                <Stack style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '0.85em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tmpl.name}</span>
                  <span style={{ fontSize: '0.75em', opacity: 0.6 }}>{meta.label}</span>
                </Stack>
                <DefaultButton
                  styles={{ root: { fontSize: '0.75em', height: 24, minWidth: 0, flexShrink: 0 } }}
                  onClick={() => {
                    let templateSprites: TemplateSprite[] | undefined;
                    try { templateSprites = tmpl.sprites ? JSON.parse(tmpl.sprites) : undefined; } catch { /* malformed sprites */ }
                    copyMissingSprites(tmpl.component, templateSprites);
                    onAdd(deepCopyNode(tmpl.component), parentId());
                  }}
                  title={`Add copy of ${tmpl.name}`}
                >
                  Use
                </DefaultButton>
                <IconButton
                  iconProps={{ iconName: 'Delete' }}
                  title={`Remove template "${tmpl.name}"`}
                  onClick={async () => {
                    if (await confirmAsync(`Remove template "${tmpl.name}"?`, { danger: true, confirmText: 'Remove' })) onRemoveTemplate(tmpl.id);
                  }}
                  styles={{ root: { height: 24, width: 24, flexShrink: 0 } }}
                />
              </Stack>
            );
          })}
        </Stack>
      )}

      {/* Built-in Templates panel */}
      {tab === 'builtin' && (
        <Stack style={{ overflowY: 'auto', flex: 1 }}>
          {builtInTemplates.length === 0 && (
            <span style={{ padding: '1em', opacity: 0.5, fontSize: '0.85em' }}>Loading built-in templates…</span>
          )}
          {builtInTemplates.map(tmpl => {
            const meta = TEMPLATE_TYPE_META[tmpl.gaugeType] ?? TEMPLATE_TYPE_META['none'];
            return (
              <Stack
                key={tmpl.id}
                horizontal
                verticalAlign="center"
                tokens={{ childrenGap: 8 }}
                style={{ padding: '0.4em 0.5em', borderBottom: `1px solid ${theme.palette.neutralLighter}` }}
              >
                <Icon iconName={meta.icon} style={{ fontSize: 18, width: 40, textAlign: 'center', flexShrink: 0 }} />
                <Stack style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '0.85em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tmpl.name}</span>
                  <span style={{ fontSize: '0.75em', opacity: 0.6 }}>{meta.label}</span>
                </Stack>
                <DefaultButton
                  styles={{ root: { fontSize: '0.75em', height: 24, minWidth: 0, flexShrink: 0 } }}
                  onClick={() => {
                    try {
                      const component = JSON.parse(tmpl.component) as ComponentNode;
                      copyMissingSprites(component);
                      onAdd(deepCopyNode(component), parentId());
                    } catch { /* malformed component */ }
                  }}
                  title={`Add ${tmpl.name}`}
                >
                  Use
                </DefaultButton>
              </Stack>
            );
          })}
        </Stack>
      )}

      {/* New component panel */}
      {tab === 'new' && <>

      {/* Component type list */}
      <Stack style={{ borderBottom: border, flexShrink: 0 }}>
        {ALL_SCHEMAS.map(schema => (
          <Stack
            key={schema.type}
            horizontal
            verticalAlign="center"
            tokens={{ childrenGap: 8 }}
            onClick={() => setActiveType(schema.type)}
            style={{
              padding: '0.35em 0.6em',
              cursor: 'pointer',
              background: activeType === schema.type ? theme.palette.neutralQuaternaryAlt : undefined,
              userSelect: 'none',
            }}
          >
            <Icon iconName={schema.icon} style={{ fontSize: 16, width: 20, textAlign: 'center', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85em', flex: 1 }}>{schema.label}</span>
            {activeType === schema.type && (
              <Icon iconName="ChevronRight" style={{ fontSize: 10, color: theme.palette.neutralTertiary }} />
            )}
          </Stack>
        ))}
      </Stack>

      {/* Placement indicator */}
      <Stack style={{ padding: '0.3em 0.5em', borderBottom: border, flexShrink: 0, fontSize: '0.78em', opacity: 0.7 }}>
        {parentId()
          ? `Adding to: ${findNodeById(dashboard.components, selectedId!)?.name ?? 'group'}`
          : 'Adding to: canvas root'}
      </Stack>

      {/* Freeform types: just a button */}
      {isFreeform && (
        <Stack style={{ padding: '0.5em' }}>
          <PrimaryButton onClick={() => addNode()} styles={{ root: { height: 30 } }}>
            + Add {activeSchema.label}
          </PrimaryButton>
        </Stack>
      )}

      {/* Sprite-based: image grid */}
      {needsSprite && (
        <Stack style={{ overflowY: 'auto', flex: 1 }}>
          {sprites.length === 0 && (
            <span style={{ padding: '1em', opacity: 0.5, fontSize: '0.85em' }}>
              No images yet. Upload some to get started.
            </span>
          )}
          {sprites.map(sprite => (
            <Stack
              key={sprite.file}
              horizontal
              verticalAlign="center"
              tokens={{ childrenGap: 6 }}
              style={{ padding: '0.4em 0.5em', borderBottom: `1px solid ${theme.palette.neutralLighter}` }}
            >
              <img
                src={sprite.thumbnail}
                alt={sprite.label}
                style={{ width: 40, height: 40, objectFit: 'contain', flexShrink: 0 }}
              />
              <span style={{ flex: 1, fontSize: '0.85em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                {sprite.label}
              </span>
              <DefaultButton
                styles={{ root: { fontSize: '0.75em', height: 24, minWidth: 0, flexShrink: 0 } }}
                onClick={() => {
                  if (builtInSpriteFiles?.has(sprite.file) && onCopyBuiltinSprite) {
                    onCopyBuiltinSprite(sprite.file);
                  }
                  addNode(sprite.file);
                }}
                title={`Add as ${activeSchema.label}`}
              >
                Add
              </DefaultButton>
              {onDeleteSprite && sprite.id && (
                <IconButton
                  iconProps={{ iconName: 'Delete' }}
                  title={`Delete ${sprite.label}`}
                  onClick={e => handleDeleteSprite(e, sprite)}
                  styles={{ root: { height: 24, width: 24, flexShrink: 0 } }}
                />
              )}
            </Stack>
          ))}
        </Stack>
      )}

      </>}
    </Stack>
  );
};

export default ComponentPicker;
