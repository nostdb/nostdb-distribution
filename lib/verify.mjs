// Verifying an artifact before anything runs it.
//
// # Why the checksums ship inside the package
//
// `checksums.json` is part of the npm tarball. An artifact is downloaded from a release and checked
// against a digest that travelled by a different route, so an attacker who can serve a substituted
// artifact cannot also serve the digest that would accept it.
//
// A checksum fetched from beside the artifact verifies that the file arrived intact. It does not
// verify that it is the right file, which is the question worth asking.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

/** Why an artifact was refused. */
export class ArtifactRefused extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** The SHA-256 of a file, as `sha256:` and lower-case hexadecimal. */
export async function digestFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Checks an artifact against the digest and length the package recorded for it.
 *
 * Both are checked, and the length first: a truncated download whose prefix happened to be a
 * legitimate archive would otherwise be caught only by the digest, and reporting "the digest does not
 * match" for a file that is simply half-downloaded sends somebody looking for tampering.
 *
 * @param {string} path the downloaded artifact
 * @param {{bytes: number, digest: string}} expected what the package recorded
 */
export async function verifyArtifact(path, expected) {
  let found;
  try {
    found = await stat(path);
  } catch (cause) {
    throw new ArtifactRefused("DISTRIBUTION_ARTIFACT_MISSING", `${path} is not there: ${cause.message}`);
  }
  if (found.size !== expected.bytes) {
    throw new ArtifactRefused(
      "DISTRIBUTION_ARTIFACT_TRUNCATED",
      `${path} is ${found.size} bytes and ${expected.bytes} was recorded`,
    );
  }
  const digest = await digestFile(path);
  if (digest !== expected.digest) {
    // Refused, never repaired and never retried into acceptance. An artifact that is not the one
    // recorded is not one a retry makes right.
    throw new ArtifactRefused(
      "DISTRIBUTION_DIGEST_MISMATCH",
      `${path} digests ${digest} and ${expected.digest} was recorded`,
    );
  }
  return digest;
}

/**
 * Reads the entry a release recorded for one archive.
 *
 * @param {{version: string, artifacts: Record<string, {bytes: number, digest: string}>}} checksums
 * @param {string} archive
 */
export function recordedFor(checksums, archive) {
  const entry = checksums?.artifacts?.[archive];
  if (!entry) {
    throw new ArtifactRefused(
      "DISTRIBUTION_ARTIFACT_UNRECORDED",
      `this package records no checksum for ${archive}, so it cannot verify one`,
    );
  }
  if (typeof entry.bytes !== "number" || !Number.isInteger(entry.bytes) || entry.bytes <= 0) {
    throw new ArtifactRefused("DISTRIBUTION_CHECKSUMS_INVALID", `${archive} records no byte count`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(entry.digest ?? "")) {
    throw new ArtifactRefused(
      "DISTRIBUTION_CHECKSUMS_INVALID",
      `${archive} records ${entry.digest}, which is not sha256 and 64 lower-case hex`,
    );
  }
  return entry;
}
