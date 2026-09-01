import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { Stack, IconButton, PrimaryButton, Dropdown, Form, useQuery, useMutation } from '../../lib/denim/lib';
import { IDropdownOption } from '@fluentui/react';
import {
  GET_DASH_GROUPS, ADD_DASH_GROUP, UPDATE_DASH_GROUP, GET_KNOWN_CARS,
} from '../Telemetry/Groups/queries';
import { GET_DASHBOARDS } from '../Telemetry/DashboardDesigner/queries';

const groupSchema = {
  name: { label: 'Group name' },
};

/** One car→dashboard row. Stored as a `Record<car, dash>` JSON string on the
 *  record; kept as rows while editing so a row can exist before its car is
 *  picked. */
interface CarRow {
  car: string;
  dash: string;
}

const rowsFromJson = (json: string | undefined): CarRow[] => {
  try {
    return Object.entries(JSON.parse(json ?? '{}') as Record<string, string>)
      .map(([car, dash]) => ({ car, dash: dash ?? '' }));
  } catch {
    return [];
  }
};

/** Drops not-yet-assigned rows, and lets a later row win a duplicated car
 *  (which the per-row option filtering already makes hard to produce). */
const jsonFromRows = (rows: CarRow[]): string =>
  JSON.stringify(Object.fromEntries(rows.filter(r => r.car).map(r => [r.car, r.dash ?? ''])));

// Registered for ReactiveAdmin's show/edit/new slots — one component for all
// three (matching CarShow's shared show/edit precedent) since the editing UI
// is identical whether id is present (edit an existing group, via useParams)
// or absent (the /new route, which doesn't have an :id param at all).
// carDashMap is a dynamic car→dashboard key-value map, not a schema-fittable
// scalar field, so it's a hand-coded add/remove row list below the simple
// per-form Form — same pattern as the Groups checklist in
// DashboardPropertiesPanel and the encoder per-position mapping block in
// ComponentPropertiesPanel.
const GroupEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isNew = !id;

  const { data: groupsData } = useQuery(GET_DASH_GROUPS, { fetchPolicy: 'cache-and-network', skip: isNew });
  const { data: dashData } = useQuery(GET_DASHBOARDS);
  const { data: carsData } = useQuery(GET_KNOWN_CARS, { fetchPolicy: 'cache-and-network' });
  const [addGroup] = useMutation(ADD_DASH_GROUP, { refetchQueries: [{ query: GET_DASH_GROUPS }] });
  const [updateGroup] = useMutation(UPDATE_DASH_GROUP, { refetchQueries: [{ query: GET_DASH_GROUPS }] });

  const existing = !isNew ? ((groupsData as any)?.getDashGroups ?? []).find((g: any) => g.id === id) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [defaultDash, setDefaultDash] = useState<string>(existing?.defaultDash ?? '');
  // Rows, not the Record — a row exists (and is editable) before its car is
  // chosen, which a car-keyed map can't represent. Converted back to the
  // stored `Record<car, dash>` shape only at save time.
  const [carRows, setCarRows] = useState<CarRow[]>(() => rowsFromJson(existing?.carDashMap));
  const [saving, setSaving] = useState(false);

  // Reset local state once the existing record actually loads (initial fetch
  // resolves after mount) — mirrors the same "sync once real data arrives"
  // need as other forms in this app that seed local state from a query.
  const [hydrated, setHydrated] = useState(false);
  if (!hydrated && existing) {
    setName(existing.name ?? '');
    setDefaultDash(existing.defaultDash ?? '');
    setCarRows(rowsFromJson(existing.carDashMap));
    setHydrated(true);
  }

  const dashOptions: IDropdownOption[] = ((dashData as any)?.getDashboardEntries ?? []).map((d: any) => ({ key: d.name, text: d.name }));
  const carOptions: IDropdownOption[] = ((carsData as any)?.getKnownCars ?? []).map((c: any) => ({ key: c.id, text: c.id }));
  const allDashOptions: IDropdownOption[] = [{ key: '', text: '(none)' }, ...dashOptions];

  // The car→dashboard rows as one `list` field. The "a car already used by
  // another row must not be offered again" rule that previously needed a
  // separate `usedCars` set plus a dedicated "Add car" dropdown is now just
  // a function itemSchema filtering against the OTHER rows — which also
  // means the rule holds when editing an existing row, not only when adding.
  const carMapSchema = {
    carMappings: {
      type: 'list' as const,
      label: 'Car mappings',
      singular: 'car mapping',
      addLabel: 'Add car',
      removeLabel: 'Remove mapping',
      emptyText: 'No car mappings — every car in this group uses the default dashboard.',
      horizontal: true,
      newRow: { car: '', dash: '' },
      // Falls back to the index while a row's car is still unset, so two
      // blank rows stay distinct.
      rowKey: (r: CarRow, i: number) => r.car || `unassigned-${i}`,
      itemSchema: ({ index, rows }: { index: number; rows: CarRow[] }) => ({
        car: {
          type: 'select' as const,
          label: 'Car',
          options: [
            { text: '— Select car —', value: '' },
            ...carOptions
              .filter(c => !rows.some((r, j) => j !== index && r.car === String(c.key)))
              .map(c => ({ text: String(c.text), value: String(c.key) })),
          ],
        },
        dash: {
          type: 'select' as const,
          label: 'Dashboard',
          options: [
            { text: '(none)', value: '' },
            ...dashOptions.map(d => ({ text: String(d.text), value: String(d.key) })),
          ],
        },
      }),
    },
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const values = { name: name.trim(), defaultDash: defaultDash || null, carDashMap: jsonFromRows(carRows) };
      if (isNew) {
        const result = await addGroup({ variables: { values } });
        const newId = (result.data as any)?.addDashGroup?.id;
        if (newId) navigate(pathname.replace('new', `${newId}/show`));
      } else {
        await updateGroup({ variables: { id, update: values } });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '1.2em 1.5em', maxWidth: 640 }}>
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} style={{ marginBottom: '1em' }}>
        <IconButton iconProps={{ iconName: 'Back' }} onClick={() => navigate(pathname.replace(isNew ? '/new' : `/${id}/show`, ''))} title="Back" />
        <span style={{ fontSize: '1.2em', fontWeight: 700 }}>{isNew ? 'New Group' : name || 'Group'}</span>
      </Stack>

      <Form
        form={groupSchema}
        name="group"
        initialValues={{ name }}
        onChange={(_: string, { raw }: any) => setName(raw.name ?? '')}
      />

      <Stack tokens={{ childrenGap: 4 }} style={{ marginTop: '0.75em' }}>
        <Dropdown
          label="Default dashboard"
          selectedKey={defaultDash}
          options={allDashOptions}
          onChange={(_, opt) => setDefaultDash(opt?.key as string ?? '')}
        />
      </Stack>

      <Stack style={{ marginTop: '1em' }}>
        <Form
          // Remounts once when the fetched record hydrates local state; row
          // remounting during editing is the list field's own business.
          key={`carmap-${id ?? 'new'}-${hydrated}`}
          form={carMapSchema}
          name="groupCarMap"
          initialValues={{ carMappings: carRows }}
          onChange={(_: string, { raw }: any) => setCarRows(raw.carMappings ?? [])}
        />
      </Stack>

      <PrimaryButton disabled={!name.trim() || saving} style={{ marginTop: '1.5em' }} onClick={handleSave}>
        {saving ? 'Saving…' : 'Save'}
      </PrimaryButton>
    </div>
  );
};

export default GroupEdit;
