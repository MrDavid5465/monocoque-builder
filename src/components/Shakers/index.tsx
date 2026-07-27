import React from 'react';
import { Routes, Route } from 'react-router-dom';
import ShakerMatrix from './ShakerMatrix';
import ProfilesAdmin from './Profiles';
import ProfileEdit from './Profiles/ProfileEdit';

// ── Shakers router ────────────────────────────────────────────────────────────
//
// The profile save/load card now lives inside ShakerMatrix.tsx itself (see
// its own ProfileCard) so it can sit in the same card row as the DSP mode /
// LFE settings cards, rather than as a separate bar above the whole page.

const Shakers: React.FC = () => (
  <Routes>
    <Route path="/profiles/:id/edit" element={<ProfileEdit />} />
    <Route path="/profiles/*" element={<ProfilesAdmin />} />
    <Route path="/*" element={<ShakerMatrix />} />
  </Routes>
);

export default Shakers;
