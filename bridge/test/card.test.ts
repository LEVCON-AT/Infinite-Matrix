import { describe, expect, it } from 'vitest';
import { cardTools } from '../src/tools/card.js';

const toolByName = new Map(cardTools.map((t) => [t.name, t]));
function getTool(name: string) {
  const t = toolByName.get(name);
  if (!t) throw new Error(`Tool ${name} fehlt in cardTools`);
  return t;
}

describe('card tool registrierung', () => {
  it('enthält alle 6 Sprint-4.3-Tools', () => {
    expect(cardTools).toHaveLength(6);
    const names = cardTools.map((t) => t.name).sort();
    expect(names).toEqual([
      'card.create',
      'card.delete',
      'card.done.toggle',
      'card.move',
      'card.recurrence.set',
      'card.update',
    ]);
  });
  it('jedes Tool hat description, schema, jsonSchema', () => {
    for (const t of cardTools) {
      expect(t.description).toBeTruthy();
      expect(t.schema).toBeTruthy();
      expect(t.jsonSchema).toBeTruthy();
    }
  });
});

describe('card.create schema', () => {
  const tool = getTool('card.create');
  it('minimal: boardRef + name', () => {
    const r = tool.schema.safeParse({ boardRef: '^todos', name: 'Erste Karte' });
    expect(r.success).toBe(true);
  });
  it('voll: mit priority, deadline, tags, who, alias', () => {
    const r = tool.schema.safeParse({
      boardRef: '^todos',
      name: 'Standup',
      priority: 2,
      deadline: '2026-04-25',
      tags: ['meeting'],
      who: ['enric'],
      alias: 'standup',
    });
    expect(r.success).toBe(true);
  });
  it('lehnt leeren Namen ab', () => {
    const r = tool.schema.safeParse({ boardRef: 'x', name: '' });
    expect(r.success).toBe(false);
  });
  it('lehnt priority>3 ab', () => {
    const r = tool.schema.safeParse({ boardRef: 'x', name: 'y', priority: 5 });
    expect(r.success).toBe(false);
  });
});

describe('card.update schema', () => {
  const tool = getTool('card.update');
  it('akzeptiert patch-only', () => {
    const r = tool.schema.safeParse({
      cardRef: '^standup',
      patch: { name: 'Neuer Titel', priority: 1 },
    });
    expect(r.success).toBe(true);
  });
  it('akzeptiert leeres patch', () => {
    const r = tool.schema.safeParse({ cardRef: '^x', patch: {} });
    expect(r.success).toBe(true);
  });
  it('lehnt ohne patch ab', () => {
    const r = tool.schema.safeParse({ cardRef: '^x' });
    expect(r.success).toBe(false);
  });
});

describe('card.move schema', () => {
  const tool = getTool('card.move');
  it('akzeptiert targetColId', () => {
    const r = tool.schema.safeParse({ cardRef: '^x', targetColId: 'n5' });
    expect(r.success).toBe(true);
  });
  it('akzeptiert targetBoardRef', () => {
    const r = tool.schema.safeParse({ cardRef: '^x', targetBoardRef: '^other' });
    expect(r.success).toBe(true);
  });
  it('akzeptiert minimal (nur cardRef — Handler-Error zur Laufzeit)', () => {
    const r = tool.schema.safeParse({ cardRef: '^x' });
    expect(r.success).toBe(true);
  });
});

describe('card.delete / card.done.toggle schema', () => {
  it('card.delete akzeptiert cardRef', () => {
    const r = getTool('card.delete').schema.safeParse({ cardRef: '^x' });
    expect(r.success).toBe(true);
  });
  it('card.delete akzeptiert boardRef+cardId', () => {
    const r = getTool('card.delete').schema.safeParse({ boardRef: '^b', cardId: 'n7' });
    expect(r.success).toBe(true);
  });
  it('card.done.toggle akzeptiert cardRef', () => {
    const r = getTool('card.done.toggle').schema.safeParse({ cardRef: '^x' });
    expect(r.success).toBe(true);
  });
});

describe('card.recurrence.set schema', () => {
  const tool = getTool('card.recurrence.set');
  it('akzeptiert alle Recur-Typen', () => {
    for (const type of ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const) {
      const r = tool.schema.safeParse({ cardRef: '^x', recur: { type } });
      expect(r.success, `type=${type}`).toBe(true);
    }
  });
  it('lehnt unbekannten Typ ab', () => {
    const r = tool.schema.safeParse({ cardRef: '^x', recur: { type: 'hourly' } });
    expect(r.success).toBe(false);
  });
  it('akzeptiert every/day/weekday', () => {
    const r = tool.schema.safeParse({
      cardRef: '^x',
      recur: { type: 'weekly', every: 2, weekday: 3 },
    });
    expect(r.success).toBe(true);
  });
  it('lehnt weekday>6 ab', () => {
    const r = tool.schema.safeParse({
      cardRef: '^x',
      recur: { type: 'weekly', weekday: 10 },
    });
    expect(r.success).toBe(false);
  });
});
