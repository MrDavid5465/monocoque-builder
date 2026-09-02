import React from 'react';
import { useParams } from 'react-router';
import { useTemplates } from '../Telemetry/DashboardDesigner/useTemplates';
import TemplateEditor from '../Telemetry/Templates/Editor';

// Registered for BOTH show and edit slots — templates don't have a separate
// read-only/kiosk view, editing IS the detail view. No "get one" query
// exists server-side, so resolution is a client-side .find() against the
// already-fetched list, matching the old Templates/index.tsx route.
const TemplateEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { templates, loading } = useTemplates();

  if (loading) return <span style={{ padding: '2em', display: 'block', opacity: 0.6 }}>Loading…</span>;
  const template = templates.find(t => t.id === (id ?? ''));
  if (!template) return <span style={{ padding: '2em', display: 'block', opacity: 0.6 }}>Template not found.</span>;

  return <TemplateEditor template={template} />;
};

export default TemplateEdit;
