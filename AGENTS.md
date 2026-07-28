# nostdb-distribution Agent Instructions

## Inheritance

This repository is a child of the NostDB root superproject. The root `AGENTS.md`
at <https://github.com/nostdb/nostdb> is the governing contract.

This file only narrows the root rules for the distribution boundary. It must not weaken any
root product, safety, or ownership boundary. If this file and the root contract appear to
conflict, the root contract wins, the current valid behavior stays unchanged, and the exact
conflict is recorded in the root `IMPLEMENTATION_PROGRESS.md`.

## Language policy

Write everything in this repository in English only, regardless of the language a request is
written in.

## Ownership boundary

This repository is a launcher and a release assembler. It implements no database behavior.

Permitted:

- the unscoped `nostdb` npm package and its launcher;
- platform resolution for the published release targets;
- artifact checksum verification;
- release assembly, and the checksums document it writes.

Prohibited:

- **any reimplementation of Core in JavaScript.** `docs/PRD.md` section 25.1 says so outright.
  A launcher that parsed a `.nost`, opened a `.nostdb`, or answered a query would be a second
  Engine, and one written in the language least able to be held to the Engine's guarantees;
- a parser, storage engine, synchronizer, analyzer, or query engine;
- a plugin manager, which exists once in `nostdb-cli`;
- a copy of the root PRD;
- interpreting the arguments a user typed. They are forwarded untouched.

## Invariants this repository must never break

- **An artifact is verified before it is executed.** Every run, not only at install: an artifact
  replaced after installation is the case an install-time check cannot see.
- **The checksums ship inside the package.** An artifact and the digest that would accept it must
  not travel by the same route, or the digest verifies arrival rather than identity.
- **A digest mismatch is refused, never retried into acceptance.** An artifact that is not the one
  recorded is not one a retry makes right.
- **A platform with no release is refused by name**, with the published targets listed and the
  source-install route named. A fallback to the nearest target runs a binary built for another
  machine.
- **The native exit code is reported unchanged.** A launcher that normalized it would break every
  script branching on the product's exit classes.
- **No shell.** The argument vector is passed directly, so an argument a user typed never becomes
  something a shell interpreted.
- **No unpinned fetch.** A version resolved at run time is a version nobody reviewed.
- Secrets never reach a log record, a diagnostic, or output.

## Testing expectations

- platform resolution, for **every** published target, and a refusal for one that is not published;
- checksum verification: a match, a mismatch, a truncation reported as truncation rather than as
  tampering, an absent artifact, and a malformed checksums document;
- the launcher with no artifact present, which is the state the package is in before a release:
  it must refuse by name and say how to get one;
- the exit code a launch reports.

No test publishes anything, and no test fetches over the network. A suite that reached a registry
would test the registry.

## Safety and external actions

- Do not create remote repositories, add remotes, push to a new remote, **publish an npm package**,
  create a release, or modify a registry without explicit user authorization. Publishing is named
  separately from pushing because it is a separate act and it is not reversible.
- Never place a credential in a manifest, a workflow, a fixture, or output.
- Do not use destructive Git commands or broad deletion.

## Stage workflow

Implementation sequencing is tracked in the root `IMPLEMENTATION_PROGRESS.md`, not here.
