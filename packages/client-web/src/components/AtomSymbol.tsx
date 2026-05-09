// §12.3 Symbol-System — Render-Wrapper fuer ResolvedSymbol.
//
// Dispatcher zwischen drei Render-Pfaden:
//   - source='favicon' + faviconUrl → <img> mit Favicon (URL-Provider).
//     onError-Fallback auf Heroicon iconName (Favicon-Service down /
//     Hostname unreachable).
//   - brandKey gesetzt → <BrandIcon brand={key}> (11 Brand-Provider).
//   - sonst → <Icon name={iconName}> (Heroicon-Default).
//
// Caller liefert ResolvedSymbol aus lib/symbol-resolution.ts. Single-
// Source: keine eigenen Type-Mappings hier, alles kommt aus dem
// Resolver.
//
// Konsumenten:
//   - components/NodeTree (Sidebar-Link-Entries — Provider-distinct
//     Icons statt Generic 'envelope'/'arrow-top-right').
//   - components/CellInfoPage (info_field-Atom-Renderer in Welle B
//     fortgesetzt — V1-Render-Pfad nutzt diesen Wrapper bereits).
//   - IconPicker-Modal (Override-Auswahl rendert Heroicon-Vorschau).

import { type Component, Show, createSignal } from 'solid-js';
import type { ResolvedSymbol } from '../lib/symbol-resolution';
import BrandIcon from './BrandIcon';
import Icon from './Icon';

type Props = {
  resolved: ResolvedSymbol;
  size?: number;
  class?: string;
  // Brand-Color statt currentColor — fuer Provider-Slot-Cards mit
  // grosser visueller Praesenz. Default false (token-konform).
  colored?: boolean;
};

const AtomSymbol: Component<Props> = (p) => {
  // Favicon-Fallback-State: bei <img>-Load-Fehler auf Heroicon
  // umschalten. Memoisiert pro Render — bei URL-Wechsel im Resolved
  // gibt es einen neuen Component-Mount, also Reset.
  const [faviconFailed, setFaviconFailed] = createSignal(false);

  return (
    <Show
      when={p.resolved.source === 'favicon' && p.resolved.faviconUrl && !faviconFailed()}
      fallback={
        <Show
          when={p.resolved.brandKey}
          fallback={<Icon name={p.resolved.iconName} size={p.size} class={p.class} />}
        >
          {(brandKey) => (
            <BrandIcon brand={brandKey()} size={p.size} colored={p.colored} class={p.class} />
          )}
        </Show>
      }
    >
      <img
        src={p.resolved.faviconUrl}
        alt=""
        width={p.size ?? 16}
        height={p.size ?? 16}
        class={`atom-symbol-favicon ${p.class ?? ''}`.trim()}
        onError={() => setFaviconFailed(true)}
        aria-hidden="true"
      />
    </Show>
  );
};

export default AtomSymbol;
