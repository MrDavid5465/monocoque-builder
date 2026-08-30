import React, { useState } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { Checkbox } from '@fluentui/react';
import { Form, FormCard } from '../../lib/denim/lib';
import {
  GET_HUENICORN_CHANNELS,
  GET_HUENICORN_DISPLAY_INFO,
  GET_HUENICORN_ENTERTAINMENT_CONFIGS,
  GET_HUENICORN_INTERPOLATION_INFO,
  IHuenicornDisplayInfo,
  IHuenicornEntertainmentConfigs,
  IHuenicornInterpolationInfo,
  SET_HUENICORN_ENTERTAINMENT_CONFIGURATION,
  SET_HUENICORN_INTERPOLATION,
  SET_HUENICORN_REFRESH_RATE,
  SET_HUENICORN_SUBSAMPLE_WIDTH,
  SET_HUENICORN_TRANSITION_SMOOTHING,
} from './queries';

// Capture-quality knobs from Huenicorn's own "Advanced settings" section —
// collapsed by default, same gate as the original (most setups never touch
// these after initial calibration). Each field applies immediately on
// change, one REST PUT per field, matching the original's own live-apply
// behavior rather than batching into a single Save.
export const AdvancedHuenicornSettings: React.FC<{ apiReachable: boolean }> = ({ apiReachable }) => {
  const [expanded, setExpanded] = useState(false);

  const { data: displayData } = useQuery<IHuenicornDisplayInfo>(GET_HUENICORN_DISPLAY_INFO, {
    pollInterval: 5000,
    fetchPolicy: 'network-only',
    skip: !expanded,
  });
  const { data: interpData } = useQuery<IHuenicornInterpolationInfo>(GET_HUENICORN_INTERPOLATION_INFO, {
    pollInterval: 5000,
    fetchPolicy: 'network-only',
    skip: !expanded,
  });
  const { data: entConfigData } = useQuery<IHuenicornEntertainmentConfigs>(GET_HUENICORN_ENTERTAINMENT_CONFIGS, {
    pollInterval: 5000,
    fetchPolicy: 'network-only',
    skip: !expanded,
  });

  const displayInfo = displayData?.huenicornDisplayInfo;
  const interpolationInfo = interpData?.huenicornInterpolationInfo;
  const entConfigs = entConfigData?.huenicornEntertainmentConfigs;

  const [setSubsampleWidth] = useMutation(SET_HUENICORN_SUBSAMPLE_WIDTH, {
    refetchQueries: [{ query: GET_HUENICORN_DISPLAY_INFO }],
  });
  const [setRefreshRate] = useMutation(SET_HUENICORN_REFRESH_RATE);
  const [setInterpolation] = useMutation(SET_HUENICORN_INTERPOLATION, {
    refetchQueries: [{ query: GET_HUENICORN_INTERPOLATION_INFO }],
  });
  const [setTransitionSmoothing] = useMutation(SET_HUENICORN_TRANSITION_SMOOTHING);
  const [setEntertainmentConfiguration] = useMutation(SET_HUENICORN_ENTERTAINMENT_CONFIGURATION, {
    refetchQueries: [
      { query: GET_HUENICORN_ENTERTAINMENT_CONFIGS },
      { query: GET_HUENICORN_CHANNELS },
      { query: GET_HUENICORN_DISPLAY_INFO },
    ],
  });

  const schema: Record<string, any> = {
    subsampleWidth: {
      type: 'select',
      label: 'Subsample resolution',
      options: (displayInfo?.subsampleResolutionCandidates ?? []).map(c => ({
        text: `${c.x}x${c.y}`,
        value: String(c.x),
      })),
    },
    refreshRate: {
      type: 'slider',
      label: 'Refresh rate (Hz)',
      min: 1,
      max: displayInfo?.maxRefreshRate ?? 60,
      step: 1,
    },
    interpolation: {
      type: 'select',
      label: 'Interpolation',
      options: (interpolationInfo?.available ?? []).map(o => ({ text: o.name, value: String(o.value) })),
    },
    transitionSmoothing: {
      type: 'slider',
      label: 'Transition smoothing (%)',
      min: 0,
      max: 95,
      step: 1,
    },
  };
  // Same gate as Huenicorn's own web UI — only worth showing when there's
  // actually a choice to make.
  if (entConfigs && entConfigs.configs.length > 1) {
    schema.entertainmentConfig = {
      type: 'select',
      label: 'Entertainment configuration',
      options: entConfigs.configs.map(c => ({ text: c.name, value: c.id })),
    };
  }

  const initialValues = {
    subsampleWidth: displayInfo ? String(displayInfo.subsampleWidth) : '',
    refreshRate: displayInfo?.selectedRefreshRate ?? 30,
    interpolation: interpolationInfo ? String(interpolationInfo.current) : '',
    transitionSmoothing: displayInfo?.selectedTransitionSmoothing ?? 0,
    entertainmentConfig: entConfigs?.currentId ?? '',
  };

  // `name` is the single field that just changed (see Form.tsx's own
  // onChange(name, {clean, ...}) contract) — dispatched to exactly one
  // mutation, not all of them, so touching one slider can't re-send every
  // other field's last value.
  const handleChange = (name: string, { clean }: any) => {
    switch (name) {
      case 'subsampleWidth':
        if (clean.subsampleWidth != null) setSubsampleWidth({ variables: { width: Number(clean.subsampleWidth) } });
        break;
      case 'refreshRate':
        if (clean.refreshRate != null) setRefreshRate({ variables: { hz: Number(clean.refreshRate) } });
        break;
      case 'interpolation':
        if (clean.interpolation != null) setInterpolation({ variables: { value: Number(clean.interpolation) } });
        break;
      case 'transitionSmoothing':
        if (clean.transitionSmoothing != null)
          setTransitionSmoothing({ variables: { value: Number(clean.transitionSmoothing) } });
        break;
      case 'entertainmentConfig':
        if (clean.entertainmentConfig != null)
          setEntertainmentConfiguration({ variables: { id: clean.entertainmentConfig } });
        break;
    }
  };

  return (
    <FormCard style={{ maxWidth: 420, marginTop: 16 }}>
      <Checkbox
        label="Advanced settings"
        checked={expanded}
        onChange={(_, checked) => setExpanded(!!checked)}
      />
      {expanded && (
        !apiReachable ? (
          <div style={{ fontSize: '0.85em', opacity: 0.6, marginTop: 8 }}>
            Huenicorn isn't running — start it above to edit these.
          </div>
        ) : displayInfo ? (
          <div style={{ marginTop: 8 }}>
            <Form
              key={`advanced-${displayInfo.subsampleWidth}-${displayInfo.selectedRefreshRate}-${interpolationInfo?.current}-${displayInfo.selectedTransitionSmoothing}-${entConfigs?.currentId}`}
              form={schema}
              name="ambientLightsAdvanced"
              initialValues={initialValues}
              onChange={handleChange}
            />
          </div>
        ) : (
          <div style={{ fontSize: '0.85em', opacity: 0.6, marginTop: 8 }}>Loading…</div>
        )
      )}
    </FormCard>
  );
};

export default AdvancedHuenicornSettings;
