# nostdb-distribution

The unscoped `nostdb` npm package: a thin launcher for the verified native CLI and Engine.

**Status: not published.** No release exists, so no artifact exists to fetch and `checksums.json`
records none. The launcher refuses by name and says what is missing rather than failing obscurely,
and the suite covers platform resolution and checksum verification, which are testable without one.

## What it does

```text
nostdb <arguments>
  → resolve this platform to a published release target
  → verify the installed artifact against the checksums this package ships
  → execute it, forwarding the arguments and reporting its exit code unchanged
```

It implements no database behavior. `docs/PRD.md` section 25.1 says outright that this does not
reimplement Core in JavaScript, and there is nothing here that could.

## Why the checksums ship inside the package

`checksums.json` is part of the npm tarball. An artifact is downloaded from a release and checked
against a digest that travelled by a different route, so somebody who can serve a substituted
artifact cannot also serve the digest that would accept it.

A checksum fetched from beside the artifact verifies that the file arrived intact. It does not verify
that it is the right file, which is the question worth asking.

## Why verification happens on every run

An artifact replaced after installation is the case an install-time check cannot see, and it is the
case worth catching. The cost is one digest per invocation; the alternative is trusting a check that
happened once, on a file anything with write access could have changed since.

## Published targets

| Platform | Target |
| --- | --- |
| macOS arm64 | `aarch64-apple-darwin` |
| macOS x64 | `x86_64-apple-darwin` |
| Linux arm64 | `aarch64-unknown-linux-gnu` |
| Linux x64 | `x86_64-unknown-linux-gnu` |
| Windows arm64 | `aarch64-pc-windows-msvc` |
| Windows x64 | `x86_64-pc-windows-msvc` |

A platform not in that table is refused by name, with the list and the source-install route:

```bash
cargo install --git https://github.com/nostdb/nostdb-cli --tag <version> --locked nostdb
```

Guessing the nearest target would run a binary built for another machine, and that fails somewhere
unrelated to the cause.

## Verify

```bash
./scripts/verify-repository.sh
```

## Licence

Apache-2.0. `docs/PRD.md` section 33 names a licence for every other repository and not for this
one; the reasoning for Apache-2.0 here is recorded in the root `IMPLEMENTATION_PROGRESS.md` under
Stage 12 rather than assumed. A launcher that installs source-available binaries is not itself that
work, and a copyleft licence on it would make packaging NostDB for a distribution needlessly fraught.
