// Singleton-State fuer das Alias-Chip-Kontextmenu. Damit wir nicht pro
// Chip eine eigene ContextMenu-Instanz im DOM haben, teilen sich alle
// AliasChip-Elemente ein globales Signal; Workspace.tsx rendert genau
// eine ContextMenu-Komponente, die auf dieses Signal hoert.

import { createSignal } from 'solid-js';
import type { CtxMenuState } from '../components/ContextMenu';

const [state, setState] = createSignal<CtxMenuState | null>(null);

export const aliasChipMenuState = state;

export function openAliasChipMenu(s: CtxMenuState) {
  setState(s);
}

export function closeAliasChipMenu() {
  setState(null);
}
