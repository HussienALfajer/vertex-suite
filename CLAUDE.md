# Working in this repository

Arabic-first, offline-first retail management, built as the **source of a product line**: one
codebase, per-customer editions. `README.md` carries the layout and the conventions the build
enforces — read it first.

## Finding the work

```bash
pnpm next
```

Prints the next unit in build order, the features it owns, and their acceptance criteria —
derived from the specification every time it runs, so there is nothing to keep up to date. If it
says a slice is already in progress on a branch, `pnpm test` shows what is left of it.

The specification is three documents and nothing else:

- `docs/core-features.md` — the 182 features, each with a permanent identifier
- `docs/modules.md` — modules, what each owns, what may depend on what, and the build order
- `docs/design-system.md` — the interface layer

Identifiers (`FIN-02`, `POS-10`, `FX-07`) are permanent, and are what tests, commits and comments
reference. **Do not add documents.** A decision belongs in the code that carries it out and in
the message of the commit that made it; an architecture or rules document was considered and
refused, and a plan file is a third copy of something the specification already says.

## How a slice is built

1. A branch — `feat/U04.2-organisation-structure`.
2. **Acceptance tests first, failing**, written from the feature's own words, with the feature
   identifier in the test name: `describe('VertexProvider — SYS-01', …)`. The name is the claim
   that this feature behaves as specified, and `pnpm check:coverage` reads only names — a
   feature mentioned in a comment explains why code is shaped as it is, which is a lesser claim.
3. Implement until they pass.
4. `pnpm verify` — build, format, lint, policy, types, tests, coverage, in that order and for the
   reasons `README.md` gives. Nothing is committed without it. `pnpm e2e` as well whenever the
   change is visible on a screen.
5. `/code-review high`. Add `/security-review` when the change touches identity, permissions or
   the boundary between tenants. Act on what they find.
6. A pull request, merged only once all four CI jobs are green — `verify` and `journeys`, on
   Windows and on Linux.

A unit is finished when every feature it names has a passing test that names it. Assert that by
adding the unit to `DELIVERED` in `tools/spec.mjs`; `pnpm check:coverage` audits the assertion
immediately and fails if it is not yet true.

## Writing here

Match the file you are editing. Comments say **why** — the constraint, the failure being
prevented, the alternative that was rejected and what it cost. Commit messages argue for the
change rather than listing it. Tests read as statements about behaviour, and a test that
encodes a decision explains the decision.

Node 24 and pnpm, with every dependency pinned exactly. Windows is the certified store-node and
register platform and Linux is the cloud target; both run in CI from the first commit, so neither
can drift. No business figure originates from a float, no moment from the ambient clock, and no
identifier from a weak source — the linter refuses all three rather than trusting anyone to
remember.

Other repositories on this machine are not part of this project. Do not read from them or draw on
them.
