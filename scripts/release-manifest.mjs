/** Keep the update endpoint stable and bind each ZIP to its exact release version. */
export function releaseManifest(source, { repository, tag, packageVersion } = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id)) throw new Error("Invalid module ID");
  if (!/^\d+\.\d+\.\d+$/.test(source.version)) throw new Error("Release version must be major.minor.patch");
  if (packageVersion && packageVersion !== source.version) throw new Error("package.json and module.json versions must match");
  if (tag && tag !== `v${source.version}`) throw new Error(`Release tag must be v${source.version}`);
  repository ||= new URL(source.url).pathname.slice(1);
  if (!/^[\w-]+\/[\w.-]+$/.test(repository)) throw new Error("Use a GitHub owner/repository name");
  const url = `https://github.com/${repository}`;
  return {
    ...source, url,
    manifest: `${url}/releases/latest/download/module.json`,
    download: `${url}/releases/download/v${source.version}/${source.id}-${source.version}.zip`
  };
}
