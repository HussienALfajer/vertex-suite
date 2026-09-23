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
packages/contracts   the shared vocabulary: identifiers, permission grammar, seeded roles
packages/i18n        messages, terminology, direction
packages/ui          the design system, and the map
packages/modules/…   sys, sec, fx, fin — and the twelve to come
apps/back-office     the administration screens, over the authenticated store-node transport
apps/sandbox         where the components are looked at and keyboard journeys run
apps/store-node      the PostgreSQL-backed module host and authenticated HTTP transport
```

Still to come, in the order `docs/modules.md` §7 builds them: `apps/register`,
`apps/count-app` and `editions/`.

## Working on it

Requires Node 24 (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs the build, then formatting, linting, type-checking and tests — the same command
CI runs on Windows and Linux. Nothing merges that does not pass it.

To run the store node, set `VERTEX_POSTGRES_URL`, `VERTEX_SCHEMA`,
`VERTEX_ATTACHMENTS_DIR`, `VERTEX_TENANT` (a tenant UUID),
`VERTEX_OWNER_HANDLE`, and `VERTEX_OWNER_PASSWORD`, then run
`pnpm --filter @vertex/store-node start` after `pnpm build`. `PORT` defaults to
5182 and `HOST` to 127.0.0.1. Startup runs the store-node migrations and seeds
the named tenant's owner if needed. Start the back office with the same tenant
as `VITE_VERTEX_TENANT`; its development proxy targets the store node at
127.0.0.1:5182, or at `VERTEX_STORE_NODE_URL` when set. A production web server
must forward `/api` to the store node, or set `VITE_VERTEX_API_URL` to its
reachable API path at build time. `pnpm demo` remains an isolated fixture.

The PostgreSQL integration tests use `VERTEX_TEST_POSTGRES_URL`. They create
unique schemas and remove them after each journey; CI requires this variable.

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

| Command          |                                             |
| ---------------- | ------------------------------------------- |
| `pnpm verify`    | everything, in the order CI runs it         |
| `pnpm test`      | tests only                                  |
| `pnpm typecheck` | types only                                  |
| `pnpm lint`      | lint only                                   |
| `pnpm format`    | rewrite files to the formatter's opinion    |
| `pnpm e2e`       | the keyboard journeys, in a browser         |
| `pnpm next`      | the next unit, derived from the documents   |
| `pnpm demo`      | the back office, over a shop already set up |

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
