import { describe, it, expect } from 'vitest';
import { getSchema, ALL_SCHEMAS, SPRITE_TYPES, FREEFORM_TYPES } from '../components/Telemetry/DashboardDesigner/components/registry';
import { ComponentType } from '../types/dashboard';

const ALL_TYPES: ComponentType[] = [
  'static-sprite', 'needle-gauge', 'bar-gauge', 'sprite-bar-gauge',
  'text-gauge', 'sprite-text-gauge', 'graph-bar-gauge', 'group',
  'flag-display', 'flag-display-sprite',
  'button-control', 'slider-control', 'encoder-control',
  'transform-sprite', 'sprite-arc-fill', 'clock-text', 'clock-sprite',
];

const GAUGE_TYPES: ComponentType[] = [
  'static-sprite', 'needle-gauge', 'bar-gauge', 'sprite-bar-gauge',
  'text-gauge', 'sprite-text-gauge', 'graph-bar-gauge', 'group',
  'transform-sprite', 'sprite-arc-fill', 'clock-text', 'clock-sprite',
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
  it('contains exactly 20 schemas', () => {
    expect(ALL_SCHEMAS).toHaveLength(20);
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

  it('sprite-text-gauge and clock-sprite use charWidth/charHeight instead of width/height', () => {
    for (const type of ['sprite-text-gauge', 'clock-sprite'] as const) {
      const schema = getSchema(type);
      expect(schema.fields.charWidth, `${type} missing charWidth`).toBeDefined();
      expect(schema.fields.charHeight, `${type} missing charHeight`).toBeDefined();
      expect(schema.fields.width, `${type} should not have width`).toBeUndefined();
    }
  });

  // Per-character sprite-sheet types (sprite-text-gauge, clock-sprite) size
  // themselves from charWidth/charHeight * character count instead of a
  // fixed width/height — same class of exception, not a fixed-size sprite.
  const CHAR_SHEET_TYPES: ComponentType[] = ['sprite-text-gauge', 'clock-sprite'];

  it('non-char-sheet schemas that are sprite-based have width/height', () => {
    const spriteSchemas = ALL_SCHEMAS.filter(
      s => SPRITE_TYPES.has(s.type) && !CHAR_SHEET_TYPES.includes(s.type)
    );
    for (const schema of spriteSchemas) {
      expect(schema.fields.width, `${schema.type} missing width`).toBeDefined();
      expect(schema.fields.height, `${schema.type} missing height`).toBeDefined();
    }
  });

  it('clock-text and clock-sprite are not bindable and have clock fields', () => {
    for (const type of ['clock-text', 'clock-sprite'] as const) {
      const schema = getSchema(type);
      expect(schema.bindable, `${type} should not be bindable`).toBeFalsy();
      expect(schema.fields.clockSource, `${type} missing clockSource`).toBeDefined();
      expect(schema.fields.clockFormat, `${type} missing clockFormat`).toBeDefined();
      expect(schema.fields.showSeconds, `${type} missing showSeconds`).toBeDefined();
    }
  });

  it('needle-gauge is bindable and has rotation-pivot fields', () => {
    const schema = getSchema('needle-gauge');
    expect(schema.bindable).toBe(true);
    expect(schema.fields.rotationX).toBeDefined();
    expect(schema.fields.rotationY).toBeDefined();
  });

  it('group schema allows children', () => {
    expect(getSchema('group').allowChildren).toBe(true);
  });

  it('types that allow children are group, static-sprite, needle-gauge, bar-gauge, gif-gauge, arc-gauge-face, sprite-arc-gauge-face, and transform-sprite', () => {
    const allowingChildren = ALL_SCHEMAS.filter(s => s.allowChildren).map(s => s.type).sort();
    expect(allowingChildren).toEqual(
      ['arc-gauge-face', 'bar-gauge', 'gif-gauge', 'group', 'needle-gauge', 'sprite-arc-gauge-face', 'static-sprite', 'transform-sprite'].sort()
    );
  });

  it('transform-sprite has move fields and is bindable', () => {
    const schema = getSchema('transform-sprite');
    expect(schema.bindable).toBe(true);
    expect(schema.fields.moveAxis).toBeDefined();
    expect(schema.fields.moveMin).toBeDefined();
    expect(schema.fields.moveMax).toBeDefined();
  });

  it('sprite-arc-fill has arc fields and is bindable', () => {
    const schema = getSchema('sprite-arc-fill');
    expect(schema.bindable).toBe(true);
    expect(schema.fields.arcCenterX).toBeDefined();
    expect(schema.fields.arcCenterY).toBeDefined();
    expect(schema.fields.arcStartAngle).toBeDefined();
    expect(schema.fields.arcSweepAngle).toBeDefined();
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
    const expected: ComponentType[] = ['static-sprite', 'needle-gauge', 'bar-gauge', 'sprite-bar-gauge', 'sprite-text-gauge', 'transform-sprite', 'sprite-arc-fill', 'clock-sprite'];
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
    const expected: ComponentType[] = ['text-gauge', 'graph-bar-gauge', 'group', 'clock-text'];
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
