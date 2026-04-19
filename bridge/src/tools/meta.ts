import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const undoLastSchema = z.object({});
const statusSchema = z.object({});

export const metaTools: ToolDef[] = [
  {
    name: 'undo.last',
    description: 'Macht die letzte destruktive Aktion rückgängig (Undo-Stack pop + apply).',
    schema: undoLastSchema,
    jsonSchema: zodToJsonSchema(undoLastSchema),
  },
  {
    name: 'status',
    description:
      'Liefert Status-Info: rootId, Stack-Tiefe, Node-Zahl, Alias-Zahl, Undo-Stack-Größe, Edit-Modus.',
    schema: statusSchema,
    jsonSchema: zodToJsonSchema(statusSchema),
  },
];
