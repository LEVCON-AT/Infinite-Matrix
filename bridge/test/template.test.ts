import { describe, expect, it } from 'vitest';
import { templateTools } from '../src/tools/template.js';

function get(name: string) {
  const t = templateTools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool ${name} fehlt`);
  return t;
}

describe('template tool registrierung', () => {
  it('enthält template.list + template.instantiate', () => {
    expect(templateTools.map((t) => t.name).sort()).toEqual([
      'template.instantiate',
      'template.list',
    ]);
  });
});

describe('template.list schema', () => {
  it('akzeptiert leere Args', () => {
    expect(get('template.list').schema.safeParse({}).success).toBe(true);
  });
});

describe('template.instantiate schema', () => {
  const tool = get('template.instantiate');
  it('akzeptiert alle 5 Template-IDs', () => {
    for (const id of ['projektplan', 'gtd', 'life-layout', 'decision', 'reading-list'] as const) {
      expect(tool.schema.safeParse({ templateId: id }).success, `id=${id}`).toBe(true);
    }
  });
  it('lehnt unbekannte Template-ID ab', () => {
    expect(tool.schema.safeParse({ templateId: 'bogus' }).success).toBe(false);
  });
  it('akzeptiert label + parentCellAlias', () => {
    expect(
      tool.schema.safeParse({
        templateId: 'gtd',
        label: 'Mein GTD',
        parentCellAlias: '^home',
      }).success,
    ).toBe(true);
  });
  it('lehnt ohne templateId ab', () => {
    expect(tool.schema.safeParse({}).success).toBe(false);
  });
});
