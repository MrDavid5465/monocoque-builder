import React from 'react';
import { useQuery, useMutation, useSubscription } from '@apollo/client/react';
import { getTheme, Form } from '../../../lib/denim/lib';
import { confirmAsync } from '../../../lib/denim/components/ConfirmDialog';
import DetailsGrid from '../../../lib/typical-admin-fabric/lib/List';
import { RowButtonConfig } from '../../../lib/typical-admin-fabric/lib/ListControls';
import { DisplaySchema } from '../../../lib/typical-admin';
import { GET_SHIFT_LIGHTS, CREATE_SHIFT_LIGHT, UPDATE_SHIFT_LIGHT, REMOVE_SHIFT_LIGHT, SHIFT_LIGHT_CHANGED, ShiftLightRec } from './queries';
import { DEFAULT_SHIFT_LIGHT, DEFAULT_SERIAL_SHIFT_LIGHT } from '../../../mock/shiftLightMock';
import { useMonocoqueExport } from '../useMonocoqueExport';
import { GET_USB_DEVICES, UsbDeviceInfo } from '../usbDevicesQueries';
import { GET_SERIAL_DEVICES, SerialDeviceInfo } from '../serialDevicesQueries';

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

const DEVICE_KIND_OPTIONS = [
  { text: 'USB Tachometer (Revburner)', value: 'usb' },
  { text: 'Serial Wheel (Moza etc.)', value: 'serial' },
];

// Same one-field-Form-per-cell pattern as FieldCell, but a select/combobox
// instead of a free-text input — reused for deviceKind (fixed 2-option
// select), devid (live USB device select, see usbSelectOptions below), and
// devpath (live serial device combobox, see serialComboOptions below).
// 'select' is used where the value must be one of a fixed/live list (a
// dropdown avoids the free-text typo risk that would otherwise silently
// mis-route a row's exported config block — see buildShiftLightBlocks);
// 'combobox' is used for devpath instead, since a serial path may need to
// be typed even when nothing's currently enumerated (device unplugged,
// udev hasn't caught up yet, etc.) — the picker is a convenience, not the
// only way in.
const PickerFieldCell: React.FC<{
  rowId: string; field: string; value: string; options: { text: string; value: string }[];
  type?: 'select' | 'combobox'; onCommit: (v: string) => void;
}> = ({ rowId, field, value, options, type = 'select', onCommit }) => (
  <Form
    key={`${field}-${rowId}`}
    form={{ [field]: { type, label: '', options } }}
    name={`${field}-${rowId}`}
    initialValues={{ [field]: value }}
    onChange={(_: string, { clean }: any) => {
      if (clean[field] !== value) onCommit(clean[field]);
    }}
  />
);

const ShiftLights: React.FC<Props> = ({ profileId = null }) => {
  const theme = getTheme();
  const { data } = useQuery(GET_SHIFT_LIGHTS);
  useSubscription(SHIFT_LIGHT_CHANGED);
  // Deliberately plain useQuery, no polling/subscription — a connected-
  // device snapshot is only useful at the moment you open this page or
  // click into the dropdown, not something that needs to stay live while
  // editing other fields (and this page already holds one long-lived
  // subscription — see feedback_subscription_connection_limit).
  const { data: usbData, refetch: refetchUsbDevices } = useQuery(GET_USB_DEVICES);
  const usbDevices: UsbDeviceInfo[] = (usbData as any)?.getUsbDevices ?? [];
  const usbSelectOptions = [
    { text: '— Select USB device —', value: '' },
    ...usbDevices.map(d => ({
      text: `${d.devid}${d.product ? ` — ${d.manufacturer ? `${d.manufacturer} ` : ''}${d.product}` : ''}`,
      value: d.devid,
    })),
  ];
  // Same shape as usbSelectOptions but for the devpath combobox — populated
  // from /dev/serial/by-id (see device_enumeration.rs's list_serial_devices
  // doc comment), the same place you'd look by hand running
  // `ls /dev/serial/by-id/` to find a wheel's tty path.
  const { data: serialData, refetch: refetchSerialDevices } = useQuery(GET_SERIAL_DEVICES);
  const serialDevices: SerialDeviceInfo[] = (serialData as any)?.getSerialDevices ?? [];
  const serialComboOptions = serialDevices.map(d => ({ text: `${d.devpath} — ${d.label}`, value: d.devpath }));
  const [create] = useMutation(CREATE_SHIFT_LIGHT, { refetchQueries: [{ query: GET_SHIFT_LIGHTS }] });
  const [update] = useMutation(UPDATE_SHIFT_LIGHT, { refetchQueries: [{ query: GET_SHIFT_LIGHTS }] });
  const [remove] = useMutation(REMOVE_SHIFT_LIGHT, { refetchQueries: [{ query: GET_SHIFT_LIGHTS }] });

  const { status: exportStatus, handleExport, handleRestart } = useMonocoqueExport();

  const allRecords: ShiftLightRec[] = (data as any)?.getMonocoqueShiftLights ?? [];
  const records = allRecords.filter(r => (r.profileId ?? null) === profileId);

  const handleAddUsb = () => create({ variables: { values: { ...DEFAULT_SHIFT_LIGHT, profileId } } });
  const handleAddSerial = () => create({ variables: { values: { ...DEFAULT_SERIAL_SHIFT_LIGHT, profileId } } });
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
    deviceKind: {
      label: 'Kind',
      options: { minWidth: 180, maxWidth: 200 },
      onRender: ({ values }: { values: ShiftLightRec }) => (
        <PickerFieldCell rowId={values.id} field="deviceKind" value={values.deviceKind} options={DEVICE_KIND_OPTIONS}
          onCommit={v => update({ variables: { id: values.id, update: { deviceKind: v } } })} />
      ),
    },
    devid: {
      label: 'Device ID (USB)',
      options: { minWidth: 220, maxWidth: 320 },
      onRender: ({ values }: { values: ShiftLightRec }) => (
        <PickerFieldCell rowId={values.id} field="devid" value={values.devid} options={usbSelectOptions}
          onCommit={v => update({ variables: { id: values.id, update: { devid: v } } })} />
      ),
    },
    subtype: field('subtype', 'Subtype'),
    granularity: field('granularity', 'Granularity', true),
    devpath: {
      label: 'Device Path (Serial)',
      options: { minWidth: 260, maxWidth: 380 },
      onRender: ({ values }: { values: ShiftLightRec }) => (
        <PickerFieldCell rowId={values.id} field="devpath" type="combobox" value={values.devpath ?? ''} options={serialComboOptions}
          onCommit={v => update({ variables: { id: values.id, update: { devpath: v } } })} />
      ),
    },
    baud: field('baud', 'Baud', true),
    config: { ...field('config', 'Config'), options: { minWidth: 220, maxWidth: 360 } },
  };

  const rowButtons: RowButtonConfig<ShiftLightRec>[] = [
    { key: 'remove', label: 'Remove', icon: 'Delete', danger: true, onClick: handleRemove },
  ];

  return (
    <div style={{ padding: profileId ? 0 : 16, color: theme.palette.neutralPrimary }}>
      {!profileId && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <h3 style={{ margin: '0 10px 0 0' }}>Shift Lights</h3>
          {exportStatus && <span style={{ fontSize: '0.8em', opacity: 0.6 }}>{exportStatus}</span>}
        </div>
      )}
      {records.length === 0 && (
        <div style={{ opacity: 0.5, padding: '0 0 8px' }}>
          No shift lights configured yet — click "Add" (top-right of the grid) to get started.
        </div>
      )}
      <div style={{ fontSize: '0.75em', opacity: 0.5, marginBottom: 8 }}>
        USB Tachometer rows use Device ID/Subtype/Granularity/Config. Serial Wheel rows (e.g. Moza)
        use Subtype ("MozaR5", "MozaNew", or "MozaKSProWheel") + Device Path + Baud — try each
        subtype against your hardware's actual serial device path.
      </div>
      <DetailsGrid
        name="ShiftLights"
        items={records}
        schema={schema}
        onAdd={handleAddUsb}
        customButtons={[
          { key: 'addSerial', label: 'Add Serial Wheel', icon: 'Add', onClick: handleAddSerial },
          { key: 'refreshDevices', label: 'Refresh Devices', icon: 'Refresh', onClick: () => { refetchUsbDevices(); refetchSerialDevices(); } },
          { key: 'export', label: 'Export to Config', icon: 'CloudDownload', onClick: handleExport },
          { key: 'restart', label: 'Restart Monocoque', icon: 'Refresh', onClick: handleRestart },
        ]}
        rowButtons={rowButtons}
      />
    </div>
  );
};

export default ShiftLights;
