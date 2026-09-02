import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Stack, PrimaryButton, IconButton, Form } from '../../lib/denim/lib';
import { useCreateDashboard } from '../Telemetry/DashboardDesigner/useDashboard';
import { BaseDashType } from '../../types/dashboard';

// Custom `new` slot — mirrors CarNew.tsx: bypasses the generic schema-form
// Create.tsx since useCreateDashboard()'s create() call doesn't map onto a
// single GraphQL mutation the generic form machinery can drive directly.
const DashboardNew: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { create } = useCreateDashboard();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [baseDashType, setBaseDashType] = useState<BaseDashType>('sprite');
  const [creating, setCreating] = useState(false);

  const newDashboardSchema = {
    name: { label: 'Name' },
    path: { label: 'Folder path', styles: { field: { fontFamily: 'monospace', fontSize: '0.85em' } } },
    baseDashType: {
      type: 'select' as const,
      label: 'Background type',
      options: [
        { text: 'Image', value: 'sprite' },
        { text: '360° Photo', value: '360' },
      ],
    },
  };

  const handleCreate = async () => {
    if (!name.trim() || !path.trim()) return;
    setCreating(true);
    try {
      const result = await create({ name: name.trim(), baseDashType, path: path.trim() });
      if (result?.name) navigate(pathname.replace('new', `${result.name}/edit`));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div style={{ padding: '1.2em 1.5em', maxWidth: 720 }}>
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} style={{ marginBottom: '1em' }}>
        <IconButton iconProps={{ iconName: 'Back' }} onClick={() => navigate(pathname.replace('/new', ''))} title="Back" />
        <span style={{ fontSize: '1.2em', fontWeight: 700 }}>New Dashboard</span>
      </Stack>

      <Form
        form={newDashboardSchema}
        name="newDashboard"
        initialValues={{ name, path, baseDashType }}
        onChange={(_: string, { raw }: any) => {
          setName(raw.name ?? '');
          setPath(raw.path ?? '');
          setBaseDashType(raw.baseDashType ?? 'sprite');
        }}
      />

      <PrimaryButton disabled={!name.trim() || !path.trim() || creating} style={{ marginTop: '1em' }} onClick={handleCreate}>
        {creating ? 'Creating…' : 'Create Dashboard'}
      </PrimaryButton>
    </div>
  );
};

export default DashboardNew;
