export const DEFAULT_SHIFT_LIGHT = {
  deviceKind: 'usb',
  devid: '98FD:83AC',
  subtype: 'Revburner',
  granularity: 2,
  config: '~/.config/monocoque/revburner15000.xml',
  devpath: '',
  baud: 115200,
  profileId: null as string | null,
};

// A wheelbase's built-in serial shift-light strip (Moza R5/R12/R3/R8, KS Pro
// Wheel) — monocoque dispatches this as device="Serial"; type="Wheel", not
// device="USB"; type="Tachometer" like DEFAULT_SHIFT_LIGHT above. Offered as
// a second "Add" option (see ShiftLights/index.tsx) since the two shapes
// need different starting values, not just different subtype text.
export const DEFAULT_SERIAL_SHIFT_LIGHT = {
  deviceKind: 'serial',
  devid: '',
  subtype: 'MozaR5',
  granularity: 1,
  config: '',
  devpath: '/dev/ttyACM0',
  baud: 115200,
  profileId: null as string | null,
};
