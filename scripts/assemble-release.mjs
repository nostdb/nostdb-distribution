#!/usr/bin/env node
// Assembles a release archive for one target, and records what it assembled.
//
// # What this does and does not do
//
// It packages a binary somebody else built, digests it, and writes the entry `checksums.json` will
// carry. It does **not** build the Engine — a release assembler that compiled would be choosing a
// toolchain, and which toolchain built a published artifact is a release decision rather than a
// packaging one.
//
// It does not publish. Creating a release and publishing an npm package are separate acts, they are
// not reversible, and each needs its own authorization. Nothing here reaches a network.
//
// Usage:
//   node scripts/assemble-release.mjs --binary PATH --target KEY [--out DIR]
//
// The archive it writes and the digest it records are what the launcher will verify, so the two are
// produced by the same run: a digest computed separately from the archive is a digest of something
// that might not be the archive.

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  chmodSync,
  copyFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { TARGETS, resolveTarget, archiveName } from "../lib/targets.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function fail(message) {
  process.stderr.write(`ASSEMBLY_REFUSED: ${message}\n`);
  process.exit(2);
}

function option(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
}

const binary = option("binary");
const key = option("target");
const out = option("out") ?? join(root, "dist");

if (!binary || !key) {
  fail("usage: assemble-release.mjs --binary PATH --target KEY [--out DIR]");
}
if (!TARGETS[key]) {
  fail(`\`${key}\` is not a published target; they are ${Object.keys(TARGETS).sort().join(", ")}`);
}
if (!existsSync(binary)) fail(`${binary} is not there`);

const target = resolveTarget(key.slice(0, key.indexOf("-")), key.slice(key.indexOf("-") + 1));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const archive = archiveName(version, target);

// The binary is verified to be the product before it is packaged. An assembler that packaged whatever
// it was pointed at would publish an archive named for NostDB containing something else, and the
// digest would faithfully describe the wrong file.
//
// Skipped when the binary cannot run here, which is every cross-target assembly. That is stated
// rather than silently passed over: a cross-assembled archive carries one fewer check than a native
// one, and whoever reads the release should know which they have.
let attested = false;
const native = `${process.platform}-${process.arch}`;
if (key === native) {
  const run = spawnSync(binary, ["--version", "--json"], { encoding: "utf8" });
  if (run.status !== 0) fail(`${binary} does not answer --version --json`);
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    fail(`${binary} answered --version --json with something that is not JSON`);
  }
  if (report.product !== "nostdb") fail(`${binary} reports product ${report.product}`);
  if (report.engine_version !== version) {
    fail(`${binary} reports ${report.engine_version} and this package is ${version}`);
  }
  // Section 25.3: every route reports compatible contract data. An archive whose binary reported no
  // contracts would satisfy a version check and tell a caller nothing.
  const contracts = Object.keys(report).filter((k) => k.endsWith("_versions"));
  if (contracts.length < 5) fail(`${binary} reports only ${contracts.length} contracts`);
  attested = true;
  process.stderr.write(`attested: ${binary} is nostdb ${version} reporting ${contracts.length} contracts\n`);
} else {
  process.stderr.write(`not attested: ${key} is not ${native}, so this binary was not run\n`);
}

mkdirSync(out, { recursive: true });
const staging = join(out, `.staging-${key}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
const staged = join(staging, target.binary);
copyFileSync(binary, staged);
// Executable in the archive, because a tar that lost the bit produces an install nothing can run.
chmodSync(staged, 0o755);

// A fixed modification time, because an archive records one and the staged copy's is whenever this
// ran. Without it two assemblies of the same binary produce different archives, and a digest then
// says two identical releases are different releases — which is exactly what the reproducibility
// check found.
//
// The value is arbitrary and therefore stated: the first second of 2020, in UTC. What matters is that
// it does not move, not which instant it is.
const FIXED_MTIME = new Date("2020-01-01T00:00:00Z");
utimesSync(staged, FIXED_MTIME, FIXED_MTIME);

const archivePath = join(out, archive);
rmSync(archivePath, { force: true });

// Reproducible flags where the tool has them: a fixed owner, a fixed mtime, and sorted entries. Two
// assemblies of the same binary should produce the same archive, or a digest says two identical
// releases are different releases.
// Two steps rather than a pipeline, and each status checked.
//
// A pipeline reports its *last* command's status. The first release matrix produced two 20-byte
// archives — an empty gzip stream — and reported success, because `tar` had failed and `gzip`
// compressed nothing perfectly well. The assembler then recorded a digest that faithfully described
// an empty archive.
//
// The cause was a flag: `--uid`/`--gid` are BSD tar's, GNU tar has `--owner`/`--group`, so the same
// command worked on macOS and failed on Linux. Only flags both accept are used now, and the
// verification below is what makes the class of bug visible rather than this one instance.
//
// `gzip -n` as a separate program rather than tar's `-z`, because gzip embeds a timestamp and the
// `GZIP=-n` variable that used to suppress it is deprecated and ignored by newer versions.
const run = (program, args) => {
  const done = spawnSync(program, args, { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (done.status !== 0) {
    fail(`${program} failed: ${done.stderr?.trim() || `exit ${done.status}`}`);
  }
  return done;
};

if (target.archive === "zip") {
  run("zip", ["-X", "-q", "-j", archivePath, staged]);
} else {
  const uncompressed = `${archivePath.replace(/\.gz$/, "")}`;
  rmSync(uncompressed, { force: true });
  run("tar", ["--format=ustar", "--numeric-owner", "-cf", uncompressed, "-C", staging, target.binary]);
  const compressed = run("sh", ["-c", 'gzip -n -9 -c "$1" > "$2"', "sh", uncompressed, archivePath]);
  void compressed;
  rmSync(uncompressed, { force: true });
}

// What was produced, checked by looking inside it. An assembler that never opened its own archive is
// one that can ship an empty release, which is exactly what happened.
const listed =
  target.archive === "zip"
    ? run("unzip", ["-Z1", archivePath]).stdout
    : run("tar", ["-tzf", archivePath]).stdout;
const entries = listed.split("\n").map((line) => line.trim()).filter(Boolean);
if (entries.length !== 1 || entries[0] !== target.binary) {
  fail(`the archive holds ${JSON.stringify(entries)} and should hold exactly ["${target.binary}"]`);
}
if (statSync(archivePath).size < 1024) {
  // A real binary compresses to hundreds of kilobytes. Anything this small is an empty or truncated
  // archive whose listing happened to look right.
  fail(`${archivePath} is ${statSync(archivePath).size} bytes, which is not a packaged binary`);
}

rmSync(staging, { recursive: true, force: true });

const bytes = statSync(archivePath).size;
const digestOf = (path) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;

// Two entries per target, and both matter. The archive digest is what a Homebrew formula and a
// release page verify; the binary digest is what the launcher verifies after unpacking, because by
// then the archive is gone and the file on disk is what runs.
const entry = {
  [archive]: { bytes, digest: digestOf(archivePath), attested },
  [`${archive}#${target.binary}`]: { bytes: statSync(binary).size, digest: digestOf(binary), attested },
};

const record = join(out, `${key}.json`);
writeFileSync(record, `${JSON.stringify(entry, null, 2)}\n`);

process.stdout.write(`${archivePath}\n`);
process.stderr.write(`recorded ${Object.keys(entry).length} digests in ${record}\n`);
