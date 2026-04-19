import { registerTool } from '../dispatcher.js';
import { aliasTools } from './alias.js';
import { cardTools } from './card.js';
import { cellTools } from './cell.js';
import { checklistTools } from './checklist.js';
import { infoLinkTools } from './info-link.js';
import { matrixTools } from './matrix.js';
import { matrixCrudTools } from './matrix-crud.js';
import { queryTools } from './query.js';

export function registerAllTools(): void {
  for (const tool of [
    ...matrixTools,
    ...matrixCrudTools,
    ...cellTools,
    ...cardTools,
    ...infoLinkTools,
    ...checklistTools,
    ...queryTools,
    ...aliasTools,
  ]) {
    registerTool(tool);
  }
}
