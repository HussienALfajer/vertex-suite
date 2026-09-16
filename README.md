# Vertex Suite

A retail management system, built as the **source of a product line** rather than as a single
application. One codebase produces per-customer editions: a chosen set of modules, the tenant's
own branding and terminology, deployed on a machine in the shop or in the cloud.

Arabic-first. Offline-first at the register. Multi-currency, with an immutable double-entry
ledger underneath everything.

## The documents

Read them in this order. They are the specification; the code answers to them.

| Document                                         | What it settles                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/core-features.md`](docs/core-features.md) | The 183 features across 16 modules, each with a stable identifier and, where it matters, an acceptance criterion                 |
| [`docs/modules.md`](docs/modules.md)             | How those features decompose into modules, what each module owns, which may depend on which, and the order they are built in     |
| [`docs/design-system.md`](docs/design-system.md) | The interface layer — generated palette with measured contrast, Arabic-derived type scale, three densities, keyboard conventions |

Every feature identifier (`FIN-02`, `POS-10`, `FX-07`) is permanent. Branches, commits, tests and
comments reference them.

## Layout

```
packages/kernel      exact money and quantities, identifiers, time, refusals
packages/platform    module registry, editions, event bus, unit of work
packages/…           contracts, ui, i18n, modules, adapters
apps/…               store-node, register, back-office, count-app
editions/            which modules and switches ship to a given customer
```

## Working on it

Requires Node 24 (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs the build, then formatting, linting, type-checking and tests — the same command
CI runs on Windows and Linux. Nothing merges that does not pass it.

The build comes **first** on purpose. A package consumes its neighbours through their built
`dist/`, so linting or type-checking before the build makes every cross-package import an
unresolved type — which passes on a machine that happens to have built earlier and fails on a
clean checkout.

`check:boundaries` sits in the middle, and the tests in `tools/` run before it. `docs/modules.md`
§4 says the thing that matters about the module boundary: it **decays silently**. Nothing fails
when a module reaches past another module's contract — the code compiles and the tests pass, and
the bill arrives years later as an edition that cannot drop a module the customer never bought.
So it is checked rather than trusted, and the checker is itself tested, because a check nobody
tests is one that stops catching things without saying so.

The coverage check comes **last**, for the mirror-image reason. `docs/modules.md` §7 defines a
unit as finished when the acceptance criteria of every feature it names are automated and
passing; `check:coverage` reads the feature list from `docs/core-features.md`, the ownership from
§8, and the proof from the names of the tests themselves, then fails if a feature of a delivered
unit has none. Running it after the suites means proven is a test that passed, not a test that
exists.

| Command          |                                           |
| ---------------- | ----------------------------------------- |
| `pnpm verify`    | everything, in the order CI runs it       |
| `pnpm test`      | tests only                                |
| `pnpm typecheck` | types only                                |
| `pnpm lint`      | lint only                                 |
| `pnpm format`    | rewrite files to the formatter's opinion  |
| `pnpm next`      | the next unit, derived from the documents |

## Conventions

- **Dependencies are pinned exactly.** A build of a given tag produces the same bytes, because
  update packages are signed and a signature over a moving target means nothing.
- **No business figure originates from a float.** Money, quantities, costs and rates are exact
  decimals from parse to storage; the linter rejects the alternatives.
- **Rounding happens at defined points and records its residual** (`FX-07`). `Math.round` is
  banned in the kernel.
- **No moment comes from the ambient clock.** Time is taken from a `Clock` the caller was handed,
  so a register whose machine clock is wrong can be corrected at one seam instead of none.
  `Date.now()` and a zero-argument `new Date()` fail lint.
- **Identifiers are generated where the record is.** UUIDv7 from a cryptographic source, on the
  device that made the record, so a register with no connection still sells and the day's
  documents still sort. `Math.random` and `crypto.randomUUID` fail lint.
- **A refusal is a value, a defect is an exception.** A credit limit reached is data that reaches
  the screen with its code and its figures; a null where there cannot be one throws.

---

© Vertex Suite. All rights reserved. Not open source — see [`LICENSE`](LICENSE).
