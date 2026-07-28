#!/bin/sh
# Independent verification for nostdb-distribution.
#
# The checks are about the boundary this repository must not cross and the suite that proves what it
# can prove without a release. Nothing here publishes, and nothing here reaches the network.
set -eu
cd "$(dirname "$0")/.."

for required in README.md AGENTS.md CLAUDE.md LICENSE package.json checksums.json \
    bin/nostdb.mjs lib/targets.mjs lib/verify.mjs test/run.mjs \
    scripts/assemble-release.mjs; do
  [ -e "$required" ] || { echo "missing required file: $required" >&2; exit 1; }
done

if [ ! -L CLAUDE.md ] || [ "$(readlink CLAUDE.md)" != "AGENTS.md" ]; then
  echo "CLAUDE.md must be a symlink to AGENTS.md" >&2
  exit 1
fi

if ! grep -q '^ *Apache License$' LICENSE; then
  echo "LICENSE must be the Apache License" >&2
  exit 1
fi

if [ ! -x bin/nostdb.mjs ]; then
  echo "bin/nostdb.mjs must be committed executable; npm links it as a command" >&2
  exit 1
fi

# No JavaScript Core. docs/PRD.md section 25.1 forbids it, and a launcher is small enough that a
# second Engine appearing in it would appear as one of these names.
#
# Searched in the launcher and the library only. An earlier version of this check in another
# repository fired on the document that *states* the prohibition, which is a mistake this project has
# now made four times: a check written against a string will fire on the text explaining the string.
if grep -rn -E '\b(parseNost|readNostdb|executeCypher|openDatabase)\b' bin lib 2>/dev/null; then
  echo "this package launches the Engine and never reimplements it" >&2
  exit 1
fi

# The arguments a user typed are forwarded, never assembled into a string a shell will re-split.
if grep -rn -E 'shell:\s*true|execSync|exec\(' bin lib 2>/dev/null; then
  echo "the argument vector is passed directly; no shell interprets it" >&2
  exit 1
fi

# A credential must never appear here. This repository holds a workflow that will one day hold a
# publish token, which is the moment this check earns its place.
if grep -rnE '\b(npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{16,})' . 2>/dev/null \
    | grep -v '^\./scripts/verify-repository.sh'; then
  echo "a credential must never appear in this repository" >&2
  exit 1
fi

if [ -e docs/PRD.md ] || [ -e src ] || [ -e Cargo.toml ]; then
  echo "the PRD lives once, elsewhere, and the Engine is not built here" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to verify the launcher" >&2
  exit 1
fi

# The version package.json declares, checked rather than assumed. A runner image ships whatever it
# ships, and a launcher tested on a newer Node than it claims to support is a launcher whose claim
# nobody checked.
node -e '
  const fs = require("node:fs");
  const want = JSON.parse(fs.readFileSync("package.json", "utf8")).engines.node.replace(">=", "");
  const [wm, wn] = want.split(".").map(Number);
  const [gm, gn] = process.versions.node.split(".").map(Number);
  if (gm < wm || (gm === wm && gn < wn)) {
    console.error(`node ${process.versions.node} is older than the declared ${want}`);
    process.exit(1);
  }
  console.log(`node ${process.versions.node} satisfies the declared >=${want}`);
'

node --check bin/nostdb.mjs
node --check lib/targets.mjs
node --check lib/verify.mjs
node --check test/run.mjs
node --check scripts/assemble-release.mjs

# The published version and the checksums document must agree, or the launcher would look up an
# archive name the release never wrote.
node -e '
  const fs = require("node:fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const sums = JSON.parse(fs.readFileSync("checksums.json", "utf8"));
  if (pkg.name !== "nostdb") { console.error("the package is unscoped `nostdb`"); process.exit(1); }
  if (pkg.version !== sums.version) {
    console.error(`package.json is ${pkg.version} and checksums.json is ${sums.version}`);
    process.exit(1);
  }
  if (sums.checksums_version !== 1) { console.error("checksums_version must be 1"); process.exit(1); }
  const files = pkg.files ?? [];
  for (const needed of ["bin/", "lib/", "checksums.json"]) {
    if (!files.includes(needed)) {
      console.error(`package.json files omits ${needed}, so a published package would not carry it`);
      process.exit(1);
    }
  }
  console.log("package: unscoped, versioned, and shipping its own checksums");
'

node test/run.mjs

echo "nostdb-distribution verification passed"
