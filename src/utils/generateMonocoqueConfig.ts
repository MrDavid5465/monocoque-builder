import { ChannelConfig, ChannelEffect } from "../types/";

const WHEEL_TO_TYRE: Record<keyof ChannelConfig["wheels"], string> = {
  fl: "FL",
  fr: "FR",
  rl: "RL",
  rr: "RR",
};

export function generateMonocoqueConfig(channels: ChannelConfig[]): string {
  let blocks = "";

  for (const channel of channels) {
    // Expand wheels
    const selectedWheels = Object.entries(channel.wheels)
      .filter(([_, enabled]) => enabled)
      .map(([key]) => WHEEL_TO_TYRE[key as keyof ChannelConfig["wheels"]]);

    // Expand effects
    const selectedEffects = Object.entries(channel.effects)
      .filter(([_, eff]) => eff !== null)
      .map(([_, eff]) => eff as ChannelEffect);

    // Generate Monocoque blocks
    for (const wheel of selectedWheels) {
      for (const eff of selectedEffects) {
        if (eff.effect.toLowerCase() === "tyreslip" 
          || eff.effect.toLowerCase() === "tyrelock"
          || eff.effect.toLowerCase() === "abs"
          || eff.effect.toLowerCase() === "suspension"){ 
          blocks += `
          {
              device       = "Sound";
              effect       = "${eff.effect}";
              tyre         = "${wheel}";
              devid        = "${eff.devid} ?? "";
              channels     = ${channels.length};
              pan          = ${channel.pan};
              volume       = ${eff.volume ?? 100};
              modulation   = ${eff.modulation ?? "frequency"};
              frequency    = ${eff.frequency};
              frequencyMax = ${eff.frequencyMax};
              amplitude    = ${eff.amplitude};
              amplitudeMax = ${eff.amplitudeMax};
          },
          `;
        }
        else {
          blocks += `
          {
              device       = "Sound";
              effect       = "${eff.effect}";
              devid        = "${eff.devid} ?? "";
              channels     = ${channels.length};
              pan          = ${channel.pan};
              volume       = ${eff.volume ?? 100};
              modulation   = ${eff.modulation ?? "frequency"};
              frequency    = ${eff.frequency};
              frequencyMax = ${eff.frequencyMax};
              amplitude    = ${eff.amplitude};
              amplitudeMax = ${eff.amplitudeMax};
          },
          `;
        }
      }
    }
  }

  // Wrap in configs = (...)
  return `
configs = (
    {
        sim = "default";
        car = "default";
        devices = (
${blocks}
        );
    }
);
`;
}
