import { registerTool } from '../dispatcher.js';
import { aliasTools } from './alias.js';
import { cellTools } from './cell.js';
import { matrixTools } from './matrix.js';
import { matrixCrudTools } from './matrix-crud.js';
import { queryTools } from './query.js';

export function registerAllTools(): void {
  for (const tool of [
    ...matrixTools,
    ...matrixCrudTools,
    ...cellTools,
    ...queryTools,
    ...aliasTools,
  ]) {
    registerTool(tool);
  }
}
