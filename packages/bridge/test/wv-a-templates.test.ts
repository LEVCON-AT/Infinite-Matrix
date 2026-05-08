// Welle WV.A.8b — Vitest fuer die 4 neuen Tool-Familien.
//
// Smoke-Tests fuer Schema-Validation pro Tool. Tool-Trio-Pflicht
// (Bridge-Schema + Client-Handler + Vitest) — Client-Handler kommt
// in Welle B/C wenn die UI-Wiring konkret wird.

import { describe, expect, it } from 'vitest';
import { cellTemplateTools } from '../src/tools/cell-templates.js';
import { featureTemplateTools } from '../src/tools/feature-templates.js';
import { hotkeySlotTools } from '../src/tools/hotkey-slots.js';
import { savedFilterTools } from '../src/tools/saved-filters.js';

function get<T extends { name: string; schema: { safeParse: (raw: unknown) => unknown } }>(
  list: readonly T[],
  name: string,
): T {
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`Tool ${name} fehlt`);
  return t;
}

describe('feature_template Tools', () => {
  it('exportiert genau 3 Tools', () => {
    expect(featureTemplateTools.map((t) => t.name).sort()).toEqual([
      'feature_template.create',
      'feature_template.delete',
      'feature_template.list',
    ]);
  });

  it('feature_template.list akzeptiert leere Args', () => {
    expect(get(featureTemplateTools, 'feature_template.list').schema.safeParse({})).toMatchObject({
      success: true,
    });
  });

  it('feature_template.create lehnt fehlenden name ab', () => {
    expect(
      (
        get(featureTemplateTools, 'feature_template.create').schema.safeParse({
          visibility: 'workspace',
        }) as { success: boolean }
      ).success,
    ).toBe(false);
  });

  it('feature_template.create akzeptiert minimalen Pfad', () => {
    expect(
      (
        get(featureTemplateTools, 'feature_template.create').schema.safeParse({
          name: 'My Template',
        }) as { success: boolean }
      ).success,
    ).toBe(true);
  });

  it('feature_template.create lehnt Plattform-Visibility ab', () => {
    expect(
      (
        get(featureTemplateTools, 'feature_template.create').schema.safeParse({
          name: 'X',
          visibility: 'platform',
        }) as { success: boolean }
      ).success,
    ).toBe(false);
  });

  it('feature_template.create lehnt hotkeySlot=10 ab', () => {
    expect(
      (
        get(featureTemplateTools, 'feature_template.create').schema.safeParse({
          name: 'X',
          hotkeySlot: 10,
        }) as { success: boolean }
      ).success,
    ).toBe(false);
  });
});

describe('cell_template Tools', () => {
  it('exportiert 5 Tools', () => {
    expect(cellTemplateTools.map((t) => t.name).sort()).toEqual([
      'cell_template.apply',
      'cell_template.list',
      'cell_template.override.reset',
      'cell_template.override.set',
      'cell_template.remove',
    ]);
  });

  it('cell_template.apply Pflichtfelder', () => {
    const tool = get(cellTemplateTools, 'cell_template.apply');
    expect((tool.schema.safeParse({}) as { success: boolean }).success).toBe(false);
    expect(
      (tool.schema.safeParse({ cellRef: '^c', templateId: 't' }) as { success: boolean }).success,
    ).toBe(true);
  });

  it('cell_template.override.set verlangt overrideData', () => {
    const tool = get(cellTemplateTools, 'cell_template.override.set');
    expect(
      (
        tool.schema.safeParse({
          instanceId: 'i',
          widgetId: 'w',
          overrideData: { data: { foo: 'bar' } },
        }) as { success: boolean }
      ).success,
    ).toBe(true);
  });
});

describe('hotkey_slot Tools', () => {
  it('exportiert 4 Tools', () => {
    expect(hotkeySlotTools.map((t) => t.name).sort()).toEqual([
      'hotkey_slot.clear',
      'hotkey_slot.list',
      'hotkey_slot.set.user',
      'hotkey_slot.set.workspace',
    ]);
  });

  it('hotkey_slot.set.workspace lehnt slot=0 + slot=10 ab', () => {
    const tool = get(hotkeySlotTools, 'hotkey_slot.set.workspace');
    for (const bad of [0, 10, -1, 1.5]) {
      expect(
        (tool.schema.safeParse({ slot: bad, templateId: 't' }) as { success: boolean }).success,
        `slot=${bad}`,
      ).toBe(false);
    }
    expect(
      (tool.schema.safeParse({ slot: 5, templateId: 't' }) as { success: boolean }).success,
    ).toBe(true);
  });

  it('hotkey_slot.list scope-Default = both', () => {
    const tool = get(hotkeySlotTools, 'hotkey_slot.list');
    const parsed = tool.schema.safeParse({}) as { success: boolean; data: unknown };
    expect(parsed.success).toBe(true);
    expect((parsed.data as { scope: string }).scope).toBe('both');
  });
});

describe('saved_filter Tools', () => {
  it('exportiert 3 Tools', () => {
    expect(savedFilterTools.map((t) => t.name).sort()).toEqual([
      'saved_filter.create',
      'saved_filter.delete',
      'saved_filter.list',
    ]);
  });

  it('saved_filter.create Pflichtfelder + body-Schema', () => {
    const tool = get(savedFilterTools, 'saved_filter.create');
    expect(
      (
        tool.schema.safeParse({
          name: 'F',
          body: {
            v: 1,
            atomKind: 'task',
            logic: 'and',
            conditions: [{ field: 'deadline', operator: 'before', value: '2026-12-31' }],
          },
        }) as { success: boolean }
      ).success,
    ).toBe(true);
  });

  it('saved_filter.create lehnt body.v=2 ab (Schema-Drift-Schutz)', () => {
    const tool = get(savedFilterTools, 'saved_filter.create');
    expect(
      (
        tool.schema.safeParse({
          name: 'F',
          body: { v: 2, atomKind: 'task', logic: 'and', conditions: [] },
        }) as { success: boolean }
      ).success,
    ).toBe(false);
  });

  it('saved_filter.create lehnt unbekannten atomKind ab', () => {
    const tool = get(savedFilterTools, 'saved_filter.create');
    expect(
      (
        tool.schema.safeParse({
          name: 'F',
          body: { v: 1, atomKind: 'cell', logic: 'and', conditions: [] },
        }) as { success: boolean }
      ).success,
    ).toBe(false);
  });
});
