// Welle WV.B.7 — Vitest fuer info_fields + atom_markers Tools.

import { describe, expect, it } from 'vitest';
import { atomMarkerTools } from '../src/tools/atom-markers.js';
import { infoFieldTools } from '../src/tools/info-fields.js';

function get<T extends { name: string; schema: { safeParse: (raw: unknown) => unknown } }>(
  list: readonly T[],
  name: string,
): T {
  const t = list.find((x) => x.name === name);
  if (!t) throw new Error(`Tool ${name} fehlt`);
  return t;
}

describe('info_field Tools', () => {
  it('exportiert 5 Tools', () => {
    expect(infoFieldTools.map((t) => t.name).sort()).toEqual([
      'info_field.add',
      'info_field.delete',
      'info_field.list',
      'info_field.move',
      'info_field.update',
    ]);
  });

  it('info_field.add lehnt unbekannte valueType ab', () => {
    const tool = get(infoFieldTools, 'info_field.add');
    expect(
      (tool.schema.safeParse({ label: 'X', valueType: 'rich-text' }) as { success: boolean })
        .success,
    ).toBe(false);
  });

  it('info_field.add akzeptiert alle 10 valueType-Werte', () => {
    const tool = get(infoFieldTools, 'info_field.add');
    for (const t of [
      'text',
      'number',
      'date',
      'currency',
      'boolean',
      'email',
      'phone',
      'url',
      'enum',
      'alias-ref',
    ]) {
      expect(
        (tool.schema.safeParse({ label: 'X', valueType: t }) as { success: boolean }).success,
        `valueType=${t}`,
      ).toBe(true);
    }
  });

  it('info_field.add Default valueType=text', () => {
    const tool = get(infoFieldTools, 'info_field.add');
    const parsed = tool.schema.safeParse({ label: 'X' }) as {
      success: boolean;
      data: unknown;
    };
    expect(parsed.success).toBe(true);
    expect((parsed.data as { valueType: string }).valueType).toBe('text');
  });
});

describe('atom_marker Tools', () => {
  it('exportiert 3 Tools', () => {
    expect(atomMarkerTools.map((t) => t.name).sort()).toEqual([
      'atom_marker.list',
      'atom_marker.set',
      'atom_marker.unset',
    ]);
  });

  it('atom_marker.set akzeptiert star + eye', () => {
    const tool = get(atomMarkerTools, 'atom_marker.set');
    for (const k of ['star', 'eye']) {
      expect(
        (
          tool.schema.safeParse({ kind: k, atomType: 'task', atomId: 'a' }) as {
            success: boolean;
          }
        ).success,
        `kind=${k}`,
      ).toBe(true);
    }
  });

  it('atom_marker.set lehnt unbekannte kind ab', () => {
    const tool = get(atomMarkerTools, 'atom_marker.set');
    expect(
      (
        tool.schema.safeParse({ kind: 'bookmark', atomType: 'task', atomId: 'a' }) as {
          success: boolean;
        }
      ).success,
    ).toBe(false);
  });

  it('atom_marker.set akzeptiert info_field als atomType (Welle B)', () => {
    const tool = get(atomMarkerTools, 'atom_marker.set');
    expect(
      (
        tool.schema.safeParse({ kind: 'star', atomType: 'info_field', atomId: 'a' }) as {
          success: boolean;
        }
      ).success,
    ).toBe(true);
  });

  it('atom_marker.list scope-Default = workspace', () => {
    const tool = get(atomMarkerTools, 'atom_marker.list');
    const parsed = tool.schema.safeParse({}) as { success: boolean; data: unknown };
    expect(parsed.success).toBe(true);
    expect((parsed.data as { scope: string }).scope).toBe('workspace');
  });
});
