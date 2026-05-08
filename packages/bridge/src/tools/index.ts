import { registerTool } from '../dispatcher.js';
import { aliasTools } from './alias.js';
import { atomMarkerTools } from './atom-markers.js';
import { atomPinTools } from './atom-pin.js';
import { atomTagTools } from './atom-tag.js';
import { cardTools } from './card.js';
import { cellTemplateTools } from './cell-templates.js';
import { cellTools } from './cell.js';
import { checklistTools } from './checklist.js';
import { featureTemplateTools } from './feature-templates.js';
import { hotkeySlotTools } from './hotkey-slots.js';
import { infoFieldTools } from './info-fields.js';
import { infoLinkTools } from './info-link.js';
import { matrixCrudTools } from './matrix-crud.js';
import { matrixTools } from './matrix.js';
import { metaTools } from './meta.js';
import { oauthTokenTools } from './oauth-tokens.js';
import { queryTools } from './query.js';
import { savedFilterTools } from './saved-filters.js';
import { settingsTools } from './settings.js';
import { templateTools } from './template.js';
import { widgetChannelTools } from './widget-channels.js';

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
    // Welle WV.B — info_fields + atom_markers.
    ...infoFieldTools,
    ...atomMarkerTools,
    // Welle WV.D Heptad-Pflege — Channel-Bridges + OAuth-Tokens.
    ...widgetChannelTools,
    ...oauthTokenTools,
  ]) {
    registerTool(tool);
  }
}
