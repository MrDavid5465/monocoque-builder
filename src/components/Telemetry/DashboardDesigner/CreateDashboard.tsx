import React, { useRef, useState } from 'react';
import { Stack, PrimaryButton, DefaultButton, Form, getTheme } from '../../../lib/denim-fabric/lib';
import { BASE_DASH_TYPES, BaseDashType } from '../../../types/dashboard';
import { IFormRef } from '../../../lib/typical-admin-fabric/lib/templates/Form';

interface Props {
  existingPaths?: string[];
  configuredDir?: string;
  onCreate: (config: { name: string; baseDashType: BaseDashType; path: string }) => Promise<void>;
  onCancel: () => void;
}

const nameSchema = {
  name: {
    type: 'text',
    label: 'Dashboard name',
    placeholder: 'e.g. F1 Wheel Cluster',
    required: true,
  },
};

// ── SVG thumbnails ─────────────────────────────────────────────────────────────

const ImageBgThumbnail: React.FC<{ color: string }> = ({ color }) => (
  <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%', height: '100%' }}>
    {/* Card fill */}
    <rect x="0" y="0" width="120" height="80" rx="6" fill={color} opacity="0.08" />
    {/* Sun */}
    <circle cx="28" cy="24" r="13" fill={color} />
    {/* Back mountain (lighter) */}
    <polygon points="30,72 72,24 114,72" fill={color} opacity="0.4" />
    {/* Front mountain */}
    <polygon points="0,72 48,28 96,72" fill={color} opacity="0.85" />
    {/* Ground strip */}
    <rect x="0" y="66" width="120" height="14" rx="0" fill={color} opacity="0.3" />
  </svg>
);

const Photo360Thumbnail: React.FC<{ color: string }> = ({ color }) => (
  <svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%', height: '100%' }}>
    {/* Subtle sphere hint */}
    <ellipse cx="60" cy="40" rx="16" ry="16" fill={color} opacity="0.1" />
    {/* Center dot */}
    <circle cx="60" cy="40" r="4" fill={color} />

    {/* UP arrow — curved stem bowing outward, filled solid */}
    <path
      d="M57 35 C56 26 55 18 60 8 C65 18 64 26 63 35 Z"
      fill={color} opacity="0.5"
    />
    <polygon points="60,4 52,18 68,18" fill={color} />

    {/* DOWN arrow */}
    <path
      d="M57 45 C56 54 55 62 60 72 C65 62 64 54 63 45 Z"
      fill={color} opacity="0.5"
    />
    <polygon points="60,76 52,62 68,62" fill={color} />

    {/* RIGHT arrow — curved stem bowing outward */}
    <path
      d="M65 37 C74 36 82 35 92 40 C82 45 74 44 65 43 Z"
      fill={color} opacity="0.5"
    />
    <polygon points="116,40 100,32 100,48" fill={color} />

    {/* LEFT arrow */}
    <path
      d="M55 37 C46 36 38 35 28 40 C38 45 46 44 55 43 Z"
      fill={color} opacity="0.5"
    />
    <polygon points="4,40 20,32 20,48" fill={color} />
  </svg>
);

const TYPE_THUMBS: Record<BaseDashType, React.FC<{ color: string }>> = {
  sprite: ImageBgThumbnail,
  '360': Photo360Thumbnail,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function derivePath(configuredDir: string, name: string): string {
  const base = configuredDir.replace(/\/$/, '') || '~/.config/dashboard-designer';
  return name ? `${base}/dashboards/${name}` : '';
}


// ── Component ─────────────────────────────────────────────────────────────────

const CreateDashboard: React.FC<Props> = ({ existingPaths = [], configuredDir = '', onCreate, onCancel }) => {
  const [step, setStep] = useState<'pick-type' | 'configure'>('pick-type');
  const [baseDashType, setBaseDashType] = useState<BaseDashType | null>(null);
  const [name, setName] = useState('');
  const formRef = useRef<IFormRef>(null);
  const theme = getTheme();

  const derivedPath = derivePath(configuredDir, name);
  const folderExists = name
    ? existingPaths.some(p => p.replace(/\/$/, '').toLowerCase().endsWith(`/${name.toLowerCase()}`))
    : false;

  const selectType = (type: BaseDashType) => {
    setBaseDashType(type);
    setStep('configure');
  };

  const handleCreate = async () => {
    if (!baseDashType || !name || !derivedPath) return;
    await onCreate({ name, baseDashType, path: derivedPath });
  };

  const typeInfo = BASE_DASH_TYPES.find(t => t.type === baseDashType);

  if (step === 'pick-type') {
    return (
      <Stack tokens={{ childrenGap: 16 }} style={{ padding: '2em', maxWidth: 680 }}>
        <h2 style={{ margin: 0 }}>Choose a background type</h2>
        <p style={{ margin: 0, opacity: 0.7, fontSize: '0.9em' }}>
          This sets how the canvas background works. You can add any gauge components to either type.
        </p>
        <Stack horizontal wrap tokens={{ childrenGap: 16 }}>
          {BASE_DASH_TYPES.map(t => {
            const Thumb = TYPE_THUMBS[t.type];
            return (
              <Stack
                key={t.type}
                onClick={() => selectType(t.type)}
                style={{
                  width: 280,
                  cursor: 'pointer',
                  border: `2px solid ${theme.palette.neutralLight}`,
                  borderRadius: 8,
                  padding: '1em',
                  transition: 'border-color 100ms',
                }}
                tokens={{ childrenGap: 10 }}
              >
                <div style={{ width: '100%', height: 140, borderRadius: 4, overflow: 'hidden', background: theme.palette.neutralLighter }}>
                  <Thumb color={theme.palette.themePrimary} />
                </div>
                <span style={{ fontWeight: 600, fontSize: '1em' }}>{t.label}</span>
                <span style={{ fontSize: '0.84em', opacity: 0.75, lineHeight: 1.4 }}>{t.description}</span>
              </Stack>
            );
          })}
        </Stack>
        <div>
          <DefaultButton onClick={onCancel}>Cancel</DefaultButton>
        </div>
      </Stack>
    );
  }

  return (
    <Stack tokens={{ childrenGap: 20 }} style={{ padding: '2em', maxWidth: 480 }}>
      <Stack tokens={{ childrenGap: 4 }}>
        <h2 style={{ margin: 0 }}>{typeInfo?.label ?? 'New dashboard'}</h2>
        <span style={{ fontSize: '0.84em', opacity: 0.65 }}>{typeInfo?.description}</span>
      </Stack>

      <Form
        form={nameSchema}
        name="createDash"
        onChange={(_n, { raw }) => setName((raw.name as string) ?? '')}
        ref={formRef}
      />

      {/* Folder path display */}
      <Stack tokens={{ childrenGap: 6 }}>
        <span style={{ fontSize: '0.85em', fontWeight: 600 }}>Folder path</span>
        {derivedPath ? (
          <>
            <div style={{
              padding: '8px 10px',
              borderRadius: 4,
              background: theme.palette.neutralLighter,
              fontFamily: 'monospace',
              fontSize: '0.82em',
              wordBreak: 'break-all',
              color: theme.palette.neutralPrimary,
            }}>
              {derivedPath}
            </div>
            <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 6 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: folderExists ? '#4caf50' : theme.palette.themePrimary,
              }} />
              <span style={{ fontSize: '0.82em', opacity: 0.75 }}>
                {folderExists ? 'Dash found' : 'New folder will be created'}
              </span>
            </Stack>
          </>
        ) : (
          <span style={{ fontSize: '0.82em', opacity: 0.5 }}>Enter a name to see the folder path</span>
        )}
      </Stack>

      <Stack horizontal tokens={{ childrenGap: 8 }}>
        <PrimaryButton disabled={!name || !derivedPath} onClick={handleCreate}>Create</PrimaryButton>
        <DefaultButton onClick={() => setStep('pick-type')}>Back</DefaultButton>
      </Stack>
    </Stack>
  );
};

export default CreateDashboard;
