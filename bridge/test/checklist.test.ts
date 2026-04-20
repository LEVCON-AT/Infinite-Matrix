import { describe, expect, it } from 'vitest';
import { checklistTools } from '../src/tools/checklist.js';

const toolByName = new Map(checklistTools.map((t) => [t.name, t]));
function getTool(name: string) {
  const t = toolByName.get(name);
  if (!t) throw new Error(`Tool ${name} fehlt in checklistTools`);
  return t;
}

describe('checklist tool registrierung', () => {
  it('enthält 7 Tools (Sprint 4.4b + V2.1 set_level + V2.2 paste/clone/move)', () => {
    expect(checklistTools).toHaveLength(7);
    const names = checklistTools.map((t) => t.name).sort();
    expect(names).toEqual([
      'checklist.add',
      'checklist.clone',
      'checklist.item.add',
      'checklist.item.move',
      'checklist.item.set_level',
      'checklist.item.toggle',
      'checklist.paste',
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

describe('checklist.paste schema (V2.2)', () => {
  const t = getTool('checklist.paste');
  it('akzeptiert Mindest-Args', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'a\nb' }).success,
    ).toBe(true);
  });
  it('akzeptiert afterItemId + baseLevel', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'x', afterItemId: 'n8', baseLevel: 2 }).success,
    ).toBe(true);
  });
  it('lehnt leeren Text ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: '' }).success,
    ).toBe(false);
  });
  it('lehnt baseLevel 3 ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'x', baseLevel: 3 }).success,
    ).toBe(false);
  });
  it('lehnt baseLevel als float ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', checklistId: 'n7', text: 'x', baseLevel: 1.5 }).success,
    ).toBe(false);
  });
});

describe('checklist.clone schema (V2.2)', () => {
  const t = getTool('checklist.clone');
  it('akzeptiert nur sourceRef', () => {
    expect(t.schema.safeParse({ sourceRef: '^src' }).success).toBe(true);
  });
  it('akzeptiert sourceRef + targetRef', () => {
    expect(t.schema.safeParse({ sourceRef: '^src', targetRef: '^tgt' }).success).toBe(true);
  });
  it('lehnt ohne sourceRef ab', () => {
    expect(t.schema.safeParse({ targetRef: '^tgt' }).success).toBe(false);
  });
});

describe('checklist.item.move schema (V2.2)', () => {
  const t = getTool('checklist.item.move');
  it('akzeptiert alle Pflichtfelder', () => {
    expect(
      t.schema.safeParse({
        boardRef: '^b',
        fromChecklistId: 'cA',
        toChecklistId: 'cB',
        itemId: 'i1',
      }).success,
    ).toBe(true);
  });
  it('akzeptiert optionales afterItemId', () => {
    expect(
      t.schema.safeParse({
        boardRef: '^b',
        fromChecklistId: 'cA',
        toChecklistId: 'cB',
        itemId: 'i1',
        afterItemId: 'i9',
      }).success,
    ).toBe(true);
  });
  it('lehnt ohne toChecklistId ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', fromChecklistId: 'cA', itemId: 'i1' }).success,
    ).toBe(false);
  });
  it('lehnt ohne itemId ab', () => {
    expect(
      t.schema.safeParse({ boardRef: '^b', fromChecklistId: 'cA', toChecklistId: 'cB' }).success,
    ).toBe(false);
  });
});
