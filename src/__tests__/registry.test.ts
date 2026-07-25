import { describe, it, expect } from 'vitest';
import { getSchema, ALL_SCHEMAS, SPRITE_TYPES, FREEFORM_TYPES } from '../components/Telemetry/DashboardDesigner/components/registry';
import { ComponentType } from '../types/dashboard';

const ALL_TYPES: ComponentType[] = [
  'static-sprite', 'needle-gauge', 'bar-gauge', 'sprite-bar-gauge',
  'text-gauge', 'sprite-text-gauge', 'graph-bar-gauge', 'group',
  'flag-display', 'flag-display-sprite',
  'button-control', 'slider-control', 'encoder-control',
];

const GAUGE_TYPES: ComponentType[] = [
  'static-sprite', 'needle-gauge', 'bar-gauge', 'sprite-bar-gauge',
  'text-gauge', 'sprite-text-gauge', 'graph-bar-gauge', 'group',
];

// ─── getSchema ────────────────────────────────────────────────────────────────

describe('getSchema', () => {
  it('returns a schema for every registered type', () => {
    for (const type of ALL_TYPES) {
      expect(getSchema(type), `expected schema for ${type}`).toBeDefined();
    }
  });

  it('returned schema type matches the requested type', () => {
    for (const type of ALL_TYPES) {
      expect(getSchema(type).type).toBe(type);
    }
  });
});

// ─── ALL_SCHEMAS ──────────────────────────────────────────────────────────────

describe('ALL_SCHEMAS', () => {
  it('contains exactly 16 schemas', () => {
    expect(ALL_SCHEMAS).toHaveLength(16);
  });

  it('every schema has required shape', () => {
    for (const schema of ALL_SCHEMAS) {
      expect(schema.type).toBeTruthy();
      expect(schema.label).toBeTruthy();
      expect(schema.icon).toBeTruthy();
      expect(typeof schema.allowChildren).toBe('boolean');
      expect(typeof schema.fields).toBe('object');
      expect(Array.isArray(schema.fields)).toBe(false);
    }
  });

  it('every schema has a name field', () => {
    for (const schema of ALL_SCHEMAS) {
      const nameField = schema.fields.name;
      expect(nameField, `${schema.type} missing name field`).toBeDefined();
      expect(nameField!.type).toBe('text');
    }
  });

  it('every gauge schema has counter-rotate fields', () => {
    const gaugeSchemas = ALL_SCHEMAS.filter(s => GAUGE_TYPES.includes(s.type));
    for (const schema of gaugeSchemas) {
      expect(schema.fields.counterRotate, `${schema.type} missing counterRotate`).toBeDefined();
      expect(schema.fields.steerMaxDeg, `${schema.type} missing steerMaxDeg`).toBeDefined();
    }
  });

  it('counterRotate field is a checkbox', () => {
    const gaugeSchemas = ALL_SCHEMAS.filter(s => GAUGE_TYPES.includes(s.type));
    for (const schema of gaugeSchemas) {
      expect(schema.fields.counterRotate.type).toBe('checkbox');
    }
  });

  it('steerMaxDeg field is a slider with reasonable bounds', () => {
    const gaugeSchemas = ALL_SCHEMAS.filter(s => GAUGE_TYPES.includes(s.type));
    for (const schema of gaugeSchemas) {
      const f = schema.fields.steerMaxDeg;
      expect(f.type).toBe('slider');
      expect(f.min).toBeGreaterThanOrEqual(0);
      expect(f.max).toBeGreaterThanOrEqual(360);
    }
  });

  it('sprite-based schemas have a file field', () => {
    const spriteSchemas = ALL_SCHEMAS.filter(s => SPRITE_TYPES.has(s.type));
    for (const schema of spriteSchemas) {
      expect(schema.fields.file, `${schema.type} missing file`).toBeDefined();
    }
  });

  it('sprite-text-gauge uses charWidth/charHeight instead of width/height', () => {
    const schema = getSchema('sprite-text-gauge');
    expect(schema.fields.charWidth).toBeDefined();
    expect(schema.fields.charHeight).toBeDefined();
    expect(schema.fields.width).toBeUndefined();
  });

  it('non-sprite-text schemas that are sprite-based have width/height', () => {
    const spriteSchemas = ALL_SCHEMAS.filter(
      s => SPRITE_TYPES.has(s.type) && s.type !== 'sprite-text-gauge'
    );
    for (const schema of spriteSchemas) {
      expect(schema.fields.width, `${schema.type} missing width`).toBeDefined();
      expect(schema.fields.height, `${schema.type} missing height`).toBeDefined();
    }
  });

  it('needle-gauge has binding and rotation-pivot fields', () => {
    const schema = getSchema('needle-gauge');
    expect(schema.fields.binding).toBeDefined();
    expect(schema.fields.binding.type).toBe('telemetry-binding');
    expect(schema.fields.rotationX).toBeDefined();
    expect(schema.fields.rotationY).toBeDefined();
  });

  it('group schema allows children', () => {
    expect(getSchema('group').allowChildren).toBe(true);
  });

  it('types that allow children are group, static-sprite, needle-gauge, bar-gauge, gif-gauge, arc-gauge-face, and sprite-arc-gauge-face', () => {
    const allowingChildren = ALL_SCHEMAS.filter(s => s.allowChildren).map(s => s.type).sort();
    expect(allowingChildren).toEqual(
      ['arc-gauge-face', 'bar-gauge', 'gif-gauge', 'group', 'needle-gauge', 'sprite-arc-gauge-face', 'static-sprite'].sort()
    );
  });

  it('freeform leaf types do not allow children', () => {
    const leafFreeform: ComponentType[] = ['text-gauge', 'graph-bar-gauge', 'sprite-bar-gauge', 'sprite-text-gauge'];
    for (const type of leafFreeform) {
      expect(getSchema(type).allowChildren, `${type} should not allow children`).toBe(false);
    }
  });
});

// ─── SPRITE_TYPES / FREEFORM_TYPES ───────────────────────────────────────────

describe('SPRITE_TYPES', () => {
  it('contains sprite-based types', () => {
    const expected: ComponentType[] = ['static-sprite', 'needle-gauge', 'bar-gauge', 'sprite-bar-gauge', 'sprite-text-gauge'];
    for (const t of expected) expect(SPRITE_TYPES.has(t), `expected ${t} in SPRITE_TYPES`).toBe(true);
  });

  it('does not contain freeform types', () => {
    expect(SPRITE_TYPES.has('text-gauge')).toBe(false);
    expect(SPRITE_TYPES.has('graph-bar-gauge')).toBe(false);
    expect(SPRITE_TYPES.has('group')).toBe(false);
  });
});

describe('FREEFORM_TYPES', () => {
  it('contains freeform types', () => {
    const expected: ComponentType[] = ['text-gauge', 'graph-bar-gauge', 'group'];
    for (const t of expected) expect(FREEFORM_TYPES.has(t), `expected ${t} in FREEFORM_TYPES`).toBe(true);
  });

  it('does not contain sprite types', () => {
    expect(FREEFORM_TYPES.has('static-sprite')).toBe(false);
    expect(FREEFORM_TYPES.has('needle-gauge')).toBe(false);
  });
});

describe('SPRITE_TYPES and FREEFORM_TYPES are disjoint', () => {
  it('no type appears in both sets', () => {
    for (const t of ALL_TYPES) {
      expect(SPRITE_TYPES.has(t) && FREEFORM_TYPES.has(t),
        `${t} should not be in both SPRITE_TYPES and FREEFORM_TYPES`).toBe(false);
    }
  });

  it('every type is in exactly one set', () => {
    for (const t of ALL_TYPES) {
      expect(SPRITE_TYPES.has(t) || FREEFORM_TYPES.has(t),
        `${t} should be in SPRITE_TYPES or FREEFORM_TYPES`).toBe(true);
    }
  });
});
