# Official catalog v4

The catalog is a maintainer-curated **allowlist**, not repository discovery. Schema validation
cannot prove that a repository or asset is public. Do not publish private URLs, tokens, private
metadata or examples copied from this repository.

## Format

Nexo 0.2.0 reads only `{ "schemaVersion": 4, "apps": [...] }`. The structural schema is
`crates/nexo-catalog/catalog.schema.json`; Rust `nexo_catalog::parse_catalog_v4` and the
TypeScript catalog parser also perform domain validation. JSON Schema alone cannot enforce uniqueness by
ID, and format checking varies by implementation. The fixtures under `crates/nexo-catalog/fixtures/`
are fictional test data, **not** the live catalog.

Each app has these common fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Stable, unique app ID; nonempty ASCII lowercase `[a-z0-9-]+`. |
| `name`, `tagline`, `description` | yes | Nonblank display text; never HTML. |
| `tags` | yes | Array of nonblank display strings; may be empty. |
| `iconUrl`, `artUrl` | at least one | HTTPS card icon or artwork. |
| `integrationLevel` | yes | `full`, `update`, or `launch`; capability, not installation state. |
| `featured` | yes | Boolean metadata for the news consumer. |
| `links` | no | Object with optional HTTPS `github` and `youtube` links. |
| `news` | yes | App-scoped news entries; may be empty. |
| `platforms` | yes | Nonempty object mapping platform keys to release entries. |

Keys match `^(windows|darwin|linux)-(x86_64|aarch64|i686|armv7)$`, for example
`windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`, and `linux-x86_64`. Every entry contains:

| Field | Required | Meaning |
| --- | --- | --- |
| `installerUrl` | yes | egdev6 GitHub release-asset URL for this platform's installer. |
| `latestJsonUrl` | yes | egdev6 GitHub release-asset URL for this platform's updater manifest. |
| `version` | yes | SemVer 2 release version, not evidence of an installed version. |
| `releasedAt` | yes | RFC 3339 release timestamp. |
| `updaterPublicKey` | no | Tauri updater's base64-encoded minisign public key. Omit when not verified. |
| `detection` | Windows keys only, optional | Flat object with required nonblank `displayName`, `publisher`, and `executableRelativePath`. |

The hub maps its own OS and architecture to a key (`macos` → `darwin`, `x86` → `i686`,
`arm` → `armv7`). It validates the whole wire document and projects only that entry to the
existing flat app shape, including wrapping the hint as `detection: { windows: ... }`. Apps
without that key are hidden from catalog, Mis apps matching, news, installation and update checks.
An unsupported OS or architecture has no key and hides all apps. News entries have required `id`,
nonblank `title` and `text`, `publishedAt`, and `kind` (`new`, `featured`, or `update`); IDs are
unique within their app. The UI projects globally unambiguous `appId:newsId` identifiers. An app
is eligible for Novedades if its release is not in the future and is within the last 30 days or
featured. Each eligible app contributes its latest in-window news (equal timestamps resolve by
ascending news ID), or a synthetic entry if none qualifies. Future news does not hide older
in-window news; entries are ordered newest first, with typed-key tie breaking, and the popup shows
at most four.

Unknown fields, null optional fields, invalid platform keys and unsupported schema versions are
rejected. URLs must be absolute `https://` URLs without credentials, controls, whitespace or
malformed escapes. Nonblank text excludes Unicode whitespace and U+FEFF; URLs also reject U+FEFF
and C0/C1 controls. SemVer major/minor/patch components are bounded by unsigned 64-bit integers.
Installer and updater URLs must identify a release asset at
`https://github.com/egdev6/<repo>/releases/download/<tag>/<asset>`; the domain validator also
rejects non-default ports, query strings, fragments, normalized traversal and escaped separators.
Timestamps have real calendar values and explicit zones. The updater key must decode to a minisign
public-key file with an `untrusted comment:` line and a base64 `Ed` public-key record. This shape
check is not signature verification or publisher authentication.

The Windows hint uses the exact `DisplayName` and `Publisher` from the current user's NSIS
uninstall entry, not the catalog display name. The executable path is relative to `InstallLocation`:
only `.exe` paths are accepted, without absolute/UNC/drive paths, traversal, empty components,
Windows-forbidden characters, controls or components ending in space or dot. A matching path and
publisher are not authentication; HKCU and same-user files can be spoofed. Confirm actual installer
metadata with app owners before publishing a hint. Missing hints leave installation state unknown.

A keyed `windows-x86_64` entry asserts that its installer is a per-user Tauri NSIS installer
(`bundle.windows.nsis.installMode: "currentUser"`), with an asset name ending in
`_x64-setup.exe` and a prehashed minisign signature at `<installerUrl>.sig`. The hub rejects other
assets before download, verifies the signature, and runs the installer with `/S` and no elevation.
Owners must confirm the install mode before publishing a key. Installed versions come from the
current user's uninstall registry, not the catalog or IPC.

`latestJsonUrl` is owned by the app; before any updater consumes it, the owner must confirm its
Tauri updater manifest format and verification configuration. Detection failures, absent hints and
ambiguous matches remain unknown. Opening rechecks the matching entry and executable; connected
plugins can receive `show` and, when supported, `quit`. Accepted requests do not prove that a
window opened or process exited. An app's single-instance handler is responsible for handoff.

## Loading, cache and trust

The only feed Nexo 0.2.0 fetches, both in the webview and native installer, is
`https://egdev6.github.io/nexo-catalog/v4/catalog.json`. It validates the complete response and
stores only valid v4 documents in the single `catalog-v4.json` app-data cache; old cache files are
ignored. Offline or invalid responses may use the valid cache with a stale warning; without one the
hub offers retry. A corrupt cache is ignored and a write failure is surfaced. The native installer
always fetches fresh data and revalidates its selection before execution; it does not authorize
installation from cache. The loader uses an eight-second timeout, rejects redirects, and presents a
valid empty catalog as an empty state. Browser-only design preview uses labeled sample data.

The public repository continues to publish `catalog.json`, `v2/catalog.json`, and
`v3/catalog.json` unchanged for installed Nexo 0.1.x clients. Do not replace a versioned endpoint
in place with a newer schema. Editing a catalog updates installs on their next start without a Nexo
release, provided the format stays compatible. GitHub Pages CORS allows the webview fetch and its
cache policy can delay changes. The webview CSP allows catalog fetches and images only from
`https://egdev6.github.io`.

HTTPS and validation protect transport and shape, not publisher identity. The catalog has no
signature, mandatory installer hashes or key rotation/revocation mechanism. The updater key is
metadata; the installer verifies its detached signature before execution and asks for native user
confirmation. Third-party sources require a separate security design. Remote strings are displayed
as text; nothing is installed without confirmation.

## Publication and adding an app

1. Publish from the dedicated public repository `egdev6/nexo-catalog`; its `Validate catalog`
   workflow checks the published files. Do not make the private Nexo repository public.
2. Review each inclusion and verify anonymously that the repository, installer, icon/art, updater
   endpoint and discovery destinations are intentionally public; verify platform and install mode.
3. Add an entry to the public allowlist, run schema **and** domain validation, and publish only
   with separate authorization.
4. Images and links must stay on origins allowed by the webview; adding another origin requires a
   CSP change and a Nexo release. Verify redirects and CORS after publishing.
