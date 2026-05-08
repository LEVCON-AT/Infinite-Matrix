import { describe, expect, it } from 'vitest';
import { aliasTools } from '../src/tools/alias.js';
import { metaTools } from '../src/tools/meta.js';
import { queryTools } from '../src/tools/query.js';
import { settingsTools } from '../src/tools/settings.js';

function get<T extends { name: string }>(tools: T[], name: string): T {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`Tool ${name} fehlt`);
  return t;
}

describe('Sprint 4.5 tool registrierung', () => {
  it('aliasTools enthält resolve + set + expand_to_text', () => {
    expect(aliasTools.map((t) => t.name).sort()).toEqual([
      'alias.expand_to_text',
      'alias.resolve',
      'alias.set',
    ]);
  });
  it('queryTools enthält cards + aliases', () => {
    expect(queryTools.map((t) => t.name).sort()).toEqual(['query.aliases', 'query.cards']);
  });
  it('settingsTools enthält get + set', () => {
    expect(settingsTools.map((t) => t.name).sort()).toEqual(['settings.get', 'settings.set']);
  });
  it('metaTools enthält undo.last + status', () => {
    expect(metaTools.map((t) => t.name).sort()).toEqual(['status', 'undo.last']);
  });
});

describe('alias.set schema', () => {
  const tool = get(aliasTools, 'alias.set');
  it('currentAlias + alias', () => {
    expect(tool.schema.safeParse({ currentAlias: '^old', alias: 'new' }).success).toBe(true);
  });
  it('nodeRef + alias', () => {
    expect(tool.schema.safeParse({ nodeRef: '^matrix1', alias: 'm1' }).success).toBe(true);
  });
  it('leerer alias akzeptiert (= delete)', () => {
    expect(tool.schema.safeParse({ currentAlias: '^old', alias: '' }).success).toBe(true);
  });
  it('ohne alias lehnt ab', () => {
    expect(tool.schema.safeParse({ currentAlias: '^old' }).success).toBe(false);
  });
});

describe('alias.expand_to_text schema', () => {
  const tool = get(aliasTools, 'alias.expand_to_text');
  it('alias allein akzeptiert (markdown default)', () => {
    const r = tool.schema.safeParse({ alias: 'vertrag' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.format).toBe('markdown');
  });
  it.each(['markdown', 'plain', 'html'] as const)('format=%s akzeptiert', (format) => {
    expect(tool.schema.safeParse({ alias: 'x', format }).success).toBe(true);
  });
  it('format=invalid lehnt ab', () => {
    expect(tool.schema.safeParse({ alias: 'x', format: 'rst' }).success).toBe(false);
  });
  it('ohne alias lehnt ab', () => {
    expect(tool.schema.safeParse({ format: 'plain' }).success).toBe(false);
  });
});

describe('query.aliases schema', () => {
  const tool = get(queryTools, 'query.aliases');
  it('leer akzeptiert', () => {
    expect(tool.schema.safeParse({}).success).toBe(true);
  });
  it('prefix akzeptiert', () => {
    expect(tool.schema.safeParse({ prefix: 'wo' }).success).toBe(true);
  });
  it('alle type-Werte akzeptiert', () => {
    for (const type of ['matrix', 'board', 'cell', 'card', 'link', 'mail'] as const) {
      expect(tool.schema.safeParse({ type }).success, `type=${type}`).toBe(true);
    }
  });
  it('limit 1..500 akzeptiert', () => {
    expect(tool.schema.safeParse({ limit: 250 }).success).toBe(true);
  });
  it('limit >500 lehnt ab', () => {
    expect(tool.schema.safeParse({ limit: 600 }).success).toBe(false);
  });
});

describe('settings schemas', () => {
  it('settings.get ohne key akzeptiert', () => {
    expect(get(settingsTools, 'settings.get').schema.safeParse({}).success).toBe(true);
  });
  it('settings.get mit key akzeptiert', () => {
    expect(
      get(settingsTools, 'settings.get').schema.safeParse({ key: 'sidebarWidth' }).success,
    ).toBe(true);
  });
  it('settings.set benötigt key + value', () => {
    expect(
      get(settingsTools, 'settings.set').schema.safeParse({
        key: 'sidebarWidth',
        value: 300,
      }).success,
    ).toBe(true);
  });
  it('settings.set ohne value lehnt ab', () => {
    expect(get(settingsTools, 'settings.set').schema.safeParse({ key: 'x' }).success).toBe(false);
  });
});

describe('meta schemas', () => {
  it('undo.last akzeptiert leere Args', () => {
    expect(get(metaTools, 'undo.last').schema.safeParse({}).success).toBe(true);
  });
  it('status akzeptiert leere Args', () => {
    expect(get(metaTools, 'status').schema.safeParse({}).success).toBe(true);
  });
});
