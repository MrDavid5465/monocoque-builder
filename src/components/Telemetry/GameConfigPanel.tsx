import React, { useMemo } from 'react';
import { Stack, useQuery, useMutation, Form, getTheme } from '../../lib/denim/lib';
import {
  GET_GAME_CONFIG,
  INSTALL_AC_TELEMETRY_APP,
  UNINSTALL_AC_TELEMETRY_APP,
  GameConfigRecord,
} from './gameConfigQueries';

// Everything here reports on the world rather than on stored settings — is the
// game there, is CSP there, is our Lua app written into it, does Steam pass
// the variable simd needs — so every field is the `check` type and nothing is
// persisted. The Form exists for layout and labelling consistency with the
// other settings tabs, not to own any state.
//
// Polled rather than subscribed: these answers change because of things done
// OUTSIDE this app (installing CSP, editing Steam launch options), so there's
// no mutation here to react to and no server-side event to publish. 5s is
// slow enough to be free and fast enough that a user who alt-tabs to Steam,
// pastes the launch options and comes back sees it go green without hunting
// for a refresh button.
const POLL_MS = 5000;

const GameConfigPanel: React.FC = () => {
  const theme = getTheme();
  const { data, refetch } = useQuery(GET_GAME_CONFIG, {
    fetchPolicy: 'cache-and-network',
    pollInterval: POLL_MS,
  });
  const [installTelemetryApp] = useMutation(INSTALL_AC_TELEMETRY_APP);
  const [uninstallTelemetryApp] = useMutation(UNINSTALL_AC_TELEMETRY_APP);

  const config = (data as any)?.gameConfig as GameConfigRecord | undefined;
  const support = (data as any)?.acTelemetrySupport as
    | { gameInstalled: boolean; appInstalled: boolean; connected: boolean; reason?: string | null }
    | undefined;

  // `unknown` until the first response: a red cross while the very first poll
  // is still in flight reads as a fault, and this panel's whole job is telling
  // the user which things are genuinely broken (see CheckField's own note).
  const check = (value: boolean | undefined) =>
    config === undefined ? ('unknown' as const) : value ? ('ok' as const) : ('fail' as const);

  const copyLaunchOptions = async () => {
    const options = config?.recommendedLaunchOptions;
    // Only built when the bridge ISN'T configured, so there's genuinely
    // nothing to offer once it is.
    if (!options) return 'Nothing to copy — the launch options already look right.';
    // This app is also served over plain http to other machines on the rig's
    // network, and outside a secure context navigator.clipboard is undefined.
    // Showing the string to copy by hand beats throwing a DOM error at someone
    // who is, by definition, not sitting at the machine Steam runs on.
    if (!navigator.clipboard?.writeText) return options;
    await navigator.clipboard.writeText(options);
    // Steam holds this config in memory and rewrites the file when it exits,
    // so writing it from here would be discarded — the backend deliberately
    // offers the string rather than applying it (see graphql/capture.rs).
    return 'Copied. Paste into Steam > Assetto Corsa > Properties > Launch Options, then restart Steam.';
  };

  const schema = useMemo(
    () => ({
      installPath: {
        type: 'check' as const,
        label: 'Assetto Corsa',
        check: () => check(!!config?.installPath),
        okText: config?.installPath ?? 'Found',
        failText: 'No Assetto Corsa install found',
        description: config?.installDetected
          ? 'Detected automatically from your Steam libraries.'
          : undefined,
      },
      csp: {
        type: 'check' as const,
        label: 'Custom Shaders Patch',
        check: () => check(config?.cspInstalled),
        okText: 'Installed',
        failText: 'Not found — 360° capture and extended telemetry both need it',
        description:
          'Everything TyPiQL does inside the game is CSP Lua, so without it neither capture nor telemetry can run.',
      },
      telemetryApp: {
        type: 'check' as const,
        label: 'Telemetry app',
        check: () => check(config?.telemetryAppInstalled),
        okText: support?.connected ? 'Installed — frames arriving' : 'Installed',
        failText: 'Not installed in Assetto Corsa',
        description:
          'Writes a small Lua app into the game that streams time of day, sun position and car state back to TyPiQL. Reinstall after updating TyPiQL to pick up fixes.',
        // Offered even when it passes: this is also how a fix ships, since the
        // app is only rewritten when it's installed again.
        actionWhenOk: true,
        action: {
          label: config?.telemetryAppInstalled ? 'Reinstall' : 'Install',
          busyLabel: 'Installing…',
          onClick: async () => {
            await installTelemetryApp();
            await refetch();
            return config?.telemetryAppInstalled
              ? 'Reinstalled. Restart Assetto Corsa, or reload the app in-game, to run the new version.'
              : 'Installed. It starts automatically the next time you launch the game.';
          },
        },
      },
      bridge: {
        type: 'check' as const,
        label: 'simd bridge launch option',
        check: () => check(config?.bridgeConfigured),
        okText: 'Set in Steam launch options',
        failText: 'SIMD_BRIDGE_EXE is not in the launch options',
        description:
          "simd reads this from the game's own environment, so it has to be set where Steam starts the game rather than here.",
        action: {
          label: 'Copy launch options',
          busyLabel: 'Copying…',
          onClick: copyLaunchOptions,
        },
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }),
    [config, support?.connected],
  );

  return (
    <Stack tokens={{ childrenGap: '0.77em' }}>
      <span style={{ fontSize: '0.78em', opacity: 0.65 }}>
        What TyPiQL can see of your Assetto Corsa install. These are checks on the world, not settings — nothing
        here is saved, and the page re-checks itself every few seconds.
      </span>

      <Form form={schema} name="gameConfig" initialValues={{}} onChange={() => {}} />

      {config?.launchOptions && (
        <Stack tokens={{ childrenGap: 2 }}>
          <span style={{ fontSize: '0.78em', opacity: 0.65 }}>Current Steam launch options</span>
          <code
            style={{
              fontSize: '0.75em',
              padding: '0.4em 0.6em',
              background: theme.palette.neutralLighter,
              borderRadius: 3,
              wordBreak: 'break-all',
            }}
          >
            {config.launchOptions}
          </code>
        </Stack>
      )}

      {config?.telemetryAppInstalled && (
        <span style={{ fontSize: '0.75em', opacity: 0.6 }}>
          {support?.connected
            ? 'Telemetry is streaming.'
            : (support?.reason ?? 'Installed, but no frames are arriving — is the game running?')}
        </span>
      )}

      {/* Deliberately last and unstyled: removing the app is a rare, deliberate
          act, and it shouldn't sit next to the buttons people use normally. */}
      {config?.telemetryAppInstalled && (
        <span
          role="button"
          tabIndex={0}
          onClick={async () => {
            await uninstallTelemetryApp();
            await refetch();
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLElement).click();
          }}
          style={{
            fontSize: '0.72em',
            opacity: 0.5,
            cursor: 'pointer',
            textDecoration: 'underline',
            alignSelf: 'flex-start',
          }}
        >
          Remove the telemetry app from Assetto Corsa
        </span>
      )}
    </Stack>
  );
};

export default GameConfigPanel;
