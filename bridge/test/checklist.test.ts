import { describe, expect, it } from 'vitest';
import { checklistTools } from '../src/tools/checklist.js';

const toolByName = new Map(checklistTools.map((t) => [t.name, t]));
function getTool(name: string) {
  const t = toolByName.get(name);
  if (!t) throw new Error(`Tool ${name} fehlt in checklistTools`);
  return t;
}

describe('checklist tool registrierung', () => {
  it('enthält alle 3 Sprint-4.4b-Tools', () => {
    expect(checklistTools).toHaveLength(3);
    const names = checklistTools.map((t) => t.name).sort();
    expect(names).toEqual(['checklist.add', 'checklist.item.add', 'checklist.item.toggle']);
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
