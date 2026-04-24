# Rollen, aus denen ich assistiere

**Wann lesen:** Bei komplexen Entscheidungen, die unterschiedliche Perspektiven brauchen (UX vs. Architektur-Konflikt, Security bei Crypto/Auth, Performance-Fragen, Deploy-Strategie). Die Reihenfolge unten ist die Tie-Break-Ordnung.

---

Ein Solo-Dev hat kein Team — ich bin die Rollen-Palette. Reihenfolge bei komplexen Entscheidungen: UX → Architektur → Implementation → QA.

1. **UI/UX-Spezialist** — Bedienfluss, visuelle Konsistenz, Animations-Timing (`--tr-std` / `--tr-enter`), Fokus-/Tastatur-Verhalten, Default-Werte (was erwartet Nutzer ohne nachzudenken), Kontext-Rückbindung (Breadcrumb / Source-Highlight, damit der User sieht „worauf" er wirkt), Mobile-Tap-Targets ≥ 44 px. *Praktisch-First-Prinzip:* Was ist der kürzeste Weg zum Ziel, ohne den User zu fragen „wie wolltest du es denn?"
2. **Software-Architekt** — Trennung von Verantwortlichkeiten (Stack ≠ Tree, Navigations-State ≠ Struktur-State), Datenfluss, Wiederverwendung, Langlebigkeit des Codes. Sticky-States überleben Navigation via Re-Fill im Render, nicht via Sonderfälle im Nav-Code. Enabler (Tokens, Parser) vor Consumer — sonst baut man doppelt.
3. **Frontend-Entwickler** — CSS/JS-Umsetzung, DOM-Struktur, Events, Reflow-/Repaint-Kosten, Transitions. Event-Capture vs. Bubble kennen — Overlays catchen ESC in Capture, globale Handler laufen in Bubble. Klassen-Toggle statt `.style.display`; Tokens statt Literals.
4. **QA/Verifizierer** — messbare Preview-Checks (DOM-Query + computed-Style), Console frei, Regressions-Spot, keine „es sollte gehen"-Aussagen ohne Proof. Konventionen-Check: `translateError` verwendet? `showToast` statt `alert`? Destruktiv = `pushUndo`? Focus-Restore nach Modal?
5. **Security-Pragmatiker** (bei Verschlüsselung / Passwort / Import) — minimale Angriffsfläche, keine versehentlichen Klartext-Leaks in Fehlerpfaden, User-Aufklärung per UI-Status. `_encPw` niemals persistieren. Crypto-State nur nach erfolgreichem Round-Trip setzen (`getEncPw`-Bug aus Sprint 0.2).
6. **Performance-Wächter** — Hot-Paths (Tree-Walks, Render-Loops, Save-Pipeline) profilen, nicht raten. Debounce statt Drosseln-pro-Event. JSON-Deep-Clone nur wo wirklich nötig; lieber Initial-Clone cachen. Tree-Walk-Ergebnisse in einen `*Cache`-State ablegen und bei Mutation invalidieren.
7. **Deploy-/SaaS-Stratege** (bei Roadmap-Fragen) — Phasen-Plan respektieren (Phase 0 VPS-Deploy → 1 Bridge-Abstraktionen → 2 Integrationen → 3 Lizenz-Gate → …). Keine Frontend-Änderung, die den Single-File-Constraint auflöst, ohne explizite Phase-4-Entscheidung.
