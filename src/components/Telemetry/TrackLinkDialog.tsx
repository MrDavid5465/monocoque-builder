import React, { useState } from 'react';
import { Dialog, DialogType, DialogFooter } from '@fluentui/react';
import { Stack, TextField, DefaultButton, Dropdown, getTheme, useQuery, useMutation } from '../../lib/denim/lib';
import { useLazyQuery } from '@apollo/client/react';
import {
  GET_TRACK_LOCATIONS, ADD_TRACK_LOCATION, UPDATE_TRACK_LOCATION, SEARCH_TRACK_LOCATIONS,
  GeocodeResult, TrackLocationRecord,
} from './trackLocationQueries';

interface Props {
  // The raw telemetry track id `setSunriseSunsetFromDate` couldn't match to
  // any TrackLocation — null/'' keeps the dialog hidden. Parsed by the
  // caller straight out of that mutation's own error message (see
  // DayNightSimPanel's handleComputeFromDate) rather than a fresh telemetry
  // subscription, since the error already carries the exact id we need and
  // this panel deliberately avoids opening extra live connections (see its
  // own top-of-file doc comment on the connection-budget/re-render issues
  // that caused).
  liveTrack: string | null;
  onDismiss: () => void;
  // Fired after either linking to an existing location or creating a new
  // one — the caller retries setSunriseSunsetFromDate so sunrise/sunset get
  // set as part of the same couple-of-clicks flow, not a separate step.
  onLinked: () => void;
}

// Lets the user resolve "this live track isn't linked to a Track Location
// yet" (the error set_sunrise_sunset_from_date returns) without leaving the
// Day/Night panel: either link the live track id onto an existing location's
// rawTrackIds, or search-and-create a brand new one, same geocode search
// TrackEdit.tsx already uses for coordinates. Reuses GET_TRACK_LOCATIONS/
// ADD_TRACK_LOCATION/UPDATE_TRACK_LOCATION/SEARCH_TRACK_LOCATIONS directly —
// no new backend mutation needed, this is pure recombination of existing
// CRUD + the existing geocode proxy.
const TrackLinkDialog: React.FC<Props> = ({ liveTrack, onDismiss, onLinked }) => {
  const theme = getTheme();
  const hidden = !liveTrack;

  const { data: tracksData } = useQuery(GET_TRACK_LOCATIONS, { fetchPolicy: 'cache-and-network', skip: hidden });
  const [addTrack, { loading: creating }] = useMutation(ADD_TRACK_LOCATION, { refetchQueries: [{ query: GET_TRACK_LOCATIONS }] });
  const [updateTrack, { loading: linking }] = useMutation(UPDATE_TRACK_LOCATION, { refetchQueries: [{ query: GET_TRACK_LOCATIONS }] });
  const locations: TrackLocationRecord[] = (tracksData as any)?.getTrackLocations ?? [];

  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [runSearch, { data: searchData, loading: searching }] = useLazyQuery(SEARCH_TRACK_LOCATIONS);
  const searchResults: GeocodeResult[] = (searchData as any)?.searchTrackLocations ?? [];
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSelectedLocationId('');
    setSearchText('');
    setError(null);
  };
  const handleDismiss = () => {
    reset();
    onDismiss();
  };

  const handleLinkExisting = async () => {
    const location = locations.find(l => l.id === selectedLocationId);
    if (!location || !liveTrack) return;
    setError(null);
    try {
      let ids: string[] = [];
      try {
        const parsed = JSON.parse(location.rawTrackIds ?? '[]');
        if (Array.isArray(parsed)) ids = parsed;
      } catch { /* treat unparsable as empty */ }
      if (!ids.includes(liveTrack)) ids = [...ids, liveTrack];
      await updateTrack({ variables: { id: location.id, update: { rawTrackIds: JSON.stringify(ids) } } });
      reset();
      onLinked();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to link track');
    }
  };

  const handleCreateFromResult = async (r: GeocodeResult) => {
    if (!liveTrack) return;
    setError(null);
    try {
      await addTrack({
        variables: {
          values: {
            name: r.displayName,
            latitude: r.latitude,
            longitude: r.longitude,
            rawTrackIds: JSON.stringify([liveTrack]),
          },
        },
      });
      reset();
      onLinked();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create track location');
    }
  };

  return (
    <Dialog
      hidden={hidden}
      onDismiss={handleDismiss}
      dialogContentProps={{
        type: DialogType.normal,
        title: 'Link this track',
        subText: `Live track "${liveTrack ?? ''}" isn't linked to a Track Location yet — link it to an existing one, or search for it below to create a new one. Either way, sunrise/sunset get computed right after.`,
      }}
      minWidth={420}
    >
      <Stack tokens={{ childrenGap: 8 }}>
        <span style={{ fontSize: '0.85em', fontWeight: 600 }}>Link to an existing location</span>
        <Stack horizontal verticalAlign="end" tokens={{ childrenGap: 8 }}>
          <Dropdown
            placeholder="Select a Track Location"
            selectedKey={selectedLocationId}
            onChange={(_e, option) => setSelectedLocationId(option ? String(option.key) : '')}
            options={locations.map(l => ({ key: l.id, text: l.name }))}
            styles={{ root: { flex: 1 } }}
          />
          <DefaultButton
            text={linking ? 'Linking…' : 'Link'}
            disabled={!selectedLocationId || linking}
            onClick={handleLinkExisting}
          />
        </Stack>

        <span style={{ fontSize: '0.85em', fontWeight: 600, marginTop: 8 }}>Or create a new location</span>
        <Stack horizontal verticalAlign="end" tokens={{ childrenGap: 8 }}>
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
          <Stack tokens={{ childrenGap: 2 }}>
            {searchResults.map((r, i) => (
              <DefaultButton
                key={i}
                disabled={creating}
                styles={{ root: { height: 'auto', textAlign: 'left', padding: '0.4em 0.6em' }, label: { whiteSpace: 'normal', fontWeight: 400 } }}
                onClick={() => handleCreateFromResult(r)}
              >
                {r.displayName} ({r.latitude.toFixed(4)}, {r.longitude.toFixed(4)})
              </DefaultButton>
            ))}
          </Stack>
        )}

        {error && <span style={{ fontSize: '0.8em', color: theme.semanticColors.errorText }}>{error}</span>}
      </Stack>

      <DialogFooter>
        <DefaultButton text="Cancel" onClick={handleDismiss} />
      </DialogFooter>
    </Dialog>
  );
};

export default TrackLinkDialog;
