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

    // Vollständige Liste aller Tools (Phase 4 + V2.1 + V2.2 + Welle D
    // atom_pin / tag / doc.pin + Welle WV.A Vorlagen-Foundation)
    const expected = [
      'alias.expand_to_text',
      'alias.resolve',
      'alias.set',
      'atom_marker.list',
      'atom_marker.set',
      'atom_marker.unset',
      'atom_pin.create',
      'atom_pin.delete',
      'atom_pin.list',
      'atom_pin.move',
      'card.checklist.link_ref',
      'card.checklist.unlink_ref',
      'card.create',
      'card.delete',
      'card.done.toggle',
      'card.move',
      'card.recurrence.set',
      'card.update',
      'cell.alias.set',
      'cell.feature.add',
      'cell.get',
      'cell_template.apply',
      'cell_template.bulk_apply',
      'cell_template.list',
      'cell_template.override.reset',
      'cell_template.override.set',
      'cell_template.remove',
      'checklist.add',
      'checklist.clone',
      'checklist.close',
      'checklist.history.delete',
      'checklist.history.list',
      'checklist.item.add',
      'checklist.item.move',
      'checklist.item.set_level',
      'checklist.item.toggle',
      'checklist.paste',
      'checklist.set_action',
      'checklist.set_close_mode',
      'checklist.set_recur',
      'checklist.to_card',
      'col.add',
      'col.delete',
      'doc.pin',
      'feature_template.create',
      'feature_template.delete',
      'feature_template.list',
      'hotkey_slot.clear',
      'hotkey_slot.list',
      'hotkey_slot.set.user',
      'hotkey_slot.set.workspace',
      'info.field.add',
      'info.field.delete',
      'info.field.update',
      'info_field.add',
      'info_field.delete',
      'info_field.list',
      'info_field.move',
      'info_field.update',
      'link.add',
      'link.delete',
      'matrix.create',
      'matrix.delete',
      'matrix.edit_mode.set',
      'matrix.navigate',
      'matrix.rename',
      'matrix.state.get',
      'oauth_token.disconnect',
      'oauth_token.list',
      'query.aliases',
      'query.cards',
      'row.add',
      'row.delete',
      'saved_filter.create',
      'saved_filter.delete',
      'saved_filter.list',
      'settings.get',
      'settings.set',
      'status',
      'tag.add.alias',
      'tag.add.atomref',
      'tag.add.freetext',
      'tag.add.objectref',
      'tag.gc',
      'tag.list',
      'tag.remove',
      'template.instantiate',
      'template.list',
      'undo.last',
      'widget_channel.delete',
      'widget_channel.list',
      'widget_channel.set',
    ];

    expect(names).toEqual(expected);
    expect(tools.size).toBe(92);
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
