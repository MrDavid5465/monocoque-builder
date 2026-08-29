import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import { useLazyQuery } from '@apollo/client/react';
import { Stack, IconButton, PrimaryButton, DefaultButton, TextField, Separator, Form, useQuery, useMutation } from '../../lib/denim/lib';
import {
  GET_TRACK_LOCATIONS, ADD_TRACK_LOCATION, UPDATE_TRACK_LOCATION, SEARCH_TRACK_LOCATIONS, GET_KNOWN_TRACKS,
  GeocodeResult,
} from '../Telemetry/trackLocationQueries';

// Stored server-side as a JSON array (TrackLocation.rawTrackIds) — see
// typiql_types.rs's doc comment on why one location can list several ids
// (different sim/game, DLC/mod variant, or layout, all resolving to the same
// real-world circuit).
function parseRawIds(json: string | undefined): string[] {
  try {
    const arr = JSON.parse(json ?? '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

interface TrackFormState {
  name: string;
  latitude: string;
  longitude: string;
  rawTrackIds: string[];
}
const EMPTY_FORM_STATE: TrackFormState = { name: '', latitude: '', longitude: '', rawTrackIds: [] };

// Registered for ReactiveAdmin's show/edit/new slots — one component for all
// three, same rationale as GroupEdit/CarShow.
const TrackEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const isNew = !id;

  // Unconditional (not skip: isNew like before) — this now also feeds
  // `claimedByOthers` below, needed on the New form too so a fresh track
  // can't silently claim a raw id another TrackLocation already lists.
  const { data: tracksData } = useQuery(GET_TRACK_LOCATIONS, { fetchPolicy: 'cache-and-network' });
  const { data: knownTracksData } = useQuery(GET_KNOWN_TRACKS, { fetchPolicy: 'cache-and-network' });
  const [addTrack] = useMutation(ADD_TRACK_LOCATION, { refetchQueries: [{ query: GET_TRACK_LOCATIONS }] });
  const [updateTrack] = useMutation(UPDATE_TRACK_LOCATION, { refetchQueries: [{ query: GET_TRACK_LOCATIONS }] });

  const allTracks: any[] = (tracksData as any)?.getTrackLocations ?? [];
  const existing = !isNew ? allTracks.find((t: any) => t.id === id) : undefined;
  const knownTrackIds: string[] = ((knownTracksData as any)?.getKnownTracks ?? []).map((t: any) => t.id);
  const claimedByOthers = new Set(
    allTracks.filter(t => t.id !== id).flatMap(t => parseRawIds(t.rawTrackIds)),
  );

  // Every persisted field goes through one per-form schema (see
  // feedback_per_form_only) — rawTrackIds mirrors Car's carIds multi-select
  // exactly (CarDetail.tsx/CarNew.tsx): options come from KnownTrack (raw
  // ids actually seen in live telemetry, via registerTrack), and an id
  // already claimed by another TrackLocation is disabled so the same raw id
  // can't silently end up on two locations (find_track_location would then
  // resolve it to whichever comes first).
  const trackFormSchema = {
    name: { type: 'text' as const, label: 'Track name' },
    latitude: { type: 'text' as const, label: 'Latitude' },
    longitude: { type: 'text' as const, label: 'Longitude' },
    rawTrackIds: {
      type: 'multi-select' as const,
      label: 'Raw track ids (seen in telemetry — drive the track once to make it selectable here)',
      options: knownTrackIds.map(tid => ({ text: tid, value: tid, disabled: claimedByOthers.has(tid) })),
    },
  };

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
      rawTrackIds: parseRawIds(existing.rawTrackIds),
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
      rawTrackIds: raw.rawTrackIds ?? [],
    });
  };

  const handleSave = async () => {
    const lat = parseFloat(formState.latitude);
    const lon = parseFloat(formState.longitude);
    if (!formState.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    setSaving(true);
    try {
      const values = { name: formState.name.trim(), latitude: lat, longitude: lon, rawTrackIds: JSON.stringify(formState.rawTrackIds) };
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
