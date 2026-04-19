import { describe, expect, it } from 'vitest';
import { matrixCrudTools } from '../src/tools/matrix-crud.js';

const toolByName = new Map(matrixCrudTools.map((t) => [t.name, t]));

function getTool(name: string) {
  const t = toolByName.get(name);
  if (!t) throw new Error(`Tool ${name} fehlt in matrixCrudTools`);
  return t;
}

describe('matrix-crud tool registrierung', () => {
  it('enthält alle 7 Sprint-4.1-Tools', () => {
    expect(matrixCrudTools).toHaveLength(7);
    const names = matrixCrudTools.map((t) => t.name).sort();
    expect(names).toEqual([
      'col.add',
      'col.delete',
      'matrix.delete',
      'matrix.edit_mode.set',
      'matrix.rename',
      'row.add',
      'row.delete',
    ]);
  });

  it('jedes Tool hat description, schema, jsonSchema', () => {
    for (const tool of matrixCrudTools) {
      expect(tool.description).toBeTruthy();
      expect(tool.schema).toBeTruthy();
      expect(tool.jsonSchema).toBeTruthy();
      expect((tool.jsonSchema as { type?: string }).type).toBe('object');
    }
  });
});

describe('matrix.rename schema', () => {
  const tool = getTool('matrix.rename');
  it('akzeptiert gültige Args', () => {
    const r = tool.schema.safeParse({ ref: '^projekt', label: 'Projekt 2026' });
    expect(r.success).toBe(true);
  });
  it('lehnt leeres label ab', () => {
    const r = tool.schema.safeParse({ ref: 'n5', label: '' });
    expect(r.success).toBe(false);
  });
  it('lehnt fehlende ref ab', () => {
    const r = tool.schema.safeParse({ label: 'Neu' });
    expect(r.success).toBe(false);
  });
});

describe('matrix.delete schema', () => {
  const tool = getTool('matrix.delete');
  it('akzeptiert ref', () => {
    const r = tool.schema.safeParse({ ref: '^garage' });
    expect(r.success).toBe(true);
  });
  it('lehnt ohne ref ab', () => {
    const r = tool.schema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe('row.add / col.add schema', () => {
  it('row.add akzeptiert matrixRef + label', () => {
    const r = getTool('row.add').schema.safeParse({
      matrixRef: '^wochenplan',
      label: 'Freitag',
    });
    expect(r.success).toBe(true);
  });
  it('col.add akzeptiert matrixRef + label', () => {
    const r = getTool('col.add').schema.safeParse({
      matrixRef: '^wochenplan',
      label: 'Notizen',
    });
    expect(r.success).toBe(true);
  });
  it('row.add lehnt fehlende Felder ab', () => {
    const r = getTool('row.add').schema.safeParse({ matrixRef: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('row.delete / col.delete schema', () => {
  it('row.delete akzeptiert matrixRef + rowId', () => {
    const r = getTool('row.delete').schema.safeParse({
      matrixRef: '^wochenplan',
      rowId: 'n17',
    });
    expect(r.success).toBe(true);
  });
  it('col.delete akzeptiert matrixRef + colId', () => {
    const r = getTool('col.delete').schema.safeParse({
      matrixRef: '^wochenplan',
      colId: 'n18',
    });
    expect(r.success).toBe(true);
  });
  it('row.delete lehnt ohne rowId ab', () => {
    const r = getTool('row.delete').schema.safeParse({ matrixRef: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('matrix.edit_mode.set schema', () => {
  const tool = getTool('matrix.edit_mode.set');
  it('akzeptiert on:true', () => {
    const r = tool.schema.safeParse({ on: true });
    expect(r.success).toBe(true);
  });
  it('akzeptiert on:false', () => {
    const r = tool.schema.safeParse({ on: false });
    expect(r.success).toBe(true);
  });
  it('lehnt on als String ab', () => {
    const r = tool.schema.safeParse({ on: 'yes' });
    expect(r.success).toBe(false);
  });
});

describe('jsonSchema-Ableitung', () => {
  it('matrix.rename hat required ref + label', () => {
    const js = getTool('matrix.rename').jsonSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(js.required).toContain('ref');
    expect(js.required).toContain('label');
    expect(js.properties).toHaveProperty('ref');
    expect(js.properties).toHaveProperty('label');
  });
  it('matrix.edit_mode.set hat boolean-Typ', () => {
    const js = getTool('matrix.edit_mode.set').jsonSchema as {
      properties?: Record<string, { type?: string }>;
    };
    expect(js.properties?.on?.type).toBe('boolean');
  });
});
