# nostdb-distribution

The unscoped `nostdb` npm package: a thin launcher for the verified native CLI and Engine.

```bash
npm install --save-dev nostdb
npm install --global nostdb
npx --yes --package=nostdb@0.1.1 nostdb help
```

Installing fetches the native archive for this platform from the release, verifies it against the
digests this package ships, and unpacks it. A digest that does not match **fails the install**: a
package that installed an unverified binary would be worse than one that failed, because the failure
is visible and recoverable and the binary is not.

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

## Why the install verifies and the launcher verifies again

They answer different questions. The install asks whether the right bytes arrived. The launcher asks
whether they are still the bytes that arrived.

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
A platform not in that table is refused by name, with the list and the source-install route:

```bash
cargo install --git https://github.com/nostdb/nostdb-cli --tag <version> --locked nostdb
```

Guessing the nearest target would run a binary built for another machine, and that fails somewhere
unrelated to the cause.

### Windows

Windows is in the product contract — the daemon's endpoint contract specifies a named pipe for it —
and `nostdb-server` implements only the Unix domain socket, so **nothing in NostDB compiles for
Windows yet**. That was found by trying: the first release matrix built four targets and failed both
Windows ones.

A Windows user is told that rather than being told their platform is unpublished, and is **not**
offered the source-install command, which would fail for the same reason and waste a toolchain
install. Windows becomes a published target when the daemon has its named-pipe endpoint, which is
`nostdb-server`'s work and not this repository's.

## Verify

```bash
./scripts/verify-repository.sh
```

## Licence

Apache-2.0. `docs/PRD.md` section 33 names a licence for every other repository and not for this
one; the reasoning for Apache-2.0 here is recorded in the root `IMPLEMENTATION_PROGRESS.md` under
Stage 12 rather than assumed. A launcher that installs source-available binaries is not itself that
work, and a copyleft licence on it would make packaging NostDB for a distribution needlessly fraught.
