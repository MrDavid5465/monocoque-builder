import React from 'react';
import { Routes, Route, useParams, useNavigate } from 'react-router-dom';
import { PrimaryButton } from '@fluentui/react';
import ReactiveAdmin from '../../lib/typical-admin-fabric';
import ShiftLightList from '../Shakers/ShiftLights';
import DeviceProfilesList from '../shared/DeviceProfilesList';
import { useDeviceProfileCard } from '../shared/useDeviceProfileCard';
import { getTheme, Form, FormCard } from '../../lib/denim/lib';
import {
  GET_PROFILES, ADD_PROFILE, REMOVE_PROFILE, PROFILE_CHANGED,
  profileResultKey, addProfileResultKey, STORAGE_KEY,
} from './Profiles/queries';
import { GET_SHIFT_LIGHTS, CREATE_SHIFT_LIGHT, REMOVE_SHIFT_LIGHT, SHIFT_LIGHT_CHANGED } from '../Shakers/ShiftLights/queries';
import { ShiftLightRec } from '../Shakers/ShiftLights/queries';

function liveToInput(rec: ShiftLightRec, profileId: string | null) {
  return { devid: rec.devid, subtype: rec.subtype, granularity: rec.granularity, config: rec.config, profileId };
}

const profileSchema = {
  list: { columns: { name: { label: 'Name' }, car: { label: 'Car' }, game: { label: 'Game' } } },
  new:  { name: { type: 'text', label: 'Name', required: true }, car: { type: 'text', label: 'Car (optional)' }, game: { type: 'text', label: 'Game (optional)' } },
  show: { name: { label: 'Name' }, car: { label: 'Car' }, game: { label: 'Game' } },
  edit: { name: { type: 'text', label: 'Name', required: true }, car: { type: 'text', label: 'Car (optional)' }, game: { type: 'text', label: 'Game (optional)' } },
};
const dispatcher = { list: GET_PROFILES, show: GET_PROFILES, new: ADD_PROFILE, edit: ADD_PROFILE, delete: REMOVE_PROFILE, subscribe: PROFILE_CHANGED };
const name = { singular: 'ShiftLightProfile', plural: 'ShiftLightProfiles' };

const ProfilesList: React.FC<any> = (props) => (
  <DeviceProfilesList
    {...props}
    getProfilesQuery={GET_PROFILES}
    removeProfileMutation={REMOVE_PROFILE} profileChangedSubscription={PROFILE_CHANGED}
    profilesResultKey={profileResultKey}
    getDevicesQuery={GET_SHIFT_LIGHTS} createDeviceMutation={CREATE_SHIFT_LIGHT}
    removeDeviceMutation={REMOVE_SHIFT_LIGHT} deviceChangedSubscription={SHIFT_LIGHT_CHANGED}
    devicesResultKey="getMonocoqueShiftLights"
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
        <button onClick={() => navigate('/shift-lights/profiles')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: theme.palette.themePrimary, fontSize: '0.875em', padding: 0 }}>← Profiles</button>
        <span style={{ fontWeight: 600 }}>Edit Profile</span>
      </div>
      <div style={{ padding: 16 }}>
        <ShiftLightList profileId={id ?? null} />
      </div>
    </div>
  );
};

const ShiftLightsMain: React.FC = () => {
  // Just a FormCard holding a Form + a Save button (see ShakerMatrix.tsx's
  // own profile-card doc comment) — the state/logic behind it is generic
  // across LedsDevices/ShiftLights/SimWindDevices, so it's a shared hook,
  // not a component.
  const profileCard = useDeviceProfileCard({
    addProfileMutation: ADD_PROFILE, getProfilesQuery: GET_PROFILES,
    profilesResultKey: profileResultKey, addProfileResultKey,
    getDevicesQuery: GET_SHIFT_LIGHTS, createDeviceMutation: CREATE_SHIFT_LIGHT, removeDeviceMutation: REMOVE_SHIFT_LIGHT,
    devicesResultKey: 'getMonocoqueShiftLights', liveToInput, storageKey: STORAGE_KEY,
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
      <ShiftLightList />
    </div>
  );
};

const ShiftLights: React.FC = () => (
  <Routes>
    <Route path="/profiles/:id/edit" element={<ProfileEdit />} />
    <Route path="/profiles/*" element={<ReactiveAdmin dispatcher={dispatcher} name={name} schemaDefinition={profileSchema} components={{ list: ProfilesList }} />} />
    <Route path="/*" element={<ShiftLightsMain />} />
  </Routes>
);

export default ShiftLights;
