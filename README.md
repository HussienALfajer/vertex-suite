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
| [`docs/core-features.md`](docs/core-features.md) | The 182 features across 16 modules, each with a stable identifier and, where it matters, an acceptance criterion                 |
| [`docs/modules.md`](docs/modules.md)             | How those features decompose into modules, what each module owns, which may depend on which, and the order they are built in     |
| [`docs/design-system.md`](docs/design-system.md) | The interface layer — generated palette with measured contrast, Arabic-derived type scale, three densities, keyboard conventions |

Every feature identifier (`FIN-02`, `POS-10`, `FX-07`) is permanent. Branches, commits, tests and
comments reference them.

## Layout

```
packages/kernel      exact money, quantities and rounding
packages/…           platform, contracts, ui, i18n, modules, adapters
apps/…               store-node, register, back-office, count-app
editions/            which modules and switches ship to a given customer
```

## Working on it

Requires Node 24 (see `.nvmrc`) and pnpm.

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs formatting, linting, type-checking, tests and the build — the same command CI
runs on Windows and Linux. Nothing merges that does not pass it.

| Command          |                                          |
| ---------------- | ---------------------------------------- |
| `pnpm verify`    | everything, in the order CI runs it      |
| `pnpm test`      | tests only                               |
| `pnpm typecheck` | types only                               |
| `pnpm lint`      | lint only                                |
| `pnpm format`    | rewrite files to the formatter's opinion |

## Conventions

- **Dependencies are pinned exactly.** A build of a given tag produces the same bytes, because
  update packages are signed and a signature over a moving target means nothing.
- **No business figure originates from a float.** Money, quantities, costs and rates are exact
  decimals from parse to storage; the linter rejects the alternatives.
- **Rounding happens at defined points and records its residual** (`FX-07`). `Math.round` is
  banned in the kernel.

---

© Vertex Suite. All rights reserved. Not open source — see [`LICENSE`](LICENSE).
