import { describe, expect, it } from 'vitest';
import { cellTools } from '../src/tools/cell.js';

const toolByName = new Map(cellTools.map((t) => [t.name, t]));

function getTool(name: string) {
  const t = toolByName.get(name);
  if (!t) throw new Error(`Tool ${name} fehlt in cellTools`);
  return t;
}

describe('cell tool registrierung', () => {
  it('enthält alle 3 Sprint-4.2-Tools', () => {
    expect(cellTools).toHaveLength(3);
    const names = cellTools.map((t) => t.name).sort();
    expect(names).toEqual(['cell.alias.set', 'cell.feature.add', 'cell.get']);
  });

  it('jedes Tool hat description, schema, jsonSchema', () => {
    for (const tool of cellTools) {
      expect(tool.description).toBeTruthy();
      expect(tool.schema).toBeTruthy();
      expect(tool.jsonSchema).toBeTruthy();
    }
  });
});

describe('cell.get schema', () => {
  const tool = getTool('cell.get');
  it('akzeptiert matrixRef + rowId + colId', () => {
    const r = tool.schema.safeParse({ matrixRef: '^woche', rowId: 'n5', colId: 'n6' });
    expect(r.success).toBe(true);
  });
  it('lehnt ohne rowId ab', () => {
    const r = tool.schema.safeParse({ matrixRef: 'x', colId: 'n6' });
    expect(r.success).toBe(false);
  });
});

describe('cell.feature.add schema', () => {
  const tool = getTool('cell.feature.add');
  it('akzeptiert alle 4 Feature-Keys', () => {
    for (const feature of ['matrix', 'board', 'info', 'checklists'] as const) {
      const r = tool.schema.safeParse({
        matrixRef: 'x',
        rowId: 'n1',
        colId: 'n2',
        feature,
      });
      expect(r.success, `feature=${feature}`).toBe(true);
    }
  });
  it('lehnt unbekanntes Feature ab', () => {
    const r = tool.schema.safeParse({
      matrixRef: 'x',
      rowId: 'n1',
      colId: 'n2',
      feature: 'bogus',
    });
    expect(r.success).toBe(false);
  });
  it('akzeptiert optionales label', () => {
    const r = tool.schema.safeParse({
      matrixRef: 'x',
      rowId: 'n1',
      colId: 'n2',
      feature: 'board',
      label: 'Mein Board',
    });
    expect(r.success).toBe(true);
  });
});

describe('cell.alias.set schema', () => {
  const tool = getTool('cell.alias.set');
  it('akzeptiert gültige Args', () => {
    const r = tool.schema.safeParse({
      matrixRef: 'x',
      rowId: 'n1',
      colId: 'n2',
      alias: 'standup',
    });
    expect(r.success).toBe(true);
  });
  it('akzeptiert leeren Alias (= löschen)', () => {
    const r = tool.schema.safeParse({ matrixRef: 'x', rowId: 'n1', colId: 'n2', alias: '' });
    expect(r.success).toBe(true);
  });
  it('lehnt fehlende alias-Property ab', () => {
    const r = tool.schema.safeParse({ matrixRef: 'x', rowId: 'n1', colId: 'n2' });
    expect(r.success).toBe(false);
  });
});

describe('jsonSchema enum-Support', () => {
  it('cell.feature.add.feature ist als enum codiert', () => {
    const js = getTool('cell.feature.add').jsonSchema as {
      properties?: Record<string, { enum?: string[]; type?: string }>;
    };
    expect(js.properties?.feature?.type).toBe('string');
    expect(js.properties?.feature?.enum).toEqual(['matrix', 'board', 'info', 'checklists']);
  });
});
