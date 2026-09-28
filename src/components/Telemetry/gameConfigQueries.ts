import gql from 'graphql-tag';

export interface GameConfigRecord {
  installPath?: string | null;
  installDetected: boolean;
  cspInstalled: boolean;
  telemetryAppInstalled: boolean;
  launchOptions?: string | null;
  bridgeConfigured: boolean;
  /** Only present when the bridge ISN'T configured — it's the string to
   *  paste, so there's nothing to offer once it's already set. */
  recommendedLaunchOptions?: string | null;
}

// One query for both: they're read together on every poll and describe the
// same install, so splitting them would double the round trips and let the two
// halves disagree about whether the Lua app is present.
export const GET_GAME_CONFIG = gql`
  query gameConfig {
    gameConfig {
      installPath
      installDetected
      cspInstalled
      telemetryAppInstalled
      launchOptions
      bridgeConfigured
      recommendedLaunchOptions
    }
    acTelemetrySupport {
      gameInstalled
      appInstalled
      connected
      reason
    }
  }
`;

export const INSTALL_AC_TELEMETRY_APP = gql`
  mutation installAcTelemetryApp {
    installAcTelemetryApp
  }
`;

export const UNINSTALL_AC_TELEMETRY_APP = gql`
  mutation uninstallAcTelemetryApp {
    uninstallAcTelemetryApp
  }
`;
