import React from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import { getTheme, Form } from '../../../lib/denim/lib';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';
import DetailsGrid from '../../../lib/typical-admin-fabric/lib/List';
import { RowButtonConfig } from '../../../lib/typical-admin-fabric/lib/ListControls';
import { DisplaySchema } from '../../../lib/typical-admin';
import { GET_SIM_WINDS, CREATE_SIM_WIND, UPDATE_SIM_WIND, REMOVE_SIM_WIND, SIM_WIND_CHANGED, SimWindDeviceRec } from './queries';
import { DEFAULT_SIM_WIND_DEVICE } from '../../../mock/simWindDeviceMock';
import { useMonocoqueExport } from '../useMonocoqueExport';

interface Props { profileId?: string | null; }

// One tiny per-form Form per cell, committing immediately on change (diffed
// directly against the row's own current value — no Save button needed, no
// skipFirst dance required since there's only ever one field in play here).
// Same "form in a grid cell" pattern as ChannelHeader.tsx, just simpler:
// these rows have no composite/related fields that need to share one Form.
// The field's own label is left blank — the grid's column header (built
// from the same label, see the field() helper below) already shows it, and
// Fabric.tsx renders a real <Label> above the input that would otherwise
// duplicate it right inside the cell.
const FieldCell: React.FC<{
  rowId: string; field: string; label: string; value: string | number;
  numeric?: boolean; onCommit: (v: string | number) => void;
}> = ({ rowId, field, label, value, numeric, onCommit }) => (
  <Form
    key={`${rowId}-${field}`}
    form={{ [field]: { label: '', placeholder: label } }}
    name={`${field}-${rowId}`}
    initialValues={{ [field]: value }}
    onChange={(_: string, { clean }: any) => {
      const next = numeric ? Number(clean[field]) : clean[field];
      if (next !== value) onCommit(next);
    }}
  />
);

const SimWindDevices: React.FC<Props> = ({ profileId = null }) => {
  const theme = getTheme();
  const { data } = useQuery(GET_SIM_WINDS);
  useSubscription(SIM_WIND_CHANGED);
  const [create] = useMutation(CREATE_SIM_WIND, { refetchQueries: [{ query: GET_SIM_WINDS }] });
  const [update] = useMutation(UPDATE_SIM_WIND, { refetchQueries: [{ query: GET_SIM_WINDS }] });
  const [remove] = useMutation(REMOVE_SIM_WIND, { refetchQueries: [{ query: GET_SIM_WINDS }] });

  const { status: exportStatus, handleExport, handleRestart } = useMonocoqueExport();

  const allRecords: SimWindDeviceRec[] = (data as any)?.getMonocoqueSimWindDevices ?? [];
  const records = allRecords.filter(r => (r.profileId ?? null) === profileId);

  const handleAdd = () => create({ variables: { values: { ...DEFAULT_SIM_WIND_DEVICE, profileId } } });
  const handleRemove = async (r: SimWindDeviceRec) => {
    const ok = await confirmAsync(`Remove this SimWind controller? This can't be undone.`, { danger: true, confirmText: 'Remove' });
    if (!ok) return;
    await remove({ variables: { id: r.id } });
  };

  const field = (key: keyof SimWindDeviceRec, label: string, numeric = false) => ({
    label,
    onRender: ({ values }: { values: SimWindDeviceRec }) => (
      <FieldCell rowId={values.id} field={key} label={label} value={values[key] as string | number} numeric={numeric}
        onCommit={v => update({ variables: { id: values.id, update: { [key]: v } } })} />
    ),
  });

  const schema: DisplaySchema<any> = {
    devpath: { ...field('devpath', 'Device Path'), options: { minWidth: 160, maxWidth: 220 } },
    baud: field('baud', 'Baud', true),
    fanPower: field('fanPower', 'Fan Power', true),
    config: { ...field('config', 'Config'), options: { minWidth: 220, maxWidth: 360 } },
  };

  const rowButtons: RowButtonConfig<SimWindDeviceRec>[] = [
    { key: 'remove', label: 'Remove', icon: 'Delete', danger: true, onClick: handleRemove },
  ];

  return (
    <div style={{ padding: profileId ? 0 : 16, color: theme.palette.neutralPrimary }}>
      {!profileId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <h3 style={{ margin: '0 10px 0 0' }}>SimWind Controllers</h3>
          {exportStatus && <span style={{ fontSize: '0.8em', opacity: 0.6 }}>{exportStatus}</span>}
        </div>
      )}
      {records.length === 0 && (
        <div style={{ opacity: 0.5, padding: '0 0 8px' }}>
          No SimWind controllers configured yet — click "Add" (top-right of the grid) to get started.
        </div>
      )}
      <DetailsGrid
        name="SimWindDevices"
        items={records}
        schema={schema}
        onAdd={handleAdd}
        customButtons={[
          { key: 'export', label: 'Export to Config', icon: 'CloudDownload', onClick: handleExport },
          { key: 'restart', label: 'Restart Monocoque', icon: 'Refresh', onClick: handleRestart },
        ]}
        rowButtons={rowButtons}
      />
    </div>
  );
};

export default SimWindDevices;
