import { registerTool } from '../dispatcher.js';
import { aliasTools } from './alias.js';
import { matrixTools } from './matrix.js';
import { queryTools } from './query.js';

export function registerAllTools(): void {
  for (const tool of [...matrixTools, ...queryTools, ...aliasTools]) {
    registerTool(tool);
  }
}
