import { registerTool } from '../dispatcher.js';
import { aliasTools } from './alias.js';
import { atomPinTools } from './atom-pin.js';
import { atomTagTools } from './atom-tag.js';
import { cardTools } from './card.js';
import { cellTemplateTools } from './cell-templates.js';
import { cellTools } from './cell.js';
import { checklistTools } from './checklist.js';
import { featureTemplateTools } from './feature-templates.js';
import { hotkeySlotTools } from './hotkey-slots.js';
import { infoLinkTools } from './info-link.js';
import { matrixCrudTools } from './matrix-crud.js';
import { matrixTools } from './matrix.js';
import { metaTools } from './meta.js';
import { queryTools } from './query.js';
import { savedFilterTools } from './saved-filters.js';
import { settingsTools } from './settings.js';
import { templateTools } from './template.js';

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
    ...settingsTools,
    ...metaTools,
    ...templateTools,
    ...atomPinTools,
    ...atomTagTools,
    // Welle WV.A — Vorlagen-Foundation MCP-Tools.
    ...featureTemplateTools,
    ...cellTemplateTools,
    ...hotkeySlotTools,
    ...savedFilterTools,
  ]) {
    registerTool(tool);
  }
}
