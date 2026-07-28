// Which release artifact this machine needs.
//
// Resolution is a table rather than a computation. A computed triple would silently produce a name
// for a platform nobody built for, and the failure would arrive as a download that 404s rather than
// as a refusal that says which platforms exist.

/**
 * Every target a release publishes, keyed by Node's own platform and architecture strings.
 *
 * `process.platform` and `process.arch` are what Node reports, and they are the only thing available
 * before any native code runs — which is the whole situation a launcher is in.
 */
export const TARGETS = Object.freeze({
  "darwin-arm64": { triple: "aarch64-apple-darwin", archive: "tar.gz", binary: "nostdb" },
  "darwin-x64": { triple: "x86_64-apple-darwin", archive: "tar.gz", binary: "nostdb" },
  "linux-arm64": { triple: "aarch64-unknown-linux-gnu", archive: "tar.gz", binary: "nostdb" },
  "linux-x64": { triple: "x86_64-unknown-linux-gnu", archive: "tar.gz", binary: "nostdb" },
  "win32-arm64": { triple: "aarch64-pc-windows-msvc", archive: "zip", binary: "nostdb.exe" },
  "win32-x64": { triple: "x86_64-pc-windows-msvc", archive: "zip", binary: "nostdb.exe" },
});

/** Why this machine cannot be served. */
export class UnsupportedPlatform extends Error {
  constructor(platform, arch) {
    super(
      `no NostDB release is published for ${platform}-${arch}; ` +
        `published targets are ${Object.keys(TARGETS).sort().join(", ")}`,
    );
    this.code = "DISTRIBUTION_UNSUPPORTED_PLATFORM";
    this.platform = platform;
    this.arch = arch;
  }
}

/**
 * The target for a platform and architecture.
 *
 * Refuses rather than guessing. A launcher that fell back to the nearest target would run a binary
 * built for another machine, and the failure mode of that is a crash somewhere unrelated.
 *
 * @param {string} platform `process.platform`
 * @param {string} arch `process.arch`
 */
export function resolveTarget(platform, arch) {
  const key = `${platform}-${arch}`;
  const target = TARGETS[key];
  if (!target) throw new UnsupportedPlatform(platform, arch);
  return { key, ...target };
}

/** The archive name a release publishes for a target at a version. */
export function archiveName(version, target) {
  return `nostdb-${version}-${target.triple}.${target.archive}`;
}
