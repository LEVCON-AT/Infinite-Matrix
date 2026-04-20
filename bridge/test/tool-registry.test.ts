import { describe, expect, it } from 'vitest';
import { getTools } from '../src/dispatcher.js';
import { registerAllTools } from '../src/tools/index.js';

// Registry-Reset per Modul-Import nicht trivial (dispatcher hält Map privat).
// Annahme: registerAllTools ist idempotent (set auf Map) — beim zweiten Aufruf
// werden gleiche Keys überschrieben, Gesamt-Count bleibt konstant.

describe('registerAllTools() Integration', () => {
  it('registriert alle Sprint-4-Tools', () => {
    registerAllTools();
    const tools = getTools();
    const names = [...tools.keys()].sort();

    // Vollständige Liste aller Tools (Phase 4 + V2.1 + V2.2)
    const expected = [
      'alias.resolve',
      'alias.set',
      'card.create',
      'card.delete',
      'card.done.toggle',
      'card.move',
      'card.recurrence.set',
      'card.update',
      'cell.alias.set',
      'cell.feature.add',
      'cell.get',
      'checklist.add',
      'checklist.clone',
      'checklist.item.add',
      'checklist.item.move',
      'checklist.item.set_level',
      'checklist.item.toggle',
      'checklist.paste',
      'col.add',
      'col.delete',
      'info.field.add',
      'info.field.delete',
      'info.field.update',
      'link.add',
      'link.delete',
      'matrix.create',
      'matrix.delete',
      'matrix.edit_mode.set',
      'matrix.navigate',
      'matrix.rename',
      'matrix.state.get',
      'query.aliases',
      'query.cards',
      'row.add',
      'row.delete',
      'settings.get',
      'settings.set',
      'status',
      'template.instantiate',
      'template.list',
      'undo.last',
    ];

    expect(names).toEqual(expected);
    expect(tools.size).toBe(41); // +3 aus V2.2: checklist.paste, .clone, .item.move
  });

  it('jedes registrierte Tool hat schema + jsonSchema', () => {
    registerAllTools();
    for (const [name, tool] of getTools()) {
      expect(tool.name, name).toBe(name);
      expect(tool.description, name).toBeTruthy();
      expect(tool.schema, name).toBeTruthy();
      expect(tool.jsonSchema, name).toBeTruthy();
      expect((tool.jsonSchema as { type?: string }).type, name).toBe('object');
    }
  });
});
