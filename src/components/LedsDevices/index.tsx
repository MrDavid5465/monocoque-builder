import React from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { PrimaryButton } from '@fluentui/react';
import ReactiveAdmin from '../../lib/typical-admin-fabric';
import LedsDeviceList from '../Shakers/LedsDevices';
import DeviceProfilesList from '../shared/DeviceProfilesList';
import { useDeviceProfileCard } from '../shared/useDeviceProfileCard';
import { getTheme, Form, FormCard } from '../../lib/denim/lib';
import {
  GET_PROFILES, ADD_PROFILE, REMOVE_PROFILE, PROFILE_CHANGED,
  profileResultKey, addProfileResultKey, STORAGE_KEY,
} from './Profiles/queries';
import { GET_LEDS, CREATE_LEDS, REMOVE_LEDS, LEDS_CHANGED } from '../Shakers/LedsDevices/queries';
import { LedsDeviceRec } from '../Shakers/LedsDevices/queries';

function liveToInput(rec: LedsDeviceRec, profileId: string | null) {
  return { devpath: rec.devpath, baud: rec.baud, numLeds: rec.numLeds, startLed: rec.startLed, endLed: rec.endLed, config: rec.config, profileId };
}

const profileSchema = {
  list: { columns: { name: { label: 'Name' }, car: { label: 'Car' }, game: { label: 'Game' } } },
  new:  { name: { type: 'text', label: 'Name', required: true }, car: { type: 'text', label: 'Car (optional)' }, game: { type: 'text', label: 'Game (optional)' } },
  show: { name: { label: 'Name' }, car: { label: 'Car' }, game: { label: 'Game' } },
  edit: { name: { type: 'text', label: 'Name', required: true }, car: { type: 'text', label: 'Car (optional)' }, game: { type: 'text', label: 'Game (optional)' } },
};
const dispatcher = { list: GET_PROFILES, show: GET_PROFILES, new: ADD_PROFILE, edit: ADD_PROFILE, delete: REMOVE_PROFILE, subscribe: PROFILE_CHANGED };
const name = { singular: 'LedsDeviceProfile', plural: 'LedsDeviceProfiles' };

const ProfilesList: React.FC<any> = (props) => (
  <DeviceProfilesList
    {...props}
    getProfilesQuery={GET_PROFILES}
    removeProfileMutation={REMOVE_PROFILE} profileChangedSubscription={PROFILE_CHANGED}
    profilesResultKey={profileResultKey}
    getDevicesQuery={GET_LEDS} createDeviceMutation={CREATE_LEDS}
    removeDeviceMutation={REMOVE_LEDS} deviceChangedSubscription={LEDS_CHANGED}
    devicesResultKey="getMonocoqueLedsDevices"
    liveToInput={liveToInput}
    storageKey={STORAGE_KEY}
  />
);

const ProfileEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = getTheme();
  return (
    <div style={{ color: theme.palette.neutralPrimary }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: theme.palette.neutralLight, borderBottom: `1px solid ${theme.palette.neutralTertiaryAlt}` }}>
        <button onClick={() => navigate('/leds/profiles')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: theme.palette.themePrimary, fontSize: '0.875em', padding: 0 }}>← Profiles</button>
        <span style={{ fontWeight: 600 }}>Edit Profile</span>
      </div>
      <div style={{ padding: 16 }}>
        <LedsDeviceList profileId={id ?? null} />
      </div>
    </div>
  );
};

const LedsMain: React.FC = () => {
  // Just a FormCard holding a Form + a Save button (see ShakerMatrix.tsx's
  // own profile-card doc comment) — the state/logic behind it is generic
  // across LedsDevices/ShiftLights/SimWindDevices, so it's a shared hook,
  // not a component.
  const profileCard = useDeviceProfileCard({
    addProfileMutation: ADD_PROFILE, getProfilesQuery: GET_PROFILES,
    profilesResultKey: profileResultKey, addProfileResultKey,
    getDevicesQuery: GET_LEDS, createDeviceMutation: CREATE_LEDS, removeDeviceMutation: REMOVE_LEDS,
    devicesResultKey: 'getMonocoqueLedsDevices', liveToInput, storageKey: STORAGE_KEY,
  });

  return (
    <div>
      <FormCard style={{ maxWidth: 420, margin: 16 }}>
        <Form
          key={profileCard.formKey}
          form={profileCard.schema}
          name="profileSelect"
          initialValues={profileCard.initialValues}
          onChange={profileCard.handleChange}
        />
        <PrimaryButton
          text={profileCard.saving ? 'Saving…' : 'Save'}
          onClick={profileCard.handleSave}
          disabled={!profileCard.typedName.trim() || profileCard.saving}
        />
        {profileCard.status && <div style={{ fontSize: '0.8em', opacity: 0.6, marginTop: 6 }}>{profileCard.status}</div>}
      </FormCard>
      <LedsDeviceList />
    </div>
  );
};

const LedsDevices: React.FC = () => (
  <Routes>
    <Route path="/profiles/:id/edit" element={<ProfileEdit />} />
    <Route path="/profiles/*" element={<ReactiveAdmin dispatcher={dispatcher} name={name} schemaDefinition={profileSchema} components={{ list: ProfilesList }} />} />
    <Route path="/*" element={<LedsMain />} />
  </Routes>
);

export default LedsDevices;
