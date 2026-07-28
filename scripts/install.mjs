#!/usr/bin/env node
// Fetches and verifies the native artifact for this platform, at install time.
//
// # Why the download happens here and not on first use
//
// A launcher that fetched on first use would make the first run of any command a network operation.
// `nostdb check` on a plane would then fail for a reason unrelated to the file it was checking, and a
// script's first invocation would behave differently from its second. Installing is already a network
// operation, so this is where a network operation belongs.
//
// # What it refuses
//
// A digest that does not match fails the install. A package that installed an unverified binary would
// be worse than one that failed: the failure is visible and recoverable, and the binary is not.
//
// # What it does not refuse
//
// A platform with no published release exits successfully with a warning. Failing `npm install` for
// every project that happens to have this as a development dependency on an unpublished platform would
// break work unrelated to NostDB — and the launcher refuses clearly by name when it is actually run,
// which is the moment somebody wanted it.

import { readFile, writeFile, mkdir, rm, chmod, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTarget, archiveName, UnsupportedPlatform } from "../lib/targets.mjs";
import { recordedFor, ArtifactRefused } from "../lib/verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const say = (message) => process.stderr.write(`nostdb: ${message}\n`);

function stop(message) {
  say(message);
  process.exit(1);
}

async function main() {
  // A source checkout is not an install. `npm install` inside this repository would otherwise try to
  // fetch a release for a version that may not exist yet.
  if (existsSync(join(root, ".git"))) {
    say("this is a source checkout, so no artifact was fetched");
    return;
  }

  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const checksums = JSON.parse(await readFile(join(root, "checksums.json"), "utf8"));

  let target;
  try {
    target = resolveTarget(process.platform, process.arch);
  } catch (cause) {
    if (cause instanceof UnsupportedPlatform) {
      // Exits 0 on purpose. See the note at the top.
      say(cause.message);
      say("nothing was fetched; running `nostdb` will say the same thing");
      return;
    }
    throw cause;
  }

  const archive = archiveName(manifest.version, target);
  let expected;
  let expectedBinary;
  try {
    expected = recordedFor(checksums, archive);
    expectedBinary = recordedFor(checksums, `${archive}#${target.binary}`);
  } catch (cause) {
    if (cause instanceof ArtifactRefused) {
      stop(
        `${cause.message}\n` +
          "        this package was built before its release, so there is nothing to fetch",
      );
    }
    throw cause;
  }

  const into = join(root, "artifacts", target.key);
  const binary = join(into, target.binary);
  if (existsSync(binary)) {
    const already = createHash("sha256").update(await readFile(binary)).digest("hex");
    if (`sha256:${already}` === expectedBinary.digest) {
      say(`${target.key} is already installed and verified`);
      return;
    }
  }

  const url =
    `https://github.com/nostdb/nostdb-cli/releases/download/v${manifest.version}/${archive}`;
  say(`fetching ${archive}`);

  let bytes;
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      stop(`${url} answered ${response.status}; the release may not be published yet`);
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (cause) {
    stop(`${url} could not be fetched: ${cause.message}`);
  }

  // Verified before it touches the filesystem. An archive written first and checked second is one that
  // existed unverified, however briefly, and something else may have read it.
  if (bytes.length !== expected.bytes) {
    stop(`${archive} is ${bytes.length} bytes and ${expected.bytes} was recorded`);
  }
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== expected.digest) {
    stop(
      `${archive} digests ${digest} and this package recorded ${expected.digest}\n` +
        "        nothing was installed",
    );
  }

  await rm(into, { recursive: true, force: true });
  await mkdir(into, { recursive: true });
  const staged = join(into, archive);
  await writeFile(staged, bytes);

  const unpack =
    target.archive === "zip"
      ? spawnSync("unzip", ["-q", "-o", staged, "-d", into], { encoding: "utf8" })
      : spawnSync("tar", ["-xzf", staged, "-C", into], { encoding: "utf8" });
  await rm(staged, { force: true });
  if (unpack.status !== 0) {
    await rm(into, { recursive: true, force: true });
    stop(`${archive} could not be unpacked: ${unpack.stderr?.trim() ?? unpack.status}`);
  }

  if (!existsSync(binary)) {
    await rm(into, { recursive: true, force: true });
    stop(`${archive} does not contain ${target.binary}`);
  }

  // The archive's digest matched, and this is the file that will actually run. Checked separately
  // because unpacking is a step between them, and the launcher verifies this one on every run.
  const unpackedDigest = `sha256:${createHash("sha256").update(await readFile(binary)).digest("hex")}`;
  if (unpackedDigest !== expectedBinary.digest) {
    await rm(into, { recursive: true, force: true });
    stop(`${target.binary} digests ${unpackedDigest} and ${expectedBinary.digest} was recorded`);
  }

  await chmod(binary, 0o755);
  const size = (await stat(binary)).size;
  say(`installed ${target.key}, ${size} bytes, verified`);
}

main().catch((cause) => {
  say(`the install failed: ${cause?.stack ?? cause}`);
  process.exit(1);
});
