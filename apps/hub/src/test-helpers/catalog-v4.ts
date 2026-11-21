type FlatTestApp = {
  id: string;
  installerUrl: string;
  latestJsonUrl: string;
  releasedAt: string;
  version?: string;
  updaterPublicKey?: string;
  detection?: { windows: { displayName: string; publisher: string; executableRelativePath: string } };
};

/** Convert existing UI test data into a valid Windows v4 wire document. */
export function windowsCatalog<T extends FlatTestApp>(apps: T[]) {
  return { schemaVersion: 4 as const, apps: apps.map(app => {
    const { installerUrl, latestJsonUrl, releasedAt, version, updaterPublicKey, detection, ...common } = app;
    void installerUrl; void latestJsonUrl;
    return { ...common, platforms: { 'windows-x86_64': {
      installerUrl: `https://github.com/egdev6/${app.id}/releases/download/v1/${app.id}_x64-setup.exe`,
      latestJsonUrl: `https://github.com/egdev6/${app.id}/releases/download/v1/latest.json`,
      version: version ?? '1.0.0', releasedAt,
      ...(updaterPublicKey === undefined ? {} : { updaterPublicKey }),
      ...(detection === undefined ? {} : { detection: detection.windows }),
    } } };
  }) };
}
