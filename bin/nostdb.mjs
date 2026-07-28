#!/usr/bin/env node
// The unscoped `nostdb` launcher.
//
// It resolves the artifact this machine needs, verifies it against the checksums this package ships,
// and executes it. It implements no database behaviour: `docs/PRD.md` section 25.1 says outright that
// this does not reimplement Core in JavaScript, and there is nothing here that could.
//
// # It does not interpret arguments
//
// Everything after the program name is forwarded untouched, and the native exit code is reported
// unchanged. Section 25.3 requires every install route to report compatible
// `nostdb --version --json` data, and the only way to be sure of that is to not be in the way: a
// launcher that answered `--version` itself would be reporting on the launcher.

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTarget, archiveName, UnsupportedPlatform } from "../lib/targets.mjs";
import { verifyArtifact, recordedFor, ArtifactRefused } from "../lib/verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/// Exit classes the launcher itself reports, taken from the product contract's own numbering so a
/// script sees one vocabulary whichever layer refused.
const EXIT = { unavailable: 5, io: 9, internal: 10 };

function refuse(code, message, status) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exit(status);
}

async function main() {
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

  let target;
  try {
    target = resolveTarget(process.platform, process.arch);
  } catch (cause) {
    if (cause instanceof UnsupportedPlatform) {
      // Named, with the list. A user on an unpublished platform can build from source, and section
      // 25.3 publishes that route — so the refusal says so rather than only saying no.
      process.stderr.write(`${cause.code}: ${cause.message}\n`);
      if (cause.buildable) {
        // Section 25.3 publishes a source route, and it is the honest suggestion for a platform
        // nobody has built a release for. It is *not* the honest suggestion for one the product does
        // not compile on, which would fail for the same reason and waste a toolchain install.
        process.stderr.write(
          "install from source instead:\n" +
            `  cargo install --git https://github.com/nostdb/nostdb-cli --tag v${manifest.version} --locked nostdb\n`,
        );
      }
      process.exit(EXIT.unavailable);
    }
    throw cause;
  }

  const binary = join(root, "artifacts", target.key, target.binary);
  if (!existsSync(binary)) {
    // Nothing is fetched here. A launcher that downloaded on first use would make the first run of
    // any command a network operation, and `nostdb check` on a plane would fail for a reason
    // unrelated to the file it was checking. Fetching belongs to install, and says so.
    const archive = archiveName(manifest.version, target);
    refuse(
      "DISTRIBUTION_ARTIFACT_MISSING",
      `no native artifact for ${target.key} is installed.\n` +
        `  expected: ${binary}\n` +
        `  from:     ${archive}\n` +
        "  run `npm rebuild nostdb`, or reinstall the package, to fetch and verify it",
      EXIT.unavailable,
    );
  }

  // Verified on every run, not only at install. An artifact replaced after installation is the case
  // a check at install time cannot see, and it is the case worth catching.
  try {
    const checksums = JSON.parse(await readFile(join(root, "checksums.json"), "utf8"));
    const archive = archiveName(manifest.version, target);
    await verifyArtifact(binary, recordedFor(checksums, `${archive}#${target.binary}`));
  } catch (cause) {
    if (cause instanceof ArtifactRefused) {
      refuse(cause.code, cause.message, EXIT.io);
    }
    if (cause.code === "ENOENT") {
      refuse(
        "DISTRIBUTION_CHECKSUMS_MISSING",
        "this package ships no checksums.json, so nothing can be verified",
        EXIT.internal,
      );
    }
    throw cause;
  }

  // The argument vector, forwarded. Never a shell: a launcher that built a command string would let
  // an argument a user typed become something the shell interpreted.
  const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
  child.on("error", (cause) => refuse("DISTRIBUTION_LAUNCH_FAILED", cause.message, EXIT.io));
  child.on("close", (status, signal) => {
    // The native exit code, unchanged. A launcher that normalised it would break every script that
    // branches on the product's own exit classes.
    if (signal) {
      process.stderr.write(`DISTRIBUTION_LAUNCH_FAILED: nostdb was stopped by ${signal}\n`);
      process.exit(EXIT.io);
    }
    process.exit(status ?? EXIT.internal);
  });
}

main().catch((cause) => {
  process.stderr.write(`DISTRIBUTION_LAUNCH_FAILED: ${cause?.stack ?? cause}\n`);
  process.exit(EXIT.internal);
});
