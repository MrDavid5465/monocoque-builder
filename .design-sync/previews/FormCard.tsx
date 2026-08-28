import * as React from 'react';
import { FormCard, Form } from 'denim';

// A surface that groups a form (or any content) into a raised card. It's a
// pure container — it paints nothing without children, so every cell composes
// it with real content.

export const WithForm = () => (
  <FormCard style={{ maxWidth: 420 }}>
    <Form
      name="shakerProfile"
      form={{
        name: { type: 'text', label: 'Profile name' },
        device: { type: 'text', label: 'Output device' },
        enabled: { type: 'checkbox', label: 'Enabled' },
      }}
      initialValues={{ name: 'Endurance — rear', device: 'Surround (analog 4.0)', enabled: true }}
    />
  </FormCard>
);

export const WithContent = () => (
  <FormCard style={{ maxWidth: 420 }}>
    <div style={{ fontWeight: 600, marginBottom: 8 }}>Huenicorn status</div>
    <div style={{ color: '#3aa76d' }}>✓ Running</div>
    <div style={{ fontSize: '0.85em', opacity: 0.7, marginTop: 6 }}>
      Streaming to 4 channels at 30 Hz.
    </div>
  </FormCard>
);

export const Stacked = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 420 }}>
    <FormCard>
      <div style={{ fontWeight: 600 }}>Ambient lighting</div>
      <div style={{ fontSize: '0.85em', opacity: 0.7 }}>Tint intensity 0.3</div>
    </FormCard>
    <FormCard>
      <div style={{ fontWeight: 600 }}>Shaker DSP</div>
      <div style={{ fontSize: '0.85em', opacity: 0.7 }}>4 channels active</div>
    </FormCard>
  </div>
);
