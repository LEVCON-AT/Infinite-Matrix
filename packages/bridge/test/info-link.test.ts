import { describe, expect, it } from 'vitest';
import { infoLinkTools } from '../src/tools/info-link.js';

const toolByName = new Map(infoLinkTools.map((t) => [t.name, t]));
function getTool(name: string) {
  const t = toolByName.get(name);
  if (!t) throw new Error(`Tool ${name} fehlt in infoLinkTools`);
  return t;
}

describe('info-link tool registrierung', () => {
  it('enthält alle 5 Sprint-4.4a-Tools', () => {
    expect(infoLinkTools).toHaveLength(5);
    const names = infoLinkTools.map((t) => t.name).sort();
    expect(names).toEqual([
      'info.field.add',
      'info.field.delete',
      'info.field.update',
      'link.add',
      'link.delete',
    ]);
  });
});

describe('info.field.add schema', () => {
  const t = getTool('info.field.add');
  it('minimal', () => {
    expect(t.schema.safeParse({ boardRef: '^b', label: 'Status' }).success).toBe(true);
  });
  it('mit Wert', () => {
    expect(t.schema.safeParse({ boardRef: '^b', label: 'Owner', value: 'Enric' }).success).toBe(
      true,
    );
  });
  it('leeres Label lehnt ab', () => {
    expect(t.schema.safeParse({ boardRef: '^b', label: '' }).success).toBe(false);
  });
});

describe('info.field.update schema', () => {
  const t = getTool('info.field.update');
  it('value-only', () => {
    expect(t.schema.safeParse({ boardRef: '^b', fieldId: 'n7', value: 'Neu' }).success).toBe(true);
  });
  it('label-only', () => {
    expect(t.schema.safeParse({ boardRef: '^b', fieldId: 'n7', label: 'Umbenannt' }).success).toBe(
      true,
    );
  });
  it('weder value noch label (Handler-Error)', () => {
    expect(t.schema.safeParse({ boardRef: '^b', fieldId: 'n7' }).success).toBe(true);
  });
  it('ohne fieldId lehnt ab', () => {
    expect(t.schema.safeParse({ boardRef: '^b', value: 'x' }).success).toBe(false);
  });
});

describe('link.add schema', () => {
  const t = getTool('link.add');
  it('minimal mit url', () => {
    expect(t.schema.safeParse({ boardRef: '^b', url: 'https://a.b' }).success).toBe(true);
  });
  it('mit Label und Alias', () => {
    expect(
      t.schema.safeParse({
        boardRef: '^b',
        label: 'Docs',
        url: 'https://docs.example',
        alias: 'docs',
      }).success,
    ).toBe(true);
  });
  it('leere URL lehnt ab', () => {
    expect(t.schema.safeParse({ boardRef: '^b', url: '' }).success).toBe(false);
  });
});

describe('link.delete schema', () => {
  const t = getTool('link.delete');
  it('linkRef allein', () => {
    expect(t.schema.safeParse({ linkRef: '^docs' }).success).toBe(true);
  });
  it('boardRef+linkId', () => {
    expect(t.schema.safeParse({ boardRef: '^b', linkId: 'n7' }).success).toBe(true);
  });
  it('leer akzeptiert (Handler-Error)', () => {
    expect(t.schema.safeParse({}).success).toBe(true);
  });
});
