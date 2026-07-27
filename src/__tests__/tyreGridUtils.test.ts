import { describe, it, expect } from 'vitest';
import { cornersToConfig, configToCorners, type Corner } from '../components/shared/tyreGridUtils';

// ─── cornersToConfig ──────────────────────────────────────────────────────────

function cs(...corners: Corner[]) { return new Set<Corner>(corners); }

describe('cornersToConfig', () => {
  it('maps a single front-left corner to FrontLeft', () => {
    expect(cornersToConfig(cs('FL'))).toBe('FrontLeft');
  });

  it('maps FL+FR to Front', () => {
    expect(cornersToConfig(cs('FL', 'FR'))).toBe('Front');
  });

  it('maps RL+RR to Rear', () => {
    expect(cornersToConfig(cs('RL', 'RR'))).toBe('Rear');
  });

  it('maps FL+RL to Left', () => {
    expect(cornersToConfig(cs('FL', 'RL'))).toBe('Left');
  });

  it('maps FR+RR to Right', () => {
    expect(cornersToConfig(cs('FR', 'RR'))).toBe('Right');
  });

  it('maps all four corners to All', () => {
    expect(cornersToConfig(cs('FL', 'FR', 'RL', 'RR'))).toBe('All');
  });

  it('returns null for invalid combination', () => {
    expect(cornersToConfig(cs('FL', 'RR'))).toBeNull();
  });

  it('returns null for empty selection', () => {
    expect(cornersToConfig(new Set<Corner>())).toBeNull();
  });

  it('returns null for three corners', () => {
    expect(cornersToConfig(cs('FL', 'FR', 'RL'))).toBeNull();
  });
});

// ─── configToCorners ──────────────────────────────────────────────────────────

describe('configToCorners', () => {
  it('maps FrontLeft to {FL}', () => {
    expect(configToCorners('FrontLeft')).toEqual(new Set(['FL']));
  });

  it('maps Front to {FL, FR}', () => {
    expect(configToCorners('Front')).toEqual(new Set(['FL', 'FR']));
  });

  it('maps All to {FL, FR, RL, RR}', () => {
    expect(configToCorners('All')).toEqual(new Set(['FL', 'FR', 'RL', 'RR']));
  });

  it('returns empty set for null', () => {
    expect(configToCorners(null)).toEqual(new Set());
  });

  it('returns empty set for undefined', () => {
    expect(configToCorners(undefined)).toEqual(new Set());
  });

  it('returns empty set for unknown string', () => {
    expect(configToCorners('Unknown')).toEqual(new Set());
  });

  it('round-trips through cornersToConfig', () => {
    const configs = ['FrontLeft', 'FrontRight', 'RearLeft', 'RearRight', 'Front', 'Rear', 'Left', 'Right', 'All'];
    for (const cfg of configs) {
      expect(cornersToConfig(configToCorners(cfg))).toBe(cfg);
    }
  });
});
