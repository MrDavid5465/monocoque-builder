import { ChannelConfig, ShakerEffect, ChannelEffect } from "../types/";


function tyreToWheelFlags(tyre: string | null | undefined) {
  let selection = {
    fl: tyre === "FrontLeft",
    fr: tyre === "FrontRight",
    rl: tyre === "RearLeft",
    rr: tyre === "RearRight",
  };
  switch (tyre) {
    case "All":
      selection = {
        fl: true,
        fr: true,
        rl: true,
        rr: true,
      };
      break;
    case "Front":
      selection = {
        fl: true,
        fr: true,
        rl: false,
        rr: false,
      };
      break;
    case "Rear":
      selection = {
        fl: false,
        fr: false,
        rl: true,
        rr: true,
      };
      break;
    case "Left":
      selection = {
        fl: true,
        fr: true,
        rl: false,
        rr: false,
      };
      break;
    case "Right":
      selection = {
        fl: false,
        fr: true,
        rl: false,
        rr: true,
      };
      break;
    case "":
    case null:
    case undefined:
      selection = {
        fl: true,
        fr: true,
        rl: true,
        rr: true,
      };
      break;
  }
  return selection;
}

export function convertEffectsToChannels(
  effects: ShakerEffect[],
): ChannelConfig[] {
  const byPan: Record<number, ShakerEffect[]> = {};

  for (const eff of effects) {
    if (!byPan[eff.pan]) byPan[eff.pan] = [];
    byPan[eff.pan].push(eff);
  }

  const channels: ChannelConfig[] = [];

  for (const panStr of Object.keys(byPan)) {
    const pan = Number(panStr);
    const list: ShakerEffect[] = byPan[pan];

    const wheels = { fl: false, fr: false, rl: false, rr: false };
    const effectsState: ChannelConfig["effects"] = {
      gear: null,
      engine: null,
      tyreslip: null,
      tyrelock: null,
      abs: null,
      suspension: null,
    };
    const devid = list[0]?.devid ?? JSON.stringify(byPan); 
    for (const eff of list) {
      // accumulate wheel flags
      if (eff.effect.toLowerCase() === "tyreslip" 
      || eff.effect.toLowerCase() === "tyrelock"
      || eff.effect.toLowerCase() === "abs"
      || eff.effect.toLowerCase() === "suspension") {
        const flags = tyreToWheelFlags(eff.tyre);
        wheels.fl = wheels.fl || flags.fl;
        wheels.fr = wheels.fr || flags.fr;
        wheels.rl = wheels.rl || flags.rl;
        wheels.rr = wheels.rr || flags.rr;
      }

      // map effect name to UI key
      const key = eff.effect.toLowerCase() as keyof ChannelConfig["effects"];
      if (key in effectsState) {
        effectsState[key] = { ...eff } as ChannelEffect;
      }
    }

    channels.push({
      id: crypto.randomUUID(),
      name: `Shaker ${pan + 1}`,
      wheels,
      effects: effectsState,
      // dsp: { lpf: 100, volume: 100 },
      pan,
      devid,
    });
    
  }
  return channels;
}
