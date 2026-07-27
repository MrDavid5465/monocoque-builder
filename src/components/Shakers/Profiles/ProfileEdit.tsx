import React from 'react';
import { useParams, useNavigate } from 'react-router';
import { useQuery } from '@apollo/client/react';
import { getTheme } from '../../../lib/denim/lib';
import ShakerMatrix from '../ShakerMatrix';
import { GET_PROFILE } from './queries';

// ── ProfileEdit ───────────────────────────────────────────────────────────────

const ProfileEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = getTheme();

  const { data, loading } = useQuery(GET_PROFILE, { variables: { id }, skip: !id });
  const profile = (data as any)?.getSoundDeviceProfile;

  return (
    <div style={{ color: theme.palette.neutralPrimary }}>
      {/* Breadcrumb header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '8px 16px',
        background: theme.palette.neutralLight,
        borderBottom: `1px solid ${theme.palette.neutralTertiaryAlt}`,
      }}>
        <button
          onClick={() => navigate('/shakers/profiles')}
          style={{
            border: 'none', background: 'none', cursor: 'pointer',
            color: theme.palette.themePrimary, fontSize: '0.875em', padding: 0,
          }}
        >
          ← Profiles
        </button>
        <span style={{ opacity: 0.3 }}>|</span>
        {loading
          ? <span style={{ opacity: 0.5, fontSize: '0.875em' }}>Loading…</span>
          : <span style={{ fontWeight: 600 }}>{profile?.name ?? id}</span>
        }
        {profile?.car && <span style={{ fontSize: '0.8em', opacity: 0.55 }}>{profile.car}</span>}
        {profile?.game && <span style={{ fontSize: '0.8em', opacity: 0.55 }}>{profile.game}</span>}
      </div>

      <ShakerMatrix profileId={id ?? null} />
    </div>
  );
};

export default ProfileEdit;
