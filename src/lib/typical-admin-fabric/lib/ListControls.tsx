import React, { useState } from 'react';
import { Stack, IconButton, Icon, getTheme, Form } from '.';

export interface ListButtonConfig {
  key: string;
  label: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
}

interface Props {
  columnSelectable?: boolean;
  visibleCount: number;
  totalCount: number;
  columnSelectSchema: Record<string, any>;
  initialValues: Record<string, boolean>;
  onColumnsChange: (hidden: Set<string>) => void;
  pickableKeys: string[];
  // Undefined = the caller's schema didn't declare buttons.add — nothing
  // renders. See ListSchema.buttons in typical-admin/index.tsx.
  onAdd?: () => void;
  // Arbitrary caller-defined actions (e.g. "Restart Monocoque") that don't
  // fit the add/columns shape — rendered the same way, just schema/prop
  // configured instead of hand-rolled in the caller's own toolbar markup.
  customButtons?: ListButtonConfig[];
}

// Sits docked in the top-right corner of the list's grid area — the list
// equivalent of Links.tsx's nav controls in the wrapper List.tsx's header
// row, but scoped to the grid itself rather than the page header, and
// schema-driven (only appears/offers a column when the schema says so)
// rather than route-driven. Owns the column-picker popup outright since
// today it's the only control in here; if more grid-level controls show up
// later this is the natural place to add them alongside it.
const ListControls: React.FC<Props> = ({
  columnSelectable, visibleCount, totalCount, columnSelectSchema, initialValues, onColumnsChange, pickableKeys, onAdd,
  customButtons,
}) => {
  const theme = getTheme();
  const [open, setOpen] = useState(false);

  if (!columnSelectable && !onAdd && !customButtons?.length) return null;

  return (
    <>
      <Stack
        horizontal
        style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, background: theme.palette.white, borderRadius: 4 }}
      >
        {customButtons?.map(btn => (
          <IconButton key={btn.key} title={btn.label} disabled={btn.disabled} onClick={btn.onClick}>
            <Icon iconName={btn.icon} />
          </IconButton>
        ))}
        {onAdd && (
          <IconButton title="Add" onClick={onAdd}>
            <Icon iconName={'Add'} />
          </IconButton>
        )}
        {columnSelectable && (
          <IconButton
            title={`Columns (${visibleCount}/${totalCount})`}
            onClick={() => setOpen(true)}
          >
            <Icon iconName={'TripleColumnEdit'} />
          </IconButton>
        )}
      </Stack>

      {columnSelectable && open && (
        // Positioned absolute within the same relatively-positioned
        // wrapper as the DetailsList (see List.tsx) rather than a Fluent
        // Modal, so the dim + centering stay scoped to the grid itself
        // instead of covering/centering on the whole page.
        <div
          style={{
            position: 'absolute', inset: 0, zIndex: 10,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              background: theme.palette.white, borderRadius: 4,
              padding: '1em 1.5em', maxWidth: 420, width: '85%', maxHeight: '85%', overflowY: 'auto',
              boxShadow: theme.effects.elevation16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Stack horizontal horizontalAlign="space-between" verticalAlign="center" style={{ marginBottom: '0.5em' }}>
              <span style={{ fontWeight: 700, fontSize: '1.1em' }}>Columns</span>
              <IconButton iconProps={{ iconName: 'Cancel' }} title="Close" onClick={() => setOpen(false)} />
            </Stack>
            <Form
              form={columnSelectSchema}
              name="columnSelect"
              initialValues={initialValues}
              onChange={(_: string, { raw }: any) => {
                onColumnsChange(new Set(pickableKeys.filter(k => !raw[k])));
              }}
            />
          </div>
        </div>
      )}
    </>
  );
};
export default ListControls;
