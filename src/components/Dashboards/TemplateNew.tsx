import React, { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useTemplates } from '../Telemetry/DashboardDesigner/useTemplates';
import { ComponentNode } from '../../types/dashboard';

// Templates have no meaningful "blank form" — same as the old Browser.tsx's
// "New template" button, we immediately create a template wrapping a blank
// group node and jump straight into the editor.
const TemplateNew: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { createTemplate } = useTemplates();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const blankGroup: ComponentNode = {
        id: `group-${Date.now()}`,
        type: 'group',
        name: 'New Template',
        x: 40, y: 40,
        children: [],
      };
      const id = await createTemplate({ name: 'New Template', gaugeType: 'none', component: JSON.stringify(blankGroup) });
      if (id) navigate(pathname.replace('new', `${id}/edit`), { replace: true });
      else navigate(pathname.replace('/new', ''), { replace: true });
    })();
  }, [pathname, navigate, createTemplate]);

  return <span style={{ padding: '2em', display: 'block', opacity: 0.6 }}>Creating template…</span>;
};

export default TemplateNew;
