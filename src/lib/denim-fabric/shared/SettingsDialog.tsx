// The cross-feature Settings dialog, in Fluent: the core's useSettingsForm()
// does the work (General schema, extension tabs, one merged save); this file
// only draws it. Every bar uses it.
import React from 'react';
import { Modal, Pivot, PivotItem, PrimaryButton, DefaultButton, Stack, getTheme, keyframes } from '@fluentui/react';
import { motionTokens } from '@fluentui/react-motion';
import { useReducedMotion, useSettingsForm } from '../../denim';
import Form from '../../typical-admin-fabric/lib/templates/Form';
import { getStyle } from '../lib';
import { perfAnimStart } from './perf';

// Fluent's Modal fades out on close (its whole layer, dim included) but
// shows at once on open. The surface alone gets an enter: a fade and a
// slight scale, with Fluent's motion tokens. It's a CSS animation on the
// Modal's own surface element (`main`), the one element that moves; the
// dim layer appears at once.
const SURFACE_ENTER = keyframes({
  from: { opacity: 0, transform: 'scale(0.96)' },
  to: { opacity: 1, transform: 'none' },
});
const MODAL_STYLES = {
  main: {
    animationName: SURFACE_ENTER,
    animationDuration: `${motionTokens.durationNormal}ms`,
    animationTimingFunction: motionTokens.curveDecelerateMid,
    animationFillMode: 'both',
  },
};
// Under reduced motion: no fade either way, and the dialog unmounts the
// moment it closes.
const MODAL_STYLES_REDUCED = { root: { transition: 'none' } };

export interface SettingsDialogProps {
  isOpen: boolean;
  onDismiss: () => void;
}

// Memoized: the shell re-renders around it (sidebar toggles) while it's closed.
export const SettingsDialog: React.FC<SettingsDialogProps> = React.memo(function SettingsDialog({
  isOpen,
  onDismiss,
}) {
  const reduced = useReducedMotion();
  // Stable for the memoized content, whatever the caller passes.
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;
  const dismiss = React.useCallback(() => dismissRef.current(), []);

  // A new content instance per opening, so an unsaved draft from last time
  // doesn't come back (also when reopened during the closing fade).
  const [session, setSession] = React.useState(0);
  const [wasOpen, setWasOpen] = React.useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) setSession(n => n + 1);
  }
  React.useLayoutEffect(() => {
    if (!reduced && session > 0) perfAnimStart(isOpen ? 'settings-enter' : 'settings-exit', { untilIdle: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Fluent's Modal fades the dialog (and its dim layer) out, keeping it
  // mounted for the fade after closing. The content below doesn't
  // re-render meanwhile: it's memoized with props that don't change on
  // close, so closing is one cheap commit, the fade, and the unmount. Under
  // reduced motion it isn't rendered at all while closed (one commit).
  if (!isOpen && reduced) return null;

  return (
    <Modal
      isOpen={isOpen}
      onDismiss={onDismiss}
      titleAriaId={'denim-settings-title'}
      styles={reduced ? MODAL_STYLES_REDUCED : MODAL_STYLES}
    >
      <SettingsContent key={session} onDismiss={dismiss} />
    </Modal>
  );
});

const SettingsContent: React.FC<{ onDismiss: () => void }> = React.memo(function SettingsContent({ onDismiss }) {
  const style = getStyle();
  // Always "open": this component exists only while the dialog shows.
  const form = useSettingsForm(true);

  const general = (
    <Stack tokens={{ childrenGap: '0.77em' }} style={{ paddingTop: '0.77em' }}>
      <Form
        form={form.general.schema}
        name={'userSettings'}
        initialValues={form.general.initialValues}
        onChange={form.general.onChange}
      />
    </Stack>
  );

  const loading = form.loading.length > 0;

  async function handleSave() {
    if (await form.save()) onDismiss();
  }

  return (
    <>
      <Stack className={style.modalHeader}>
        <span id={'denim-settings-title'}>Settings</span>
      </Stack>
      <Stack className={style.modalBody}>
        <div style={{ width: '34em', maxWidth: '100%' }}>
          {form.tabs.length === 0 ? (
            general
          ) : (
            // Tabs that don't fit (a phone, or an app with many extension
            // tabs) go into an overflow menu; without it the Pivot scrolls
            // sideways and takes the selected tab's content off-screen.
            <Pivot overflowBehavior="menu" overflowAriaLabel="More settings tabs">
              <PivotItem headerText="General" itemKey="general">
                {general}
              </PivotItem>
              {form.tabs.map(({ key, headerText, Component, props }) => (
                <PivotItem key={key} itemKey={key} headerText={headerText}>
                  <Stack style={{ paddingTop: '0.77em' }}>
                    <Component {...props} />
                  </Stack>
                </PivotItem>
              ))}
            </Pivot>
          )}
        </div>

        <Stack horizontal verticalAlign="center" wrap tokens={{ childrenGap: '0.77em' }} style={{ paddingTop: '1em' }}>
          {/* Held while an open tab is still loading its data: saving then
              would save the empty values it was seeded with. */}
          <PrimaryButton onClick={handleSave} disabled={form.saving || loading}>Save</PrimaryButton>
          <DefaultButton onClick={onDismiss}>Cancel</DefaultButton>
          {loading && (
            <span role="status" style={{ fontSize: '0.82em', color: getTheme().palette.neutralSecondary }}>
              Loading {form.loading.map(t => t.headerText).join(', ')}…
            </span>
          )}
          {form.error && (
            <span role="alert" style={{ fontSize: '0.82em', color: getTheme().palette.redDark }}>{form.error}</span>
          )}
        </Stack>
      </Stack>
    </>
  );
});

export default SettingsDialog;
