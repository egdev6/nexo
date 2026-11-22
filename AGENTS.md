# Agent guide

The design system rules below apply to the hub frontend in `apps/hub`.

<!-- egdev-ds:agents -->
## EGDEV design system

- Before writing UI, use `@egdev/ui` and `@egdev/tokens`; query the `egdev-design-system` MCP server when available, otherwise use the vendored `@egdev/mcp` over stdio (`node node_modules/@egdev/mcp/dist/index.js`) or the project's `design/system.md`.
- Classes passed to DS components may set only CSS properties in their `className` contract (placement plus the component's published `classNameAllows`); anything else is DS046.
- Do not select component internals (DS041, DS047) or look up `.eg-*` markup in code (DS048).
- Do not hand-write colors, spacing or fonts.
- If the DS lacks something, stop that part and open a Consumer request describing the need: https://github.com/egdev6/egdev-design-system/issues/new?template=consumer_request.yml
- Mitigate only by composing DS parts with `// TODO(egdev-design-system#N)` and an issue-backed allowlist entry.
- Never edit vendored tarballs, `egdev-ds.json` or `@egdev/*` lockfile entries.
- Flow: https://github.com/egdev6/egdev-design-system/blob/main/docs/distribution/consumer-requests.md.
<!-- /egdev-ds:agents -->
