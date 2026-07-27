import React, { useEffect, useRef } from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import { IconButton } from '@fluentui/react';
import { getTheme, Form } from '../../../lib/denim/lib';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';
import DetailsGrid from '../../../lib/typical-admin-fabric/lib/List';
import { DisplaySchema } from '../../../lib/typical-admin';
import { GET_SHIFT_LIGHTS, CREATE_SHIFT_LIGHT, UPDATE_SHIFT_LIGHT, REMOVE_SHIFT_LIGHT, SHIFT_LIGHT_CHANGED, ShiftLightRec } from './queries';
import { DEFAULT_SHIFT_LIGHT } from '../../../mock/shiftLightMock';

interface Props { profileId?: string | null; enabled?: boolean; }

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

const ShiftLights: React.FC<Props> = ({ profileId = null, enabled = true }) => {
  const theme = getTheme();
  const { data, loading } = useQuery(GET_SHIFT_LIGHTS);
  useSubscription(SHIFT_LIGHT_CHANGED);
  const [create] = useMutation(CREATE_SHIFT_LIGHT, { refetchQueries: [{ query: GET_SHIFT_LIGHTS }] });
  const [update] = useMutation(UPDATE_SHIFT_LIGHT, { refetchQueries: [{ query: GET_SHIFT_LIGHTS }] });
  const [remove] = useMutation(REMOVE_SHIFT_LIGHT, { refetchQueries: [{ query: GET_SHIFT_LIGHTS }] });

  const allRecords: ShiftLightRec[] = (data as any)?.getMonocoqueShiftLights ?? [];
  const records = allRecords.filter(r => (r.profileId ?? null) === profileId);

  const seededRef = useRef(false);
  useEffect(() => {
    if (!enabled || profileId !== null || loading || seededRef.current) return;
    if (allRecords.length > 0) { seededRef.current = true; return; }
    seededRef.current = true;
    create({ variables: { values: DEFAULT_SHIFT_LIGHT } });
  }, [enabled, profileId, loading, allRecords.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = () => create({ variables: { values: { ...DEFAULT_SHIFT_LIGHT, profileId } } });
  const handleRemove = async (r: ShiftLightRec) => {
    const ok = await confirmAsync(`Remove this shift light? This can't be undone.`, { danger: true, confirmText: 'Remove' });
    if (!ok) return;
    await remove({ variables: { id: r.id } });
  };

  const field = (key: keyof ShiftLightRec, label: string, numeric = false) => ({
    label,
    onRender: ({ values }: { values: ShiftLightRec }) => (
      <FieldCell rowId={values.id} field={key} label={label} value={values[key] as string | number} numeric={numeric}
        onCommit={v => update({ variables: { id: values.id, update: { [key]: v } } })} />
    ),
  });

  const schema: DisplaySchema<any> = {
    devid: { ...field('devid', 'Device ID'), options: { minWidth: 140, maxWidth: 200 } },
    subtype: field('subtype', 'Subtype'),
    granularity: field('granularity', 'Granularity', true),
    config: { ...field('config', 'Config'), options: { minWidth: 220, maxWidth: 360 } },
    actions: {
      label: '',
      options: { minWidth: 40, maxWidth: 48 },
      onRender: ({ values }: { values: ShiftLightRec }) => (
        <IconButton iconProps={{ iconName: 'Delete' }} title="Remove" onClick={() => handleRemove(values)} />
      ),
    },
  };

  return (
    <div style={{ padding: profileId ? 0 : 16, color: theme.palette.neutralPrimary }}>
      {!profileId && <h3 style={{ margin: '0 0 10px' }}>Shift Lights</h3>}
      {records.length === 0 && (
        <div style={{ opacity: 0.5, padding: '0 0 8px' }}>
          No shift lights configured yet — click "Add" (top-right of the grid) to get started.
        </div>
      )}
      <DetailsGrid name="ShiftLights" items={records} schema={schema} onAdd={handleAdd} />
    </div>
  );
};

export default ShiftLights;
