import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import settingsDispatcher from '../../lib/denim/lib/queries';
import { GET_ITEMS } from './queries';
import { GET_SHAKER_CHANNELS } from './channelQueries';
import { WRITE_MONOCOQUE_CONFIG, RELOAD_MONOCOQUE } from './dspQueries';
import { GET_SHIFT_LIGHTS, ShiftLightRec } from './ShiftLights/queries';
import { GET_LEDS, LedsDeviceRec } from './LedsDevices/queries';
import { GET_SIM_WINDS, SimWindDeviceRec } from './SimWindDevices/queries';
import { buildFullMonocoqueConfig } from './monocoqueConfig';
import { ShakerRec } from './EffectRow';
import { ShakerChannel } from './channelQueries';

const liveOnly = <T extends { profileId?: string | null }>(records: T[]) =>
  records.filter(r => (r.profileId ?? null) === null);

// Shared "Export to Config" / "Restart Monocoque" action for every device
// page (ShiftLights, LedsDevices, SimWindDevices — ShakerMatrix has its own
// inline copy of this same shape since it already holds most of these
// queries for other reasons). Every page's export has to write monocoque's
// *entire* config, not just the device category that page happens to show
// (see monocoqueConfig.ts's doc comment) — so this always fetches all four
// live device sets fresh via refetch, regardless of which page calls it.
// Deliberately plain useQuery, no useSubscription, for the same connection-
// budget reason documented in ShakerMatrix.tsx.
export function useMonocoqueExport() {
  const [status, setStatus] = useState<string | null>(null);

  const { data: myData } = useQuery(settingsDispatcher.my);
  const { refetch: refetchSound } = useQuery(GET_ITEMS);
  const { refetch: refetchChannels } = useQuery(GET_SHAKER_CHANNELS);
  const { refetch: refetchShiftLights } = useQuery(GET_SHIFT_LIGHTS);
  const { refetch: refetchLeds } = useQuery(GET_LEDS);
  const { refetch: refetchSimWind } = useQuery(GET_SIM_WINDS);
  const [writeConfig] = useMutation(WRITE_MONOCOQUE_CONFIG);
  const [reloadMonocoque] = useMutation(RELOAD_MONOCOQUE);

  const dspEnabled: boolean = (myData as any)?.my?.settings?.shakerDspEnabled ?? false;

  const handleExport = async () => {
    setStatus('Exporting…');
    try {
      const [soundRes, channelsRes, shiftLightsRes, ledsRes, simWindRes] = await Promise.all([
        refetchSound(), refetchChannels(), refetchShiftLights(), refetchLeds(), refetchSimWind(),
      ]);
      const config = buildFullMonocoqueConfig({
        shakerRecords: liveOnly<ShakerRec>((soundRes.data as any)?.getMonocoqueSoundDevices ?? []),
        shakerChannels: liveOnly<ShakerChannel>((channelsRes.data as any)?.getShakerChannels ?? []),
        dspEnabled,
        shiftLights: liveOnly<ShiftLightRec>((shiftLightsRes.data as any)?.getMonocoqueShiftLights ?? []),
        ledsDevices: liveOnly<LedsDeviceRec>((ledsRes.data as any)?.getMonocoqueLedsDevices ?? []),
        simWindDevices: liveOnly<SimWindDeviceRec>((simWindRes.data as any)?.getMonocoqueSimWindDevices ?? []),
      });
      await writeConfig({ variables: { config } });
      setStatus('Exported.');
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? e}`);
    }
  };

  const handleRestart = async () => {
    setStatus('Restarting…');
    try {
      await reloadMonocoque();
      setStatus('Restarted.');
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? e}`);
    }
  };

  return { status, handleExport, handleRestart };
}
