# Vertex Suite — Module Map and Build Order

The 182 features of `core-features.md` decomposed into 16 modules and 30 build units.

This document answers three questions and no others:

1. **What are the parts, and what does each one own?** (§2, §3, §6)
2. **Which part may depend on which?** (§4, §5)
3. **In what order are they built?** (§7, §8)

It holds no rules about how code is written. Where it and `core-features.md` disagree, the feature wins and this document is corrected.

---

## 1. Why modules at all

Two reasons, and they happen to demand the same shape.

**A customer buys a subset.** The unit of subtraction is the **module**, never the feature. `POS-10` cannot be removed without `FX-06`, `CSH-01` and `FIN-02`; a module can be removed because its edges are declared. An edition is a list of modules plus a list of feature switches — not a copy of the source.

**The work is done by one person and an agent.** A module with a declared edge can be built, reviewed and tested without the other fifteen in context. Modules that reach into each other cannot be worked on in isolation by anyone, human or otherwise.

---

## 2. Package map

```
packages/
  kernel/          money · quantity · decimal · identifiers · clock · result
  platform/        module registry · event bus · unit of work · outbox · entitlements
  contracts/       shared types · event schemas · permission ids · account codes
  ui/              the design system of design-system.md
  i18n/            strings · terminology resolution
  modules/
    sys/ sec/ fin/ fx/ cat/ prc/ stk/ pur/ sal/ csh/ pos/ cnt/ rpt/ hw/ syn/ mig/
  adapters/
    print-escpos/ · scale-format/ · payment-cash/ · storage-file/ · storage-object/
apps/
  store-node/      the system of record — identical code on-premise and in cloud
  register/        the till
  back-office/     administration, purchasing, reporting
  count-app/       stocktaking over the shop network
editions/
  *.json           which modules and switches ship to a given customer
```

`kernel` and `contracts` know nothing about any module. `platform` knows how to host a module but not what any module does. No module imports another module's internals — only its published contract.

---

## 3. The sixteen modules

**Layer** states how deeply a module is wired in, and therefore what it costs to leave out.

| Code  | Module                    | Layer    | Owns                                                                                                                      | Depends on                               | Feat. |
| ----- | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----- |
| `SYS` | System foundations        | **core** | Tenant · company · branch · location · register · numbering series · business profile · templates · terminology · licence | —                                        | 13    |
| `SEC` | Roles, permissions, audit | **core** | User · role · permission grant · audit record · session · device                                                          | `SYS`                                    | 9     |
| `FX`  | Currencies and rates      | **core** | Currency · rate revision · rounding rule · redenomination factor                                                          | `SYS`                                    | 11    |
| `FIN` | Financial core            | **core** | Account · journal entry · journal line · fiscal year · period                                                             | `FX` `SYS` `SEC`                         | 8     |
| `CAT` | Catalogue                 | **base** | Item · variant · barcode · unit of measure · category · item cost                                                         | `SYS` `SEC` `FX`                         | 16    |
| `PRC` | Pricing and promotions    | **base** | Price list · price · display price · promotion · price change record                                                      | `CAT` `FX` `SYS` `SEC`                   | 11    |
| `STK` | Inventory and stock       | **base** | Stock movement · batch · stock level cache · reservation · adjustment                                                     | `CAT` `FIN` `SYS` `SEC`                  | 15    |
| `SYN` | Offline, sync, backup     | **base** | Outbox entry · device sequence · sync conflict · backup record                                                            | `SYS` `SEC`                              | 9     |
| `PUR` | Purchasing and suppliers  | optional | Supplier · purchase order · goods receipt · purchase invoice · supplier payment                                           | `CAT` `STK` `FIN` `FX`                   | 12    |
| `SAL` | Sales and receivables     | optional | Customer · sales invoice · customer payment · credit note                                                                 | `CAT` `STK` `PRC` `FIN` `FX`             | 9     |
| `CSH` | Tills, cash, expenses     | optional | Till · cash movement · expense · expense category · shift                                                                 | `FIN` `FX`                               | 7     |
| `POS` | Point of sale             | optional | Sale · sale line · tender · held sale · register session                                                                  | `CAT` `PRC` `STK` `SAL` `CSH` `HW` `SYN` | 21    |
| `CNT` | Stocktaking               | optional | Count session · count line · variance · recount                                                                           | `CAT` `STK` `FIN`                        | 9     |
| `HW`  | Hardware                  | optional | Printer profile · drawer · scanner · scale format · display                                                               | `SYS`                                    | 8     |
| `MIG` | Migration and import      | optional | Import batch · import row result · migration report                                                                       | `CAT` `STK` `SAL` `PUR` `CSH` `FIN`      | 8     |
| `RPT` | Reporting                 | optional | Report definition · read models                                                                                           | _(reads only, §5)_                       | 16    |

**core** — every edition ships it. Removing it is not a configuration, it is a different product.

**base** — every edition that sells or holds goods ships it. A purely financial edition could omit `CAT` `PRC` `STK`; a cloud edition with no register needs only part of `SYN`.

**optional** — removable by edition with no effect on anything above it.

**The floor is roughly 90 features.** `SYS` + `SEC` + `FX` + `FIN` + `CAT` + `STK` + `PRC` + the `SYN` spine is about half the product and cannot be subtracted. Everything below that line is where editions actually differ.

---

## 4. Dependency rules

Four, and they are the whole of it:

1. A module may import another module's **contract** — never its internals, its tables, or its screens.
2. A module may **publish** and **subscribe** to domain events. This is the only way a lower module affects a higher one.
3. No query joins across a module boundary. A module that needs another's data reads its contract or a read model.
4. Each module owns its own migrations, seeds, permissions, accounts and settings, and declares them. Enabling a module later — a customer upgrading an edition — runs its migrations against live data.

Rules 1 and 3 decay silently, so both are checked by the build rather than by intent.

---

## 5. The five inversions

Five places where the obvious dependency points the wrong way. Each one, done naively, creates a cycle and welds two modules together permanently.

| Where                              | Naive reading                                                     | Actual direction                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SYS-04` alert centre              | `SYS` reads expiry, variance and sync failures from eight modules | Modules **publish** alerts. `SYS` owns the inbox and knows nothing about what it holds                                                          |
| `SYS-07` global search             | `SYS` queries items, customers, suppliers, documents              | Modules **feed** the index. `SYS` owns the index                                                                                                |
| `STK-11` selling consignment stock | `STK` calls `PUR` to create the payable                           | `STK` publishes the sale of a consignment unit; `PUR` subscribes. Without this, `STK` cannot ship without `PUR`                                 |
| `CAT-16` purchase price history    | `CAT` reads purchase invoices                                     | `PUR` owns the data and exposes a per-item history view; the item card embeds it. Absent `PUR`, the section is absent                           |
| `FIN-08` nightly integrity         | `FIN` reads stock, till, customer and supplier tables             | Each module exposes a verification contract returning its own recomputed figures. `FIN-08` orchestrates and compares; it reads no foreign table |

`RPT` is the sixth and largest case: it reads **read models** that modules maintain, never module tables. This is what lets an edition drop a module and simply lose its reports, rather than breaking every report.

---

## 6. What removing a module costs

| Removed | Lost                                                               | Still works                                                         |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `POS`   | The register, shifts, receipts                                     | Back-office invoicing (`SAL`), all stock and accounting             |
| `PUR`   | Supplier records, purchase cycle, landed cost, consignment receipt | Stock arrives only by adjustment or opening balance                 |
| `SAL`   | Customers, credit, receivables                                     | Cash sales at the register; `POS-12` credit sale disappears with it |
| `CSH`   | Tills, expenses, consolidation                                     | Everything else — but `POS` requires it and cannot ship without it  |
| `CNT`   | Counting sessions                                                  | Stock still adjustable via `STK-09`                                 |
| `MIG`   | All import                                                         | Manual entry                                                        |
| `RPT`   | All analysis                                                       | The ledger and every document remain readable                       |
| `HW`    | Printing, drawer, scale labels                                     | Screen-only operation; `POS` requires it                            |

`POS` requires `CSH`, `HW` and `SYN`. `SAL` requires nothing optional. These are the only hard couplings among optional modules, and they are the constraints an edition file must satisfy.

---

## 7. Build order

Thirty units in seven stages. A unit is finished when the acceptance criteria of every feature it names are automated and passing.

The ordering rule: **no unit exists to be finished later.** Each stage ends with something that runs.

### Stage A — Spine

| Unit  | Delivers                                                                                        | Features                                                       |
| ----- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `U01` | Workspace, build, lint, test harness, the enforcement checks of `design-system.md` §13          | —                                                              |
| `U02` | `packages/ui` — design system Stage 0                                                           | `SYS-01`                                                       |
| `U03` | `kernel` and `platform` — money, quantity, ids, clock, module registry, event bus, unit of work | —                                                              |
| `U04` | Organisation, users, roles, numbering                                                           | `SYS-02` `SYS-05` `SYS-09` `SEC-01` `SEC-02` `SEC-04` `SEC-09` |
| `U05` | Currencies, daily rates, stamping, rounding                                                     | `FX-01`–`FX-07`                                                |
| `U06` | The ledger and the posting engine                                                               | `FIN-01`–`FIN-07`                                              |
| `U07` | Store node, terminal store, outbox, delta sync, durability                                      | `SYN-01` `SYN-02` `SYN-03` `SYN-05` `SYN-06` `POS-18`          |

`U07` sits here deliberately. A register built online-first and made offline later is rewritten, not extended.

### Stage B — The first sale

| Unit  | Delivers                                                             | Features                                                       |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `U08` | Items, barcodes, units, cost, Arabic search                          | `CAT-01` `CAT-02` `CAT-04` `CAT-08` `CAT-10` `CAT-12` `CAT-15` |
| `U09` | Price lists, USD pricing, the frozen display price                   | `PRC-01` `PRC-02` `PRC-03` `PRC-04` `PRC-11`                   |
| `U10` | Locations, movements, weighted-average cost, item card               | `STK-01`–`STK-05`                                              |
| `U11` | Tills, cash movements, shift lifecycle with blind count              | `CSH-01` `CSH-02` `CSH-05` `POS-16`                            |
| `U12` | **A scanned cash sale that prints, posts and moves stock — offline** | `POS-02` `POS-04` `POS-05` `POS-14` `POS-19` `HW-01`–`HW-04`   |

**The end of Stage B is the first real milestone:** one register, one branch, one currency in use but four in the model, a sale that survives a power cut and reconciles after sync.

### Stage C — Catalogue and stock complete

| Unit  | Delivers                                                                                       | Features                                                                                |
| ----- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `U13` | Variants, scale barcodes, internal barcodes, labels, images, thresholds, bulk edit, duplicates | `CAT-03` `CAT-05` `CAT-06` `CAT-07` `CAT-09` `CAT-11` `CAT-13` `CAT-14` `HW-05` `HW-06` |
| `U14` | Promotions, bulk price update, margin pricing                                                  | `PRC-05` `PRC-06` `PRC-08` `PRC-09` `PRC-10`                                            |
| `U15` | Batches, expiry, transfers, adjustments, waste, valuation, slow movers                         | `STK-06`–`STK-10` `STK-14` `STK-15`                                                     |

### Stage D — Trade

| Unit  | Delivers                                                                     | Features                                                    |
| ----- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `U16` | Suppliers, purchase cycle, free goods, landed cost, payments, aging          | `PUR-01`–`PUR-11` `CAT-16`                                  |
| `U17` | Customers, credit limits, invoicing, payments, statements, returns           | `SAL-01`–`SAL-09` `HW-08`                                   |
| `U18` | Consignment — receipt, exclusion from valuation, payable on sale, settlement | `STK-11` `PUR-12`                                           |
| `U19` | Expenses, consolidation, payment methods, realised and unrealised FX         | `CSH-03` `CSH-04` `CSH-06` `CSH-07` `FX-08` `FX-09` `FX-10` |

### Stage E — The register

| Unit  | Delivers                                                                                                                                                                                                                     | Features                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `U20` | Weighed items, promotions at the till, hold, void, returns, split multi-currency payment, change in any currency, credit sale, price check, drawer, user switching, unknown barcode, customer display, minimum selling price | `POS-03` `POS-06`–`POS-13` `POS-15` `POS-17` `POS-20` `POS-21` `PRC-07` `HW-07` |
| `U21` | A full offline trading day, conflict resolution, negative-stock and reservation degradation                                                                                                                                  | `POS-01` `SYN-04` `STK-12` `STK-13`                                             |

### Stage F — Control

| Unit  | Delivers                                                                                   | Features                            |
| ----- | ------------------------------------------------------------------------------------------ | ----------------------------------- |
| `U22` | Cycle and full counts, frozen sessions, blind counting, mobile counting, recount, approval | `CNT-01`–`CNT-09`                   |
| `U23` | Cost visibility, supervisor PIN, audit trail, sensitive actions, devices and sessions      | `SEC-03` `SEC-05`–`SEC-08`          |
| `U24` | Every report, export and print; the alert centre; global search                            | `RPT-01`–`RPT-16` `SYS-04` `SYS-07` |
| `U25` | Nightly integrity verification across the whole dataset                                    | `FIN-08`                            |

### Stage G — Product

| Unit  | Delivers                                                                                  | Features                                     |
| ----- | ----------------------------------------------------------------------------------------- | -------------------------------------------- |
| `U26` | Templates, validation, dry run, batched import with rollback, migration report            | `MIG-01`–`MIG-08`                            |
| `U27` | Designable documents, terminology overrides                                               | `SYS-06` `SYS-08`                            |
| `U28` | Redenomination                                                                            | `FX-11`                                      |
| `U29` | Backup, point-in-time restore, full data export                                           | `SYN-07` `SYN-08` `SYN-09`                   |
| `U30` | Fiscal administration, signed updates, offline licence, support access, first-run install | `SYS-03` `SYS-10` `SYS-11` `SYS-12` `SYS-13` |

---

## 8. Coverage

Every one of the 182 features appears in exactly one unit.

| Module | Units                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------- |
| `FIN`  | `U06` (01–07) · `U25` (08)                                                                            |
| `FX`   | `U05` (01–07) · `U19` (08–10) · `U28` (11)                                                            |
| `CAT`  | `U08` (01, 02, 04, 08, 10, 12, 15) · `U13` (03, 05, 06, 07, 09, 11, 13, 14) · `U16` (16)              |
| `PRC`  | `U09` (01–04, 11) · `U14` (05, 06, 08, 09, 10) · `U20` (07)                                           |
| `STK`  | `U10` (01–05) · `U15` (06–10, 14, 15) · `U18` (11) · `U21` (12, 13)                                   |
| `PUR`  | `U16` (01–11) · `U18` (12)                                                                            |
| `POS`  | `U07` (18) · `U11` (16) · `U12` (02, 04, 05, 14, 19) · `U20` (03, 06–13, 15, 17, 20, 21) · `U21` (01) |
| `SAL`  | `U17` (01–09)                                                                                         |
| `CSH`  | `U11` (01, 02, 05) · `U19` (03, 04, 06, 07)                                                           |
| `CNT`  | `U22` (01–09)                                                                                         |
| `RPT`  | `U24` (01–16)                                                                                         |
| `SEC`  | `U04` (01, 02, 04, 09) · `U23` (03, 05–08)                                                            |
| `HW`   | `U12` (01–04) · `U13` (05, 06) · `U17` (08) · `U20` (07)                                              |
| `SYN`  | `U07` (01, 02, 03, 05, 06) · `U21` (04) · `U29` (07, 08, 09)                                          |
| `MIG`  | `U26` (01–08)                                                                                         |
| `SYS`  | `U02` (01) · `U04` (02, 05, 09) · `U24` (04, 07) · `U27` (06, 08) · `U30` (03, 10–13)                 |
