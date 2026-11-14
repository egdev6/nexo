# Official catalog v1, v2 and v3

The catalog is a maintainer-curated **allowlist**, not repository discovery: an app appears as an
official app only when the public catalog contains it. The maintainer reviews public status and
intended inclusion; schema validation cannot prove that a repository or asset is public. Do not
publish private URLs, tokens, private metadata or examples copied from this private repository.

## Format

The envelope is `{ "schemaVersion": 1, "apps": [...] }`, `{ "schemaVersion": 2, "apps": [...] }`,
or `{ "schemaVersion": 3, "apps": [...] }`. Readers accept all three versions; old versions
continue to reject fields introduced later. A fictional full example and a minimal
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
| `updaterPublicKey` | v3 only, optional | The Tauri updater's base64-encoded minisign public key, exactly as in `plugins.updater.pubkey`. Omit when not verified. |
| `detection` | v2/v3, optional | `{ "windows": { "displayName": "Example App", "publisher": "Example Publisher", "executableRelativePath": "bin\\\\Example.exe" } }`. All three fields are required nonblank strings. A hint is metadata, not proof of installation. |

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

The Windows hint uses exact `DisplayName` and `Publisher` values from the current user's NSIS
uninstall entry, not the catalog display name. The executable path is relative to `InstallLocation`;
only `.exe` paths are accepted, without absolute/UNC/drive paths, traversal, empty components,
Windows-forbidden characters, controls, or components ending in space or dot. A matching path and
publisher are not authentication: HKCU and same-user files can be spoofed. Confirm actual installer
metadata with app owners before publishing a hint. A v1 app or v2/v3 app without a hint has unknown
installation state; never infer it from catalog `version` or IPC.

In v3, `installerUrl` and `latestJsonUrl` must identify a release asset at
`https://github.com/egdev6/<repo>/releases/download/<tag>/<asset>`. The domain validator
checks the parsed host, owner and path; rejects credentials, non-default ports, query strings,
fragments, normalized traversal and escaped separators; and permits no extra path components.
V1/v2 retain their original HTTPS policy. A v3 key must decode to a minisign public-key file
with an `untrusted comment:` line and a base64 `Ed` public-key record. This shape check is
not signature verification, proof of publisher control or authorization to execute anything.
The installer remains unavailable until the separate secure installation service is implemented.

`latestJsonUrl` is owned by the app. Before any updater consumes it, the app owner must confirm
its actual Tauri updater manifest format and verification configuration; the catalog loader does
not fetch it. Installed versions come only from the current user's uninstall registry; the app's
IPC version is displayed separately. Detection failures, absent hints and ambiguous matches remain
unknown. Opening rechecks the matching entry and executable; connected plugins receive `show` and
can receive `quit` when supported. Other apps have unknown running state and must be closed from the
app itself. Accepted requests do not prove that a window opened or a process exited. An app's own
single-instance handler is responsible for handoff; duplicates are possible without one. Local apps
are owned by #9, and install/update execution by #7/#8. Catalog `version` is never the installed version.

## Loading, cache and trust

The native hub starts with fixed sources configured in `apps/hub/src/catalog/loader.ts`.
The official v1/v2 feeds are published from the public repository
[`egdev6/nexo-catalog`](https://github.com/egdev6/nexo-catalog) on GitHub Pages:
`https://egdev6.github.io/nexo-catalog/v2/catalog.json` and
`https://egdev6.github.io/nexo-catalog/catalog.json`. The new preferred v3 endpoint is
`https://egdev6.github.io/nexo-catalog/v3/catalog.json`; its publication requires separate
approval and coordination. Editing the catalog updates installs on their next start without a
Nexo release, as long as the content stays within a schema version the installed hub understands.
If all endpoints and caches fail, the hub displays an error with retry
rather than presenting a fixture as official. Browser-only design preview uses labeled sample data. The loader fetches on startup and explicit retry with an eight-second timeout, rejects
redirects, checks HTTPS, validates the whole response, and saves only valid data to the version-specific cache in Tauri's app-data directory: `catalog.json` for v1,
`catalog-v2.json` for v2, and `catalog-v3.json` for v3. A corrupt cache is ignored. On offline/HTTP/parse/
validation failure a valid previous cache remains visible with a stale warning; without one the
error/offline state offers retry. A successful empty catalog shows the empty state. Cache write
failure is surfaced instead of claiming offline persistence. There is no TTL or ETag policy in v1.
New clients prefer the separately configured v3 endpoint and its cache, falling back to v2 and
then v1 when a newer version is unavailable and has no valid cache. Responses and caches of the wrong version are rejected.
Never replace a versioned endpoint in place with a newer schema. The webview performs the fetch: GitHub Pages answers
with `Access-Control-Allow-Origin: *` and `Cache-Control: max-age=600`, so changes reach clients within
about ten minutes. The webview CSP allows fetches and images only from `https://egdev6.github.io`;
catalog icons are served from the catalog repository for that reason.

HTTPS and validation protect transport and shape, not publisher identity or installer integrity.
The catalog has no signature, mandatory installer hashes or key rotation/revocation mechanism.
The v3 key is metadata, not evidence that a download is trusted; a future installer/updater must
independently fetch current v3 data and verify the detached signature before any execution.
Third-party sources require a separate security design. Remote strings are displayed as text;
no catalog content is currently executed or auto-installed.

## Publication and adding an app

1. The catalog lives in the **dedicated public repository** `egdev6/nexo-catalog`, served over HTTPS by
   GitHub Pages; its `Validate catalog` workflow checks the published files against the schema. Do not make the
   private Nexo repository public.
2. For each inclusion, a maintainer reviews the app and verifies that the repository, installer,
   icon/art, updater endpoint and discovery destinations are intentionally public. Verify all URLs
   anonymously and check CORS and stable hosting; HTTPS alone does not establish public status.
3. Add an entry to the public allowlist using the fields above, update the catalog under review, run
   schema **and** domain validation and publish only with separate authorization.
4. Images and links must stay on origins the webview allows (`https://egdev6.github.io` for icons);
   adding another origin requires a CSP change and a Nexo release. Verify anonymous access, redirects
   and CORS after publishing. The example fixture URLs do not represent published apps or an existing release.
