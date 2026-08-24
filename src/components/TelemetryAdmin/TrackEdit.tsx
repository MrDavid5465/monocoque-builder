import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useLazyQuery } from '@apollo/client/react';
import { Stack, IconButton, PrimaryButton, DefaultButton, TextField, Separator, Form, useQuery, useMutation } from '../../lib/denim/lib';
import {
  GET_TRACK_LOCATIONS, ADD_TRACK_LOCATION, UPDATE_TRACK_LOCATION, SEARCH_TRACK_LOCATIONS,
  GeocodeResult,
} from '../Telemetry/trackLocationQueries';

// One raw telemetry track-id per line in the UI, stored server-side as a
// JSON array (TrackLocation.rawTrackIds) — see typiql_types.rs's doc comment
// on why one location can list several ids (different sim/game, DLC/mod
// variant, or layout, all resolving to the same real-world circuit).
function parseRawIds(text: string): string[] {
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}
function formatRawIds(json: string | undefined): string {
  try {
    const arr = JSON.parse(json ?? '[]');
    return Array.isArray(arr) ? arr.join('\n') : '';
  } catch {
    return '';
  }
}

interface TrackFormState {
  name: string;
  latitude: string;
  longitude: string;
  rawTrackIdsText: string;
}
const EMPTY_FORM_STATE: TrackFormState = { name: '', latitude: '', longitude: '', rawTrackIdsText: '' };

// Every persisted field goes through one per-form schema — including
// latitude/longitude/raw-ids, which is easy to skip in favor of hand-rolled
// TextFields since they look like "just numbers", but per-form is the
// established convention for every editable field in this app regardless
// (see feedback_per_form_only). Only the geocode search below (a momentary
// action, not stored state) is a legitimate hand-rolled exception.
const trackFormSchema = {
  name: { type: 'text' as const, label: 'Track name' },
  latitude: { type: 'text' as const, label: 'Latitude' },
  longitude: { type: 'text' as const, label: 'Longitude' },
  rawTrackIdsText: {
    type: 'text' as const,
    label: 'Raw track ids (one per line — different sim/game, DLC, or layout variants of this circuit)',
    multiline: true,
    rows: 4,
  },
};

// Registered for ReactiveAdmin's show/edit/new slots — one component for all
// three, same rationale as GroupEdit/CarShow.
const TrackEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isNew = !id;

  const { data: tracksData } = useQuery(GET_TRACK_LOCATIONS, { fetchPolicy: 'cache-and-network', skip: isNew });
  const [addTrack] = useMutation(ADD_TRACK_LOCATION, { refetchQueries: [{ query: GET_TRACK_LOCATIONS }] });
  const [updateTrack] = useMutation(UPDATE_TRACK_LOCATION, { refetchQueries: [{ query: GET_TRACK_LOCATIONS }] });

  const existing = !isNew ? ((tracksData as any)?.getTrackLocations ?? []).find((t: any) => t.id === id) : undefined;

  // per-form's <Form> is uncontrolled (snapshots initialValues once at
  // mount, per DashPanEditor/ObjectExplorer's established convention) —
  // formState tracks the CURRENT values (synced from the Form's own
  // onChange on every edit), and formKey bumps to force a remount whenever
  // something OTHER than direct typing needs to push a new value IN: the
  // existing record loading, or a geocode search result being applied.
  const [formState, setFormState] = useState<TrackFormState>(EMPTY_FORM_STATE);
  const [formKey, setFormKey] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  if (!hydrated && existing) {
    setFormState({
      name: existing.name ?? '',
      latitude: String(existing.latitude ?? ''),
      longitude: String(existing.longitude ?? ''),
      rawTrackIdsText: formatRawIds(existing.rawTrackIds),
    });
    setFormKey(k => k + 1);
    setHydrated(true);
  }

  const [saving, setSaving] = useState(false);

  // Geocode search (OpenStreetMap Nominatim, proxied through our backend) —
  // type a place name, pick a result to fill in latitude/longitude, no
  // manual coordinate hunting needed. Not a persisted field itself, so it
  // stays outside the schema-driven form (the hand-rolled-components skill's
  // escape hatch for a momentary action), same as DayNightSimPanel's
  // nudge-buttons row.
  const [searchText, setSearchText] = useState('');
  const [runSearch, { data: searchData, loading: searching }] = useLazyQuery(SEARCH_TRACK_LOCATIONS);
  const searchResults: GeocodeResult[] = (searchData as any)?.searchTrackLocations ?? [];

  const applyGeocodeResult = (r: GeocodeResult) => {
    setFormState(s => ({ ...s, latitude: String(r.latitude), longitude: String(r.longitude) }));
    setFormKey(k => k + 1); // remount so the Form picks up the new lat/lon
  };

  const handleFormChange = (_n: string, { raw }: any) => {
    setFormState({
      name: raw.name ?? '',
      latitude: raw.latitude ?? '',
      longitude: raw.longitude ?? '',
      rawTrackIdsText: raw.rawTrackIdsText ?? '',
    });
  };

  const handleSave = async () => {
    const lat = parseFloat(formState.latitude);
    const lon = parseFloat(formState.longitude);
    if (!formState.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    setSaving(true);
    try {
      const values = { name: formState.name.trim(), latitude: lat, longitude: lon, rawTrackIds: JSON.stringify(parseRawIds(formState.rawTrackIdsText)) };
      if (isNew) {
        const result = await addTrack({ variables: { values } });
        const newId = (result.data as any)?.addTrackLocation?.id;
        if (newId) navigate(pathname.replace('new', `${newId}/show`));
      } else {
        await updateTrack({ variables: { id, update: values } });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '1.2em 1.5em', maxWidth: 640 }}>
      <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }} style={{ marginBottom: '1em' }}>
        <IconButton iconProps={{ iconName: 'Back' }} onClick={() => navigate(pathname.replace(isNew ? '/new' : `/${id}/show`, ''))} title="Back" />
        <span style={{ fontSize: '1.2em', fontWeight: 700 }}>{isNew ? 'New Track' : formState.name || 'Track'}</span>
      </Stack>

      <Form
        key={formKey}
        form={trackFormSchema}
        name="track"
        initialValues={formState}
        onChange={handleFormChange}
      />

      <Separator />

      <span style={{ fontSize: '0.85em', fontWeight: 600 }}>Find coordinates</span>
      <Stack horizontal verticalAlign="end" tokens={{ childrenGap: 8 }} style={{ marginTop: '0.4em' }}>
        <TextField
          label={'Search (e.g. "Silverstone Circuit UK")'}
          value={searchText}
          onChange={(_e, v) => setSearchText(v ?? '')}
          onKeyDown={e => { if (e.key === 'Enter' && searchText.trim()) runSearch({ variables: { query: searchText.trim() } }); }}
          styles={{ root: { flex: 1 } }}
        />
        <DefaultButton
          text={searching ? 'Searching…' : 'Search'}
          disabled={!searchText.trim() || searching}
          onClick={() => runSearch({ variables: { query: searchText.trim() } })}
        />
      </Stack>
      {searchResults.length > 0 && (
        <Stack tokens={{ childrenGap: 2 }} style={{ marginTop: '0.5em' }}>
          {searchResults.map((r, i) => (
            <DefaultButton
              key={i}
              styles={{ root: { height: 'auto', textAlign: 'left', padding: '0.4em 0.6em' }, label: { whiteSpace: 'normal', fontWeight: 400 } }}
              onClick={() => applyGeocodeResult(r)}
            >
              {r.displayName} ({r.latitude.toFixed(4)}, {r.longitude.toFixed(4)})
            </DefaultButton>
          ))}
        </Stack>
      )}

      <PrimaryButton disabled={!formState.name.trim() || saving} style={{ marginTop: '1.5em' }} onClick={handleSave}>
        {saving ? 'Saving…' : 'Save'}
      </PrimaryButton>
    </div>
  );
};

export default TrackEdit;
