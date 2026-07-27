export type Corner = 'FL' | 'FR' | 'RL' | 'RR';

const CONFIG_TO_CORNERS: Record<string, readonly Corner[]> = {
  FrontLeft:  ['FL'],
  FrontRight: ['FR'],
  RearLeft:   ['RL'],
  RearRight:  ['RR'],
  Front:      ['FL', 'FR'],
  Rear:       ['RL', 'RR'],
  Left:       ['FL', 'RL'],
  Right:      ['FR', 'RR'],
  All:        ['FL', 'FR', 'RL', 'RR'],
};

export function cornersToConfig(selected: Set<Corner>): string | null {
  for (const [config, corners] of Object.entries(CONFIG_TO_CORNERS)) {
    if (corners.length === selected.size && corners.every(c => selected.has(c))) {
      return config;
    }
  }
  return null;
}

export function configToCorners(config: string | null | undefined): Set<Corner> {
  const corners = config ? CONFIG_TO_CORNERS[config] : null;
  return new Set((corners ?? []) as Corner[]);
}
