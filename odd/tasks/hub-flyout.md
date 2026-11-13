# Hub flyout panel (02-pestanas)
> Objective: replace the hub's placeholder window with a right-anchored tray flyout implementing design/nexo-hub-flyout/02-pestanas.html. Branch: feat/hub-flyout (from main a40b3b1). Delivery: single PR (ask-on-risk if the forecast changes materially). Runner: Vitest (apps/hub), cargo test/clippy, native Windows build; manual Windows check by the maintainer.

## Specs

- S1: "no quiero una vista web, había pensado más bien en un sidebar que sale por la derecha de la pantalla principal con un alto máximo y una anchura de unos 600px"
- S2: "Implement it in the project's real stack. Use the artboard as the visual spec: map its parts to the project's existing components and styles, and do not copy the artboard HTML verbatim."
- S3: "Take colors, typography, spacing, radius and shadows from design/system.md, the project's token source."
- S4 (artboard, title "Secciones y detalle"): "Las pestañas y el detalle plegable reducen el ruido; algunas opciones requieren un paso más."

### Assumptions (parent, pending maintainer feedback)
- A1: Data is a typed sample fixture (Antena running with update 1.4.0 -> 1.5.0, Quorb, Pizarra, Cadencia, OBS Studio local) because the catalog (#5) and hub IPC server (#4) do not exist yet; actions are wired to handlers that only update local UI state or are no-ops, clearly marked, never faking real install/update.
- A2: Window: frameless, ~600 px wide, height capped (820 px reference on a 900 px desktop, generally the primary monitor work area minus margins), anchored to the right of the primary monitor above the taskbar, always on top, hidden from the taskbar; left-click on the tray icon toggles it; Esc and focus loss hide it; the tray right-click menu keeps "Salir"; a second launch (single instance) shows it. Mica/acrylic backdrop where Tauri supports it, with an opaque fallback from the system tokens.
- A3: The panel shrinks to content when there are few apps and scrolls internally beyond the cap.

## Tasks

- T1 (S1-S4) Record the chosen design and plan — parent — commit: TBD — status: in progress
- T2 (S1-S4) Flyout UI in React with tokens, tabs (Mis apps / Catálogo / Novedades), expandable app row, sample data, Vitest tests and docs — worker — commit: TBD — status: pending
- T3 (S1) Tray-anchored flyout window (Tauri config + Rust positioning/toggle/hide) with tests where meaningful — same worker — commit: TBD — status: pending
- T4 (S1-S4) Verification, maintainer Windows check, PR — parent/verifier/maintainer — status: pending

## Log

- L1 (user, 2026-11-14, verbatim brief): "no quiero una vista web, había pensado más bien en un sidebar que sale por la derecha de la pantalla principal con un alto máximo y una anchura de unos 600px"
- L2 (user handoff): "Implement the design artboard design/nexo-hub-flyout/02-pestanas.html" with: "Implement it in the project's real stack. Use the artboard as the visual spec: map its parts to the project's existing components and styles, and do not copy the artboard HTML verbatim. Take colors, typography, spacing, radius and shadows from design/system.md, the project's token source." and "This design is not linked to an ODD feature document: size it under the project's ODD rules as usual. This handoff itself commits nothing."
- L3: Context: design/system.md synced from egdev-design-system 247752f; designs nexo-hub (rejected window format, kept) and nexo-hub-flyout (01-lista, 02-pestanas chosen, 03-lanzador alternatives). Hub today: placeholder App ("Nexo / Your apps, together."), 800x600 window, tray with "Salir", single instance, port 1440. No existing hub components or CSS. Branch feat/hub-flyout created from origin/main a40b3b1; carried local uncommitted notes (odd/tasks/2-monorepo-hub.md unrelated, preserved; odd/tasks/3-plugin-tray.md L42-L45 post-merge evidence to commit as docs). Gentle-design handoff reported in_progress.
