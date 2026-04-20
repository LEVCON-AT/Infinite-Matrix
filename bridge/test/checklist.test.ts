import { describe, expect, it } from 'vitest';
import { checklistTools } from '../src/tools/checklist.js';

const toolByName = new Map(checklistTools.map((t) => [t.name, t]));
function getTool(name: string) {
  const t = toolByName.get(name);
  if (!t) throw new Error(`Tool ${name} fehlt in checklistTools`);
  return t;
}

describe('checklist tool registrierung', () => {
  it('enthält 4 Tools (Sprint 4.4b + V2.1 set_level)', () => {
    expect(checklistTools).toHaveLength(4);
    const names = checklistTools.map((t) => t.name).sort();
    expect(names).toEqual([
      'checklist.add',
      'checklist.item.add',
      'checklist.item.set_level',
      'checklist.item.toggle',
    ]);
  });
});

describe('checklist.add schema', () => {
  const t = getTool('checklist.add');
  it('akzeptiert boardRef + label', () => {
    expect(t.schema.safeParse({ boardRef: '^b', label: 'Onboarding' }).success).toBe(true);
  });
  it('lehnt leeres Label ab', () => {
    expect(t.schema.safeParse({ boardRef: '^b', label: '' }).success).toBe(false);
  });
});

describe('checklist.item.add schema', () => {
  const t = getTool('checklist.item.add');
  it('akzeptiert gültige Args', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'Schritt 1' }).success,
    ).toBe(true);
  });
  it('lehnt leeren Text ab', () => {
    expect(t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: '' }).success).toBe(false);
  });
  it('lehnt ohne checklistId ab', () => {
    expect(t.schema.safeParse({ boardRef: '^b', text: 'x' }).success).toBe(false);
  });
  it('akzeptiert optionales afterItemId', () => {
    const parsed = t.schema.safeParse({
      boardRef: '^b',
      checklistId: 'n7',
      text: 'Schritt 2',
      afterItemId: 'n8',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.afterItemId).toBe('n8');
  });
  it('akzeptiert Args ohne afterItemId (default ans Ende)', () => {
    const parsed = t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'x' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.afterItemId).toBeUndefined();
  });
  it('lehnt afterItemId als number ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'x', afterItemId: 5 }).success,
    ).toBe(false);
  });
  it('akzeptiert optionales level 0-2', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'x', level: 2 }).success,
    ).toBe(true);
  });
  it('lehnt level 3 ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'x', level: 3 }).success,
    ).toBe(false);
  });
  it('lehnt negatives level ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'x', level: -1 }).success,
    ).toBe(false);
  });
});

describe('checklist.item.set_level schema', () => {
  const t = getTool('checklist.item.set_level');
  it('akzeptiert gültige Args (level 0..2)', () => {
    for (const lvl of [0, 1, 2]) {
      expect(
        t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', itemId: 'n8', level: lvl }).success,
      ).toBe(true);
    }
  });
  it('lehnt level 3 ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', itemId: 'n8', level: 3 }).success,
    ).toBe(false);
  });
  it('lehnt level als float ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', itemId: 'n8', level: 1.5 }).success,
    ).toBe(false);
  });
  it('lehnt fehlendes level ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', itemId: 'n8' }).success,
    ).toBe(false);
  });
});

describe('checklist.item.toggle schema', () => {
  const t = getTool('checklist.item.toggle');
  it('akzeptiert alle 3 Felder', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', itemId: 'n8' }).success,
    ).toBe(true);
  });
  it('lehnt ohne itemId ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7' }).success,
    ).toBe(false);
  });
});
