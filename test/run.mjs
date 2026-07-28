// Every check this package can make without a release.
//
// Platform resolution and artifact checksums are what `docs/PRD.md` section 25.1 requires be tested
// "for every supported release target", and both are testable with no network and no release: one is
// a table, and the other is a digest over bytes this suite writes itself.
//
// What is *not* testable here is a real `npm install nostdb`, because nothing has been published.
// That is named in the root progress record rather than papered over.

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { TARGETS, resolveTarget, archiveName, UnsupportedPlatform } from "../lib/targets.mjs";
import { verifyArtifact, recordedFor, digestFile, ArtifactRefused } from "../lib/verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
let failures = 0;
let checks = 0;

function check(what, condition, detail = "") {
  checks += 1;
  if (condition) console.log(`ok   ${what}`);
  else {
    console.error(`FAIL ${what}${detail ? `: ${detail}` : ""}`);
    failures += 1;
  }
}

async function refuses(what, code, run) {
  checks += 1;
  try {
    await run();
    console.error(`FAIL ${what}: it was accepted`);
    failures += 1;
  } catch (cause) {
    if (cause.code === code) console.log(`ok   ${what}`);
    else {
      console.error(`FAIL ${what}: reported ${cause.code} rather than ${code}`);
      failures += 1;
    }
  }
}

// ---- platform resolution, for every published target ----

const keys = Object.keys(TARGETS);
check("every published target is named", keys.length === 6, String(keys.length));
for (const key of keys) {
  const [platform, arch] = [key.slice(0, key.indexOf("-")), key.slice(key.indexOf("-") + 1)];
  const target = resolveTarget(platform, arch);
  check(`${key} resolves`, target.key === key);
  check(`${key} names a triple`, /^[a-z0-9_]+-[a-z0-9-]+$/.test(target.triple), target.triple);
  // Windows binaries carry .exe and nothing else does. A launcher that spawned `nostdb` on Windows
  // would spawn nothing.
  const expected = platform === "win32" ? "nostdb.exe" : "nostdb";
  check(`${key} names ${expected}`, target.binary === expected, target.binary);
  check(
    `${key} archives as ${platform === "win32" ? "zip" : "tar.gz"}`,
    target.archive === (platform === "win32" ? "zip" : "tar.gz"),
  );
  check(
    `${key} produces one archive name`,
    archiveName("1.2.3", target) === `nostdb-1.2.3-${target.triple}.${target.archive}`,
    archiveName("1.2.3", target),
  );
}

// Every triple is distinct: two targets resolving to one archive would have one overwrite the other
// in a release.
const triples = new Set(keys.map((key) => TARGETS[key].triple));
check("every target has its own triple", triples.size === keys.length);

// Refused rather than guessed. A fallback to the nearest target runs a binary built for another
// machine, and that crashes somewhere unrelated.
for (const [platform, arch] of [
  ["freebsd", "x64"],
  ["linux", "riscv64"],
  ["darwin", "ia32"],
  ["", ""],
]) {
  checks += 1;
  try {
    resolveTarget(platform, arch);
    console.error(`FAIL ${platform}-${arch} resolved`);
    failures += 1;
  } catch (cause) {
    const named = cause instanceof UnsupportedPlatform && cause.message.includes("darwin-arm64");
    if (named) console.log(`ok   ${platform}-${arch} is refused, and the published targets are named`);
    else {
      console.error(`FAIL ${platform}-${arch}: ${cause.message}`);
      failures += 1;
    }
  }
}

// This machine is one of them, or this package could not run here at all.
check(
  `this machine (${process.platform}-${process.arch}) is a published target`,
  Boolean(TARGETS[`${process.platform}-${process.arch}`]),
);

// ---- checksums ----

const scratch = mkdtempSync(join(tmpdir(), "nostdb-dist-"));
const artifact = join(scratch, "nostdb");
const bytes = Buffer.from("not a real engine, but a real file\n");
writeFileSync(artifact, bytes);
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

check("a digest is sha256 and lower-case hex", /^sha256:[0-9a-f]{64}$/.test(await digestFile(artifact)));
check("and it is the digest of the bytes", (await digestFile(artifact)) === digest);

const recorded = { bytes: bytes.length, digest };
check("an artifact matching what was recorded is accepted", (await verifyArtifact(artifact, recorded)) === digest);

await refuses("a truncated artifact is refused as truncated, not as tampered", "DISTRIBUTION_ARTIFACT_TRUNCATED", () =>
  verifyArtifact(artifact, { bytes: bytes.length + 1, digest }),
);
await refuses("an artifact that is not the one recorded is refused", "DISTRIBUTION_DIGEST_MISMATCH", () =>
  verifyArtifact(artifact, { bytes: bytes.length, digest: `sha256:${"0".repeat(64)}` }),
);
await refuses("an absent artifact is refused as absent", "DISTRIBUTION_ARTIFACT_MISSING", () =>
  verifyArtifact(join(scratch, "absent"), recorded),
);

// The checksums document itself.
const manifest = { checksums_version: 1, version: "0.1.0", artifacts: { "a.tar.gz#nostdb": recorded } };
check("a recorded artifact is found", recordedFor(manifest, "a.tar.gz#nostdb").digest === digest);
for (const [what, document, archive] of [
  ["an unrecorded archive", manifest, "b.tar.gz#nostdb"],
  ["an empty document", { artifacts: {} }, "a.tar.gz#nostdb"],
  ["a missing document", {}, "a.tar.gz#nostdb"],
]) {
  checks += 1;
  try {
    recordedFor(document, archive);
    console.error(`FAIL ${what} was accepted`);
    failures += 1;
  } catch (cause) {
    if (cause.code === "DISTRIBUTION_ARTIFACT_UNRECORDED") console.log(`ok   ${what} is refused`);
    else {
      console.error(`FAIL ${what}: ${cause.code}`);
      failures += 1;
    }
  }
}
for (const [what, entry] of [
  ["a digest with no algorithm", { bytes: 1, digest: "0".repeat(64) }],
  ["an upper-case digest", { bytes: 1, digest: `sha256:${"A".repeat(64)}` }],
  ["a short digest", { bytes: 1, digest: `sha256:${"0".repeat(63)}` }],
  ["no byte count", { digest }],
  ["a zero byte count", { bytes: 0, digest }],
]) {
  checks += 1;
  try {
    recordedFor({ artifacts: { "a#b": entry } }, "a#b");
    console.error(`FAIL ${what} was accepted`);
    failures += 1;
  } catch (cause) {
    if (cause.code === "DISTRIBUTION_CHECKSUMS_INVALID") console.log(`ok   ${what} is refused`);
    else {
      console.error(`FAIL ${what}: ${cause.code}`);
      failures += 1;
    }
  }
}

// ---- the launcher, with no artifact present ----

// This is the state the package is actually in: nothing is published, so nothing is installed. What
// it must not do is fail obscurely.
{
  const run = spawnSync(process.execPath, [join(root, "bin", "nostdb.mjs"), "help"], {
    encoding: "utf8",
  });
  check("with no artifact the launcher refuses", run.status === 5, `exit ${run.status}`);
  check(
    "and names what is missing and how to get it",
    run.stderr.includes("DISTRIBUTION_ARTIFACT_MISSING") && run.stderr.includes("npm rebuild"),
    run.stderr,
  );
  check("and writes nothing to stdout", run.stdout === "", run.stdout);
}

// A platform with no release says so, and points at the source route section 25.3 publishes.
{
  const probe = join(scratch, "probe.mjs");
  writeFileSync(
    probe,
    `import { resolveTarget } from ${JSON.stringify(join(root, "lib", "targets.mjs"))};\n` +
      `try { resolveTarget("freebsd", "x64"); } catch (e) { console.log(e.code); }\n`,
  );
  const run = spawnSync(process.execPath, [probe], { encoding: "utf8" });
  check("an unpublished platform reports its own code", run.stdout.trim() === "DISTRIBUTION_UNSUPPORTED_PLATFORM", run.stdout);
}

// The shipped checksums document is real JSON and states its own version, empty or not.
{
  const shipped = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(join(root, "checksums.json"), "utf8")));
  check("the shipped checksums state a version", shipped.checksums_version === 1);
  check("and an artifacts object", typeof shipped.artifacts === "object" && shipped.artifacts !== null);
}

rmSync(scratch, { recursive: true, force: true });

if (failures > 0) {
  console.error(`${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`distribution: every check passed (${checks})`);
