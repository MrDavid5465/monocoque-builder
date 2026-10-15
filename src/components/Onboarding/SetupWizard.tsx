import React, { useState } from 'react';
import { Stack, Dialog, PrimaryButton, DefaultButton, TextField, useQuery, useMutation } from '../../lib/denim-fabric/lib';
import { DialogType, Text } from '@fluentui/react';
import { getTheme } from '../../lib/denim-fabric/lib';
import dispatcher from '../../graphql/appSettings';


interface Props {
  onComplete: () => void;
}

const SetupWizard: React.FC<Props> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [dataDir, setDataDir] = useState('');
  const [steerMaxDeg, setSteerMaxDeg] = useState(400);
  const [saving, setSaving] = useState(false);

  const [updateSettings] = useMutation(dispatcher.updateSettings);
  const { data: myData } = useQuery(dispatcher.my, { fetchPolicy: 'cache-first' });
  const settings = (myData as any)?.my?.settings ?? {};

  const handleFinish = async () => {
    setSaving(true);
    try {
      await updateSettings({
        variables: {
          settings: {
            theme: settings.theme ?? 'dark-green',
            fontSize: settings.fontSize ?? 1.0,
            launchPage: settings.launchPage ?? '',
            deviceMap: settings.deviceMap ?? {},
            typiqlDataDir: dataDir || undefined,
            steerMaxDeg,
            setupComplete: true,
          },
        },
      });
    } catch (e) {
      console.error('Setup wizard save failed:', e);
    } finally {
      setSaving(false);
      onComplete();
    }
  };

  const steps: { title: string; body: React.ReactNode; back?: () => void; next: () => void; nextLabel?: string }[] = [
    {
      title: 'Welcome to Dashboard Designer',
      body: (
        <Text variant="medium">
          Let's get you set up. This wizard will walk you through the essential settings.
          You can change all of these later in Settings.
        </Text>
      ),
      next: () => setStep(1),
      nextLabel: 'Get Started',
    },
    {
      title: 'Data Directory',
      body: (
        <Stack tokens={{ childrenGap: 8 }}>
          <Text variant="medium">
            Where should dashboard data be stored? Leave blank to use the default
            (<code>~/.config/dashboard-designer</code>).
          </Text>
          <TextField
            label="Config directory"
            placeholder="~/.config/dashboard-designer"
            value={dataDir}
            onChange={(_e, v) => setDataDir(v ?? '')}
          />
        </Stack>
      ),
      back: () => setStep(0),
      next: () => setStep(2),
    },
    {
      title: 'Steering Wheel',
      body: (
        <Stack tokens={{ childrenGap: 8 }}>
          <Text variant="medium">
            How many total degrees does your steering wheel rotate (full lock-to-lock)?
            For example, a typical GT wheel is 900°. This is used to counter-rotate
            dashboard elements with your steering input.
          </Text>
          <Stack horizontal verticalAlign="center" tokens={{ childrenGap: 8 }}>
            <Stack.Item grow>
              <label style={{ fontSize: '0.85em', display: 'block', marginBottom: 4 }}>Total rotation (degrees)</label>
              <input
                type="range" min={90} max={1440} step={10}
                value={steerMaxDeg}
                onChange={e => setSteerMaxDeg(Number(e.target.value))}
                style={{ width: '100%', accentColor: getTheme().palette.themePrimary, cursor: 'pointer' }}
              />
            </Stack.Item>
            <input
              type="number"
              min={90} max={1440} step={10}
              value={steerMaxDeg}
              onChange={e => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setSteerMaxDeg(Math.max(90, Math.min(1440, v)));
              }}
              style={{ width: 60, textAlign: 'right' }}
            />
            <span>°</span>
          </Stack>
        </Stack>
      ),
      back: () => setStep(1),
      next: () => setStep(3),
    },
    {
      title: 'All set!',
      body: (
        <Text variant="medium">
          Your settings have been saved. You can adjust them at any time via the Settings icon
          in the top bar. Head to the Dashboard Designer to start building your display.
        </Text>
      ),
      back: () => setStep(2),
      next: handleFinish,
      nextLabel: saving ? 'Saving…' : 'Finish',
    },
  ];

  const current = steps[step];

  return (
    <Dialog
      hidden={false}
      dialogContentProps={{
        type: DialogType.normal,
        title: current.title,
        showCloseButton: false,
      }}
      modalProps={{ isBlocking: true }}
      minWidth={480}
    >
      <Stack tokens={{ childrenGap: 16 }}>
        <Text variant="small" styles={{ root: { opacity: 0.5 } }}>
          Step {step + 1} of {steps.length}
        </Text>
        {current.body}
        <Stack horizontal horizontalAlign="end" tokens={{ childrenGap: 8 }} style={{ paddingTop: 8 }}>
          {current.back && <DefaultButton text="Back" onClick={current.back} />}
          <PrimaryButton
            text={current.nextLabel ?? 'Next'}
            onClick={current.next}
            disabled={saving}
          />
        </Stack>
      </Stack>
    </Dialog>
  );
};

export default SetupWizard;
