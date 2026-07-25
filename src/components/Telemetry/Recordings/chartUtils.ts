// Flattening for the recording chart/export — deliberately separate from
// useLiveTelemetry.ts's computeTelemetryValues (which stays scoped to its
// existing gauge-binding purpose and only unpacks tyre temp/wear). This one
// covers every numeric field including the full per-corner tyre breakdown,
// since a coaching/analysis tool benefits from more signal than a gauge
// binding needs.
//
// Frames now come from a real GraphQL relation (Recording.frames ->
// RecordingFrame, DuckDB-backed — see typiql_types.rs) rather than a parsed
// JSON blob, so each frame already arrives flat (RecordingFrame has no
// nested `tyres` array — it's 32 already-flattened flTemp/frTemp/.../
// rrDiameter fields, camelCased like every other GraphQL field) and enums
// use GraphQL's own SCREAMING_SNAKE_CASE casing (e.g. "ACTIVE", "BLACK_WHITE"),
// same as useLiveTelemetry's live subscription data — reuse its casing
// convention rather than the old raw-serde one this file used to need.

const COURSE_FLAG_MAP: Record<string, number> = {
  GREEN: 0, YELLOW: 1, RED: 2, CHEQUERED: 3, BLUE: 4, WHITE: 5, BLACK: 6,
  BLACK_WHITE: 7, BLACK_ORANGE: 8, ORANGE: 9,
};

const SIM_STATUS_MAP: Record<string, number> = { OFF: 0, MENU: 1, ACTIVE: 2 };

// Non-telemetry identifiers present on every RecordingFrame row — never
// chartable values, excluded from both the series and the field picker.
const NON_DATA_FIELDS = new Set(['__typename', 'id', 'recordingId', 'frameIndex']);

export function flattenFrameForChart(frame: any): Record<string, number> {
  const values: Record<string, number> = {};
  if (!frame) return values;

  for (const [key, val] of Object.entries(frame as object)) {
    if (NON_DATA_FIELDS.has(key)) continue;
    if (typeof val === 'number') values[key] = val;
    else if (typeof val === 'boolean') values[key] = val ? 1 : 0;
  }
  if (typeof frame.courseFlag === 'string') values.courseFlag = COURSE_FLAG_MAP[frame.courseFlag] ?? 0;
  if (typeof frame.simStatus === 'string') values.simStatus = SIM_STATUS_MAP[frame.simStatus] ?? 0;

  return values;
}

const TYRE_CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;
const TYRE_FIELD_KEYS = ['temp', 'pressure', 'slipRatio', 'slipAngle', 'wear', 'brakeTemp', 'rps', 'diameter'] as const;

// The live RECORDING_LIVE_TELEMETRY_SUB subscription returns TelemetryFrame
// shaped (nested `tyres: [TyreData]`, ordered [FL, FR, RL, RR] per
// types.rs), not RecordingFrame shaped (already-flat flTemp/frTemp/...) —
// this bridges the two so flattenFrameForChart can be reused unmodified on
// live frames instead of duplicating its numeric/boolean/enum handling.
export function flattenLiveFrame(frame: any): Record<string, any> {
  if (!frame) return frame;
  const { tyres, ...rest } = frame;
  const flat: Record<string, any> = { ...rest };
  (tyres ?? []).forEach((tyre: any, i: number) => {
    const corner = TYRE_CORNERS[i];
    if (!corner || !tyre) return;
    for (const field of TYRE_FIELD_KEYS) {
      flat[`${corner}${field[0].toUpperCase()}${field.slice(1)}`] = tyre[field];
    }
  });
  return flat;
}

export interface ChartPoint {
  timeS: number;
  values: Record<string, number>;
}

// `frames` isn't guaranteed to arrive in recording order (the underlying
// query resolves via a plain filtered list, not an ordered one) — sort by
// frameIndex first so the series' x-axis is always chronological. `timeS`
// is derived from each frame's own `frameIndex`, not its position in this
// array — `frames` is typically just the currently-windowed slice of a
// much longer recording (see RecordingChart's windowed getRecordingFrames
// query), so a local array index would always start the x-axis at 0
// regardless of which window is loaded.
export function buildTimeSeries(frames: any[], sampleRateHz: number): ChartPoint[] {
  const sorted = [...frames].sort((a, b) => (a?.frameIndex ?? 0) - (b?.frameIndex ?? 0));
  return sorted.map(f => ({ timeS: (f?.frameIndex ?? 0) / sampleRateHz, values: flattenFrameForChart(f) }));
}

// Every field seen across the series, sorted — used to build the checkbox
// list (a frame's flattened keys should be consistent frame-to-frame, but
// scanning all of them is cheap insurance and avoids missing a field that
// happens to only be non-zero/non-default in one frame's iteration order).
export function collectFieldNames(series: ChartPoint[]): string[] {
  const names = new Set<string>();
  for (const point of series) {
    for (const key of Object.keys(point.values)) names.add(key);
  }
  return Array.from(names).sort();
}

// Section grouping for the field-select popup — mirrors the doc-comment
// groupings already used on TelemetryFrame itself in
// src-tauri/src/telemetry/types.rs (Status/Motion/Drivetrain/Fuel &
// engine/Environment/Session), so there's one conceptual grouping shared
// between the Rust struct and this picker rather than an invented one.
const TOP_LEVEL_SECTIONS: Record<string, string> = {
  simStatus: 'Status', simon: 'Status',
  gLat: 'Motion', gLon: 'Motion', gVert: 'Motion', heading: 'Motion', pitch: 'Motion', roll: 'Motion',
  speed: 'Drivetrain', rpm: 'Drivetrain', maxRpm: 'Drivetrain', idleRpm: 'Drivetrain', gear: 'Drivetrain',
  maxGears: 'Drivetrain', throttle: 'Drivetrain', brake: 'Drivetrain', clutch: 'Drivetrain',
  steering: 'Drivetrain', handbrake: 'Drivetrain', abs: 'Drivetrain', brakeBias: 'Drivetrain',
  fuel: 'Fuel & Engine', fuelCapacity: 'Fuel & Engine', turboBoost: 'Fuel & Engine', turboPct: 'Fuel & Engine',
  airTemp: 'Environment', trackTemp: 'Environment', airDensity: 'Environment',
  lap: 'Session', position: 'Session', numLaps: 'Session', numCars: 'Session', courseFlag: 'Session',
  lapIsValid: 'Session', inPit: 'Session', currentLapSeconds: 'Session', lastLapSeconds: 'Session',
  sector1Time: 'Session', sector2Time: 'Session',
};

// Per user request: tyre checkboxes are grouped by data-point type (one
// section per measurement — e.g. "Tyre Temp" holds all 4 corners), not by
// corner — a corner-based grouping would split e.g. FL's temp/pressure/wear
// across the same section while scattering all 4 corners' temps apart,
// which is the less useful axis for "which signal do I want to see".
// RecordingFrame's flattened tyre fields are named `<corner><Field>`
// (flTemp, frPressure, rlSlipRatio, rrDiameter, ...) — the inverse ordering
// of the old blob format's `tyre_<field>_<corner>` keys.
const TYRE_SECTION_LABELS: Record<string, string> = {
  Temp: 'Tyre Temp',
  Pressure: 'Tyre Pressure',
  SlipRatio: 'Tyre Slip Ratio',
  SlipAngle: 'Tyre Slip Angle',
  Wear: 'Tyre Wear',
  BrakeTemp: 'Tyre Brake Temp',
  Rps: 'Tyre RPS',
  Diameter: 'Tyre Diameter',
};

const TYRE_FIELD_RE = /^(fl|fr|rl|rr)([A-Z][a-zA-Z]*)$/;

function sectionForField(field: string): string {
  const match = field.match(TYRE_FIELD_RE);
  if (match) {
    return TYRE_SECTION_LABELS[match[2]] ?? 'Tyres';
  }
  return TOP_LEVEL_SECTIONS[field] ?? 'Other';
}

// Builds a per-form schema — one `checkbox` field per telemetry field,
// grouped into FormWrapper's accordion sections via each field's own
// `section` key (src/lib/per-form/FormWrapper.tsx) — for the field-select
// popup, replacing a flat wall of checkboxes with scannable, collapsible
// groups.
export function buildFieldSelectSchema(allFields: string[]): Record<string, any> {
  const schema: Record<string, any> = {};
  for (const field of allFields) {
    schema[field] = { type: 'checkbox', label: field, section: sectionForField(field) };
  }
  return schema;
}

// Nearest-frame resample down to a lower rate — targetHz must be <=
// sourceHz (no interpolation, just decimation, matching "export a lower
// rate than recorded" rather than "resynthesize a higher rate").
export function resampleSeries(series: ChartPoint[], sourceHz: number, targetHz: number): ChartPoint[] {
  if (targetHz >= sourceHz || series.length === 0) return series;
  const step = sourceHz / targetHz;
  const result: ChartPoint[] = [];
  for (let i = 0; i < series.length; i += step) {
    const point = series[Math.round(i)];
    if (point) result.push(point);
  }
  return result;
}

export interface CsvExportMeta {
  // The rate the exported rows are actually spaced at (the resample target,
  // not necessarily the original recording's own sampleRateHz) — this is
  // what a re-imported Recording's own rate needs to be for correct
  // playback timing, since it governs the file's time_s deltas.
  sampleRateHz: number;
  // Recording.car isn't a per-frame chartable value (flattenFrameForChart
  // only ever emits numeric/boolean fields — a string can't be plotted),
  // so it was never reachable as a column even when checked in the legend.
  // Encoded as a metadata line instead so re-import can recover it.
  car?: string | null;
}

// Metadata lives in `# key=value` comment lines before the header — plain
// CSV readers/spreadsheet tools ignore or show them as a harmless extra
// row; parseImportedCsv below reads them back out.
export function toCsv(series: ChartPoint[], fields: string[], meta: CsvExportMeta): string {
  const metaLines = [
    '# typiql-recording-export v1',
    `# sampleRateHz=${meta.sampleRateHz}`,
    ...(meta.car ? [`# car=${meta.car}`] : []),
  ];
  const header = ['time_s', ...fields].join(',');
  const rows = series.map(point =>
    [point.timeS.toFixed(3), ...fields.map(f => point.values[f] ?? '')].join(',')
  );
  return [...metaLines, header, ...rows].join('\n');
}

export interface ParsedImport {
  sampleRateHz: number;
  car: string | null;
  fields: string[];
  // One object per row, keyed by RecordingFrame's own (snake_case) field
  // names — deliberately excludes simStatus/courseFlag even if present as
  // columns: the chart export re-encodes those enums as plot-friendly
  // numeric codes (COURSE_FLAG_MAP/SIM_STATUS_MAP), which can't be reliably
  // reversed back into the real GraphQL enum values, so forwarding them
  // risks the backend either rejecting the import or silently storing the
  // wrong enum variant — better to just let those default on import.
  frames: Record<string, number | boolean>[];
}

const NON_FORWARDABLE_IMPORT_FIELDS = new Set(['simStatus', 'courseFlag']);

// flattenFrameForChart exports every boolean RecordingFrame field as a
// plain 0/1 (booleans aren't chartable as-is) — reversing that back into a
// real JSON boolean here matters because serde_json has no built-in
// number->bool coercion: a `1` where RecordingFrame's `simon: bool` expects
// `true`/`false` fails that field's deserialize, which (unlike a merely
// *missing* field, which just defaults) fails the *whole row*, atomically.
const BOOLEAN_IMPORT_FIELDS = new Set(['simon', 'lapIsValid', 'inPit']);

// importRecording's framesJson is deserialized straight into RecordingFrame
// via serde, which has no #[serde(rename)] on this type — it expects Rust's
// own snake_case field names, not the camelCase the GraphQL boundary (and
// so this CSV's own column headers) use. Same rule as any other hand-built
// JSON patch in this app — see feedback_typiql_storage_key_casing memory.
function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

// Inverse of toCsv — reads the `# key=value` metadata lines back out, then
// the header row for field names, then each data row into a plain object
// per frame keyed by those field names (values coerced to number; a
// missing/blank cell is simply omitted, letting the backend's own
// `#[serde(default)]` fill it in on import).
export function parseImportedCsv(text: string): ParsedImport {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  let sampleRateHz = 30;
  let car: string | null = null;
  let i = 0;
  for (; i < lines.length && lines[i].startsWith('#'); i++) {
    const m = lines[i].match(/^#\s*(\w+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === 'sampleRateHz') sampleRateHz = parseFloat(value) || sampleRateHz;
    else if (key === 'car') car = value.trim() || null;
  }

  const headerLine = lines[i];
  if (!headerLine) throw new Error('No header row found — not a recording export CSV.');
  const [, ...allFieldColumns] = headerLine.split(','); // drop time_s
  const fieldColumns = allFieldColumns.filter(f => !NON_FORWARDABLE_IMPORT_FIELDS.has(f));

  const frames: Record<string, number | boolean>[] = [];
  for (let r = i + 1; r < lines.length; r++) {
    const cells = lines[r].split(',');
    const frame: Record<string, number | boolean> = {};
    allFieldColumns.forEach((field, idx) => {
      if (NON_FORWARDABLE_IMPORT_FIELDS.has(field)) return;
      const raw = cells[idx + 1];
      if (raw === undefined || raw === '') return;
      const num = Number(raw);
      if (Number.isNaN(num)) return;
      frame[camelToSnake(field)] = BOOLEAN_IMPORT_FIELDS.has(field) ? num !== 0 : num;
    });
    frames.push(frame);
  }

  return { sampleRateHz, car, fields: fieldColumns, frames };
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
