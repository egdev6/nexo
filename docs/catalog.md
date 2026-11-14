# Official catalog v1

The catalog is a maintainer-curated **allowlist**, not repository discovery: an app appears as an
official app only when the public catalog contains it. The maintainer reviews public status and
intended inclusion; schema validation cannot prove that a repository or asset is public. Do not
publish private URLs, tokens, private metadata or examples copied from this private repository.

## Format

The envelope is `{ "schemaVersion": 1, "apps": [...] }`. A fictional full example and a minimal
example are in `crates/nexo-catalog/fixtures/`; they are test/development fixtures, **not** the
live catalog. The structural schema is `crates/nexo-catalog/catalog.schema.json`; Rust
`nexo_catalog::parse_catalog` and TypeScript `parseCatalog` also perform domain validation.
A JSON Schema implementation alone cannot enforce uniqueness by an object's `id`, and `format`
checking varies by implementation: always run domain validation too.

Each app has:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable app ID, also used by the IPC protocol. |
| `name`, `tagline`, `description` | yes | Nonblank display text; never HTML. |
| `tags` | yes | Array of nonblank display strings; may be empty. |
| `iconUrl`, `artUrl` | at least one | HTTPS card icon or artwork; both may be present. |
| `installerUrl` | yes | Public HTTPS installer location; the catalog does not download or run it. |
| `latestJsonUrl` | yes | Public HTTPS endpoint maintained by the app for its updater. |
| `integrationLevel` | yes | `full`, `update`, or `launch`; capability, not source or installation state. |
| `releasedAt` | yes | RFC 3339 release timestamp. |
| `featured` | yes | Boolean metadata for the news consumer. |
| `news` | yes | App-scoped news entries; may be empty. |
| `version` | no | SemVer metadata for the published app; not evidence of an installed version or update. |
| `links` | no | Object with optional HTTPS `github` and `youtube` links. |

Each news entry has required `id`, nonblank `title` and `text`, `publishedAt`, and `kind`
(`new`, `featured`, `update`). IDs are unique within each app; the UI projects a globally
unambiguous `appId:newsId` identifier, badge, app ID and catalog CTA. Only the official catalog
supplies this projection. Issue #10 owns news selection, ordering, recency and popup behavior.

IDs are nonempty ASCII lowercase `[a-z0-9-]+` and app IDs are unique across the catalog.
Required fields and their JSON types are strict; unknown fields, null optional fields and unsupported
schema versions are rejected. URLs must be absolute lowercase-scheme `https://` URLs with a host,
no credentials, whitespace, controls or malformed percent escapes. Nonblank text excludes Unicode
whitespace and U+FEFF; URLs also reject U+FEFF and C0/C1 control characters. `version` follows SemVer 2,
with major/minor/patch bounded by unsigned 64-bit integers. Timestamps use the RFC 3339 profile
`YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)`, with real calendar values and explicit zone.
Future incompatible format changes require a new schema version; readers reject versions they do
not understand. Additive fields also require a new version while v1 rejects unknown fields.

`latestJsonUrl` is owned by the app. Before any updater consumes it, the app owner must confirm
its actual Tauri updater manifest format and verification configuration; the catalog loader does
not fetch it. Installation, app control, installed versions and update execution belong to #4 and
#6–#9. Until then, catalog entries carry unknown installation/running state and no fake install
action. Catalog `version` must not be used as the installed version.

## Loading, cache and trust

The native hub starts with a fixed source configured in
`apps/hub/src/catalog/loader.ts`. **No official URL is configured yet**: the hub displays an error
with retry rather than presenting a fixture as official. Browser-only design preview uses labeled
sample data. The loader fetches on startup and explicit retry with an eight-second timeout, rejects
redirects, checks HTTPS, validates the whole response, and saves only valid data to
`catalog.json` in Tauri's app-data directory. A corrupt cache is ignored. On offline/HTTP/parse/
validation failure a valid previous cache remains visible with a stale warning; without one the
error/offline state offers retry. A successful empty catalog shows the empty state. Cache write
failure is surfaced instead of claiming offline persistence. There is no TTL or ETag policy in v1.
The webview performs the fetch: the host must allow the deployed webview origin via CORS.

HTTPS and validation protect transport and shape, not publisher identity or installer integrity.
V1 does not add catalog signatures, mandatory installer hashes, keys or rotation. These and
third-party sources require a separate security design. App updater verification remains the app's
responsibility. Remote strings are displayed as text; no catalog content is executed or auto-installed.

## Publication and adding an app

1. The recommended hosting decision is a **dedicated public catalog repository** served over HTTPS
   (for example GitHub Pages). Creating it and publishing are separate maintainer-authorized steps;
   do not make the private Nexo repository public.
2. For each inclusion, a maintainer reviews the app and verifies that the repository, installer,
   icon/art, updater endpoint and discovery destinations are intentionally public. Verify all URLs
   anonymously and check CORS and stable hosting; HTTPS alone does not establish public status.
3. Add an entry to the public allowlist using the fields above, update the catalog under review, run
   schema **and** domain validation and publish only with separate authorization.
4. After the host and stable URL are established, connect that URL in `OFFICIAL_CATALOG_URL`,
   narrow the webview CSP to the approved origins, and verify anonymous access, redirects and CORS.
   The example fixture URLs do not represent published apps or an existing release.
