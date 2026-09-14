# Vertex Suite — RMS Core Feature Specification

182 features across 16 modules. Every feature has a stable ID; reference the ID in branch names, commit messages, PR titles, tests, and TODOs.

| #   | Code  | Module                           |
| --- | ----- | -------------------------------- |
| 1   | `FIN` | Financial Core (General Ledger)  |
| 2   | `FX`  | Currencies and Exchange Rates    |
| 3   | `CAT` | Catalogue, Items and Barcodes    |
| 4   | `PRC` | Pricing and Promotions           |
| 5   | `STK` | Inventory and Stock              |
| 6   | `PUR` | Purchasing and Suppliers         |
| 7   | `POS` | Point of Sale                    |
| 8   | `SAL` | Sales, Customers and Receivables |
| 9   | `CSH` | Tills, Cash and Expenses         |
| 10  | `CNT` | Stocktaking                      |
| 11  | `RPT` | Reporting                        |
| 12  | `SEC` | Roles, Permissions and Audit     |
| 13  | `HW`  | Hardware and Peripherals         |
| 14  | `SYN` | Offline, Sync and Backup         |
| 15  | `MIG` | Data Migration and Import        |
| 16  | `SYS` | System Foundations               |

---

## 1. `FIN` — Financial Core (General Ledger)

The ledger runs invisibly. A shop owner never sees debits and credits unless they ask for them; an accountant sees a complete, auditable book. Both views read the same data.

**`FIN-01` Chart of accounts**
A retail-oriented chart of accounts is seeded on tenant creation and is editable as a tree. System-reserved accounts (inventory, COGS, receivables, payables, cash per currency, FX gain/loss, shrinkage) are marked and cannot be deleted.

**`FIN-02` Automatic posting engine**
Every business event produces a balanced journal entry with no user action: sale, return, purchase, goods receipt, supplier return, customer payment, supplier payment, cash movement, internal FX exchange, expense, transfer, waste, stock adjustment, stocktake variance, consignment settlement, and FX revaluation.
_Acceptance:_ no business event reaches the system of record without its journal entry; at the system of record the two are written in a single atomic transaction and a failure to post rolls back the business event; an event recorded at a register operating offline carries every fact only the register can know and is posted atomically when the system of record applies it.

**`FIN-03` Immutable entries**
Journal entries cannot be edited or deleted. Correction is a reversing entry that references the original.
_Acceptance:_ there is no code path that updates or deletes a posted journal line.

**`FIN-04` Manual journal entry**
An accountant-only screen for adjusting entries, with mandatory description and attachment support.

**`FIN-05` Fiscal calendar and period closing**
Fiscal years and accounting periods, each open or closed. Closing a period blocks all postings dated within it, including late offline sync arrivals, which are instead routed to an exceptions queue for a decision.

**`FIN-06` Opening balances**
Structured entry of opening inventory, till balances, customer debts, and supplier debts, posted as a dated opening journal entry.

**`FIN-07` Financial statements**
Trial balance, income statement, balance sheet, and general ledger detail — each for any date range and viewable in any presentation currency.

**`FIN-08` Nightly integrity verification**
A scheduled job re-verifies ledger balance, stock quantities, customer and supplier balances, till balances, and the exclusion of consignment stock across the whole dataset, recomputes the derived caches (stock levels and weighted-average cost) from the ledgers of record, writes a result record, and raises an alert on any deviation.
_Acceptance:_ the job runs in cloud and on-premise installations alike; a deliberately corrupted fixture is detected and reported.

---

## 2. `FX` — Currencies and Exchange Rates

The most error-prone area of this product. Treat every rule here as load-bearing.

**`FX-01` Four currencies**
SYP, USD, TRY, EUR, each with its own symbol, decimal precision, and rounding rule. The currency list is data, extensible without code changes.

**`FX-02` USD as functional currency**
All cost, margin, profit, and inventory valuation are stored and computed in USD. This is configuration per tenant, not a hard-coded constant.

**`FX-03` Presentation currency switching**
Any user, screen, report, and printed document can display figures in any enabled currency, converted at a stated rate with the rate shown.

**`FX-04` Daily buy and sell rates**
The owner or manager of each branch enters two rates per currency per day for that branch; the tenant may publish a suggested rate that a branch adopts as its own with one action. Buy is the rate applied when receiving that currency; sell is the rate applied when paying it out. Rates are expressed as units of the currency per one unit of the functional currency, and may be entered in the form the local market quotes. A mistyped rate is corrected by a new revision the same day; documents already stamped keep the revision they used. A missing rate for today blocks currency-sensitive operations with a clear prompt rather than silently reusing yesterday's — except at a register that cannot reach the store node, which trades on its most recent synced rate only after a supervisor confirms it at shift open, shows that rate's date on every currency-sensitive screen, and flags the shift's documents for review at sync.

**`FX-05` Rate history and stamping**
Every transaction permanently stores the rate it used. Later rate changes never alter historical figures.
_Acceptance:_ re-running any historical report returns identical numbers regardless of today's rate.

**`FX-06` Correct rate selection**
Buy rate on receipt of a currency, sell rate on disbursement, applied automatically. The applied rate is always visible and overridable only with permission, and an override is logged.

**`FX-07` Per-currency rounding rules**
Each currency defines its rounding increment and direction — for example SYP rounded to the smallest circulating denomination, USD to two decimals. Rounding is applied at defined points only, and the residual is posted to a rounding account so totals never drift.

**`FX-08` FX gain and loss**
Realised gains and losses are computed and posted automatically on receivables, payables, and cash whenever a balance is settled at a different rate than it was created at.

**`FX-09` Internal currency exchange**
Moving value between tills of different currencies is a first-class operation that records both amounts, the rate used, and the resulting gain or loss.

**`FX-10` Period-end revaluation**
Open foreign-currency balances are revalued at period end, producing an unrealised gain or loss entry.

**`FX-11` Redenomination support**
A supported administrative procedure that applies a redenomination factor to a currency from an effective date. No stored record is rewritten: historical documents keep their original figures, and balances and reports that span the effective date interpret them through the factor at read time, while pre-redenomination documents remain readable at their original figures.
_Acceptance:_ after redenomination, every balance still reconciles and historical reports remain internally consistent.

---

## 3. `CAT` — Catalogue, Items and Barcodes

Sized for 30,000 SKUs, half of which have no manufacturer barcode.

**`CAT-01` Category tree**
Multi-level categories covering groceries, fresh goods, cleaning, housewares, personal care, apparel, electronics, perfumes, stationery, and toys. Items belong to exactly one category; categories carry defaults inherited by new items.

**`CAT-02` Item types**
Four tracking behaviours, set per item: standard, **weighed** (sold by weight via scale barcode), **batch-tracked** (with expiry), and **variant-bearing**. The model is designed so serial-number tracking can be enabled later without schema change.

**`CAT-03` Item variants**
Size × colour (and further attributes) combinations for apparel, each with its own barcode, stock, and price, grouped under one parent item for browsing and reporting.

**`CAT-04` Multiple barcodes per item**
One item may carry many barcodes — different suppliers, packaging, or legacy codes — each optionally bound to a specific UoM.
_Acceptance:_ scanning any registered barcode resolves to the correct item and unit; barcodes are unique within a tenant; deactivating a barcode preserves historical lookups.

**`CAT-05` Embedded-weight barcode parsing**
Scale-printed barcodes are parsed according to a configurable format: prefix, item-code position and length, weight or price position and length, decimal placement, and check digit. Configuration is per tenant, testable from the settings screen with a sample barcode.

**`CAT-06` Internal barcode generation**
Generates and assigns barcodes for items lacking one, in bulk, using a configurable internal range that cannot collide with manufacturer codes.

**`CAT-07` Label printing**
Item labels and shelf labels, printed individually or in bulk, from designable templates, in Arabic, showing name, price, unit, and barcode. Bulk selection by category, supplier, recent price change, or explicit list.

**`CAT-08` Units of measure**
Multiple units per item with conversion factors (carton ⇄ pack ⇄ piece; bag ⇄ kg), a defined base unit for stock, and a barcode and price per unit.
_Acceptance:_ stock is always stored in the base unit; every quantity displayed states its unit; conversions never lose precision.

**`CAT-09` Item images**
One or more images per item, stored through an abstracted file interface so cloud and on-premise installations both work.

**`CAT-10` Item cost**
Moving weighted-average cost held in USD, recalculated on every inbound movement, and always consistent with the inventory account in the ledger.

**`CAT-11` Stock thresholds**
Minimum, maximum, and reorder point per item per location, driving alerts and replenishment reports.

**`CAT-12` Item lifecycle status**
Active, suspended, or discontinued, with a reason. Suspended items cannot be sold or purchased but keep their history.

**`CAT-13` Bulk edit and bulk import**
Mandatory at this catalogue size. Change price, category, supplier, thresholds, tax treatment, or status across thousands of items in one reviewed operation, with a preview of affected rows and a full undo — applied as a new, audited operation that restores the previous values, never by erasing the original.

**`CAT-14` Duplicate detection**
Detects duplicate barcodes and probable duplicate items on creation and import, and surfaces them for merging.

**`CAT-15` Arabic search**
Search tolerant of diacritics, hamza and alef forms, taa marbuta, and partial words, across name, code, barcode, and category, returning results fast enough for register use.
_Acceptance:_ a term typed without diacritics finds the diacritised item; a term with any alef form finds all alef forms; results return in under 150 ms at 30,000 SKUs.

**`CAT-16` Supplier linkage and purchase price history**
Each item records its primary and alternative suppliers and the full history of purchase prices per supplier.

---

## 4. `PRC` — Pricing and Promotions

**`PRC-01` Three price lists**
Retail, half-wholesale, and wholesale, with a price per unit of measure in each. Price lists are data; additional lists can be created without code changes.

**`PRC-02` USD pricing with SYP display price**
Prices are defined in USD. The SYP figure shown to customers is derived from it.

**`PRC-03` Display price freeze** ⭐
The SYP display price does **not** float with the daily rate. It is recalculated only when a user triggers it, or automatically when the exchange rate moves past a threshold the owner configures. Reprinting 30,000 labels daily is impossible, so the displayed price must be deliberately stable.
_Acceptance:_ changing today's exchange rate does not change any display price; crossing the configured threshold raises a review task listing affected items; recalculation is a reviewed, logged batch action.

**`PRC-04` Shelf-to-register price agreement**
The register starts every line from the frozen display price, never from a live-computed one. Promotions and discounts are then applied on top and shown separately, so the customer can always see the shelf price and what was deducted from it.
_Acceptance:_ for any item, the price on its most recently printed label equals the base price the register applies before promotions and discounts; every deduction from that base appears as its own itemised amount on the line and on the receipt.

**`PRC-05` Bulk price update**
Update prices in bulk by percentage, by category, by supplier, or to a target margin, with a preview and a full undo — applied as a new, audited price change back to the previous values (`PRC-11`).

**`PRC-06` Target margin pricing**
Set a target margin per item or category and derive the selling price from current USD cost.

**`PRC-07` Margin protection**
Selling below cost warns or is blocked according to configuration and the user's permission, and every below-cost sale is logged. At the register this is enforced against the **minimum selling price** for the item, unit and price list — computed at the store node from current USD cost and synced to registers as a price, never as a cost. The store node re-verifies every sale against actual cost when it applies it, and raises any residual below-cost sale as an exception.
_Acceptance:_ at a register with no connection to the store node, a price override below the minimum selling price warns or blocks according to configuration and records the authorising user; the register database contains no cost or margin field; a sale that proves below cost at application appears in `RPT-13`.

**`PRC-08` Promotion types**
Percentage discount, fixed-amount discount, temporary promotional price with start and end dates, buy-X-get-Y, and whole-invoice discount.

**`PRC-09` Promotion scope**
A promotion targets an item, a category, a supplier, or everything, and applies to selected price lists and branches.

**`PRC-10` Promotion priority and conflict rules**
Explicit, deterministic rules decide which promotion applies when several match, and whether promotions stack.
_Acceptance:_ given the same basket and the same active promotions, the computed price is always identical, online or offline.

**`PRC-11` Price change audit**
Every price change records who, when, old value, new value, and reason, and is reportable.

---

## 5. `STK` — Inventory and Stock

**`STK-01` Stock locations**
Warehouse and sales floor as distinct locations, under a branch, under a company, under a tenant. The hierarchy supports many branches from the start even though the pilot has one.

**`STK-02` Real-time stock per location**
Current quantity for every item and variant at every location, always derivable from movements.

**`STK-03` Append-only stock ledger**
Every inbound and outbound quantity is a permanent movement row recording item, variant, location, batch, quantity, unit cost in USD, source document, user, timestamp, and device.
_Acceptance:_ no code path updates or deletes a movement row; reversals are new rows.

**`STK-04` Item card**
The complete movement history of one item from day one, with running quantity, running cost, and running value, filterable by location and date, exportable.

**`STK-05` Weighted-average costing in USD**
Cost recalculated on every receipt, always reconciled to the inventory account in the ledger. Cost is computed in the order movements are applied at the system of record, which makes it deterministic and exactly reproducible by `FIN-08`; history is never re-costed in business-time order, because that would rewrite cost already posted. The costing method sits behind a strategy interface so FIFO can be offered later without restructuring.

**`STK-06` Batches and expiry with FEFO**
Batch-tracked items record expiry per batch, and the system proposes the earliest-expiring batch on outbound movements.

**`STK-07` Expiry alerts**
Staged alerts at 90, 60, 30, and 7 days (thresholds configurable), plus an expired-stock report and a suggested action list.

**`STK-08` Inter-location transfers**
Transfer documents with dispatch and receipt steps, an in-transit state, partial receipt, and discrepancy recording.

**`STK-09` Stock adjustments**
Deliberate corrections with mandatory categorised reasons and an approval permission, posting to the ledger.

**`STK-10` Waste, damage and internal consumption**
A dedicated screen with categorised reasons (expired, broken, spoiled, staff consumption, sampling, theft) and a valued shrinkage report.

**`STK-11` Consignment stock** ⭐
Stock physically present and not owned. Excluded from inventory valuation and owned-stock accounting; on sale it simultaneously creates a payable to the supplier and recognises cost. Periodic settlement statements per supplier show sold, returned, and remaining consignment quantities.
_Acceptance:_ consignment quantity never appears in inventory valuation; selling a consignment unit creates a supplier payable in the same transaction; a settlement statement reconciles to the payable balance.

**`STK-12` Negative stock policy**
Per item and per location: block, warn, or allow. Overriding a block requires permission and is logged.
At a register that cannot reach the store node, `block` degrades to `warn`, because the register's stock figure is an advisory snapshot and it cannot truthfully enforce a quantity it cannot observe. The degradation is shown to the cashier, and a sale that took stock negative is raised as an exception at sync.

**`STK-13` Stock reservation**
Quantity committed to unfulfilled documents is reserved and excluded from available stock.
Reservations are **authoritative only at the system of record**. A terminal operating offline sells from physical stock and does not enforce reservations it cannot verify; a conflict surfaces at sync as an exception for review. Stopping a paying customer at the register over a back-office reservation the terminal cannot confirm would defeat offline operation.
_Acceptance:_ an offline sale of a reserved item completes, and the conflict appears in the sync exception queue with both documents identified.

**`STK-14` Inventory valuation**
Valuation at cost and at selling price, by location, category, and supplier, for any date.

**`STK-15` Slow-moving and below-minimum**
Items with no movement for a configurable period, and items below their minimum or reorder point, with a suggested purchase list.

---

## 6. `PUR` — Purchasing and Suppliers

**`PUR-01` Supplier master**
Supplier records with contacts, terms, and **separate balances per currency**, never merged into a single figure.

**`PUR-02` Purchase cycle**
Purchase order (optional) → goods receipt → purchase invoice, each linkable and each able to stand alone when the supplier's paperwork does not follow the ideal flow.

**`PUR-03` Partial receipt and partial invoicing**
A purchase order may be received in several deliveries and invoiced in several invoices, with remaining quantities tracked.

**`PUR-04` Free goods and bonus quantities**
Quantities received at zero charge, with the invoice cost redistributed across the total received quantity so unit cost reflects reality.
_Acceptance:_ receiving 100 paid plus 10 free at a total cost of C yields a unit cost of C/110, not C/100.

**`PUR-05` Supplier discounts**
Line discount, invoice discount, and **retroactive discounts** received after invoicing, applied by credit note with correct effect on cost and payable.

**`PUR-06` Landed cost allocation**
Freight, customs, and handling charges allocated across received items by value, weight, or quantity, and absorbed into item cost.

**`PUR-07` Supplier returns**
Return documents with stock, cost, and payable effects, referencing the original receipt where known.

**`PUR-08` Supplier payments**
Partial payments in any currency, allocated to specific invoices, with automatic FX gain or loss.

**`PUR-09` Due dates and payables aging**
Due dates per invoice, and an aging report bucketed 0–30, 31–60, 61–90, and over 90 days, per currency.

**`PUR-10` Supplier statement**
A running statement in the transaction currency with opening balance, documents, payments, and closing balance.

**`PUR-11` Purchase price history and supplier comparison**
Per item, every purchase price from every supplier over time, with a comparison view.

**`PUR-12` Consignment receipt and settlement**
Receiving consignment stock without creating a payable, and settling it against actual sales on a periodic statement.

---

## 7. `POS` — Point of Sale

The highest-risk and highest-value module. It must be fast, keyboard-driven, and completely independent of any network.

**`POS-01` Full offline operation**
Selling, returning, searching, printing, and closing a shift all work with no connectivity, then sync (`SYN-01`).
_Acceptance:_ with all network interfaces disabled, a full day of trading including shift open, sales, returns of that register's own sales, and shift close completes successfully; the shift carries a provisional business date; after reconnection everything syncs exactly once and the store node confirms the business date or quarantines the shift for review.

**`POS-02` Keyboard-first, mouse-free operation**
Every action reachable by barcode scan or keyboard shortcut. The mouse is optional at all times.
_Acceptance:_ a complete cash sale of five scanned items can be executed without touching a pointing device.

**`POS-03` Weighed items via scale barcode**
Scanning a scale label resolves item and weight and prices the line correctly (`CAT-05`).

**`POS-04` Fast lookup and quick keys**
Search by name, barcode, or code, plus configurable quick-access buttons for departments and items that have no barcode.

**`POS-05` Line editing**
Change quantity, change unit of measure, **override price with permission**, apply a line discount, and apply a whole-invoice discount.

**`POS-06` Automatic promotions**
Active promotions apply automatically and the saved amount is shown on screen and on the receipt. Promotion evaluation is fully offline-capable and deterministic (`PRC-10`).

**`POS-07` Hold and recall**
Suspend a sale and recall it later at any register in the branch, so a customer who forgot an item does not block the queue. A sale is always recallable at the register that held it; recall at a different register requires the store node.

**`POS-08` Void line and void sale**
Both require supervisor authorisation and a recorded reason, and are always logged (`SEC-07`).

**`POS-09` Returns and exchanges**
Look up the original receipt, select lines, and return or exchange them under supervisor approval, with correct stock, cost, and ledger effects. Returns against the register's own sales work offline; a receipt issued by a different register requires the store node.

**`POS-10` Split multi-currency payment** ⭐
One sale settled with several tenders and several currencies — for example part USD and the remainder SYP — with each portion converted at the correct buy rate and stored with that rate.
_Acceptance:_ the sum of tendered portions converted at their stamped rates equals the invoice total in the functional currency, to the rounding tolerance defined in `FX-07`.

**`POS-11` Change in any currency**
Change may be given in a currency other than the one tendered, computed at the sell rate, with the equivalent amount displayed to the cashier and the customer, and rounding applied per `FX-07`.

**`POS-12` Credit sale with live limit enforcement**
Attach a customer and sell on account, with the credit limit enforced at the moment of sale, **including offline** using the last synced balance plus locally pending sales, and an override path that requires permission and is logged.
_Acceptance:_ offline, the limit is evaluated against the last synced balance plus every credit sale made on that terminal since the last sync; the cashier is shown the age of the balance being used; a breach discovered at sync time raises an alert rather than silently rejecting or reversing an already-completed sale.

**`POS-13` Price check**
A fast lookup showing price, unit, promotion, and stock, usable without starting a sale.

**`POS-14` Arabic thermal receipt printing**
Receipts print correctly in Arabic on generic 80 mm ESC/POS hardware. Reprints are permitted and are marked and logged as reprints.

**`POS-15` Cash drawer control**
The drawer opens through the printer, and any opening outside a completed sale requires a recorded reason.

**`POS-16` Shift lifecycle**
Open a shift with a counted opening float **per currency**; record cash in and cash out during the shift; close with a **blind count per currency**; produce a variance report per currency; produce X (mid-shift, non-closing) and Z (closing) reports.
_Acceptance:_ the cashier cannot see the expected figure before entering the count; each currency is counted and reconciled independently; variance posts to the ledger.

**`POS-17` Fast user switching and screen lock**
Quick cashier login, screen lock, and handover without losing the in-progress sale.

**`POS-18` Sync status indicator**
Persistent on-screen indication of connection state and the number of operations pending sync, with a detail view.

**`POS-19` Per-terminal numbering**
Each register has its own document number series so offline registers never collide (`SYS-02`).

**`POS-20` Unknown barcode handling**
An unrecognised barcode offers a permissioned quick-add, or flags the code for back-office review, without stopping the queue.

**`POS-21` Customer-facing display**
Optional second screen showing line items, total, tendered amount, and change including currency equivalents.

---

## 8. `SAL` — Sales, Customers and Receivables

**`SAL-01` Customer master**
Customer records with contacts and **separate balances per currency**, each balance held in the currency it was created in.

**`SAL-02` Credit limits**
A limit per customer, enforced at point of sale and in the back office, with warn or block behaviour and a permissioned, logged override.

**`SAL-03` Price list assignment**
Each customer is bound to a price list (retail, half-wholesale, wholesale), applied automatically wherever they transact.

**`SAL-04` Back-office sales invoice**
Full invoicing outside the register for wholesale and account sales, with multi-line entry, unit selection, discounts, and delivery from any location.

**`SAL-05` Customer payments**
Partial payments in any currency, allocated to specific invoices or to the oldest balance, with automatic FX gain or loss.

**`SAL-06` Customer statement**
A running statement in the transaction currency showing opening balance, documents, payments, and closing balance, printable and exportable.

**`SAL-07` Receivables aging**
Aging buckets 0–30, 31–60, 61–90, and over 90 days, per currency, with drill-through to documents.

**`SAL-08` Sales returns and credit notes**
Returns against an invoice or standalone, with correct stock, cost, receivable, and ledger effects.

**`SAL-09` Customer purchase history**
Every document for a customer, with totals, frequency, and most-purchased items.

---

## 9. `CSH` — Tills, Cash and Expenses

**`CSH-01` One till per currency**
Independent cash accounts for SYP, USD, TRY, and EUR. Balances are never merged or auto-converted for storage.

**`CSH-02` Receipts, disbursements and transfers**
Cash in, cash out, and transfers between tills. A transfer between tills of different currencies is an internal exchange that records both amounts, the rate, and the resulting gain or loss (`FX-09`).

**`CSH-03` Operating expenses**
Expense entry in any currency with a category tree covering electricity, generator fuel, rent, wages, maintenance, transport, and miscellaneous, with attachments.

**`CSH-04` Recurring expenses**
Definitions that generate due expenses on schedule and alert when they fall due.

**`CSH-05` Till statement and live balance**
Full movement history and current balance per till, reconcilable to the ledger at any moment.

**`CSH-06` Daily cash consolidation**
Reconciliation of all closed shifts against the amount handed to the main safe, per currency, with a variance figure and sign-off.

**`CSH-07` Pluggable payment methods**
Payment methods are data. Cash is active now; **Sham Cash** and card acquiring can be enabled later through configuration and an adapter, with no change to sales logic.

---

## 10. `CNT` — Stocktaking

**`CNT-01` Cycle counts and full counts**
Recurring partial counts scoped by category, department, shelf, or supplier, and a full annual count.

**`CNT-02` Frozen count session**
Opening a session snapshots expected quantities at that instant so subsequent trading does not distort the result.

**`CNT-03` Blind counting**
Counters cannot see expected quantities. Revealing them requires permission.

**`CNT-04` Mobile counting**
Counting from an ordinary phone over the store network, with camera or handheld scanning, supporting several counters working in parallel on different scopes. No app is installed; each phone is enrolled once by trusting the store node's certificate authority, a documented step performed by the tenant administrator.

**`CNT-05` Recount workflow**
Lines whose variance exceeds a configured threshold are queued for a second count before approval.

**`CNT-06` Variance report before approval**
Quantity and value variance per line and in total, reviewable and exportable before anything is posted.

**`CNT-07` Permissioned approval and posting**
Approval posts adjustment movements and the corresponding ledger entries in one atomic operation.

**`CNT-08` Trading continues during counting**
Sales made during an open session are accounted for correctly against the frozen snapshot.
_Acceptance:_ an item sold between snapshot and count shows no false variance.

**`CNT-09` Stocktake history**
Every past count is retained in full, with its variances, approver, and resulting adjustments.

---

## 11. `RPT` — Reporting

Every report supports date range, branch, location, and category filters; renders in any presentation currency; and exports to Excel and PDF and prints (`RPT-16`).

**`RPT-01` Owner daily dashboard**
Today's sales, gross profit, cash by currency, credit extended, and the urgent alert list, on one screen.

**`RPT-02` Sales analysis**
By period, item, category, supplier, cashier, register, and **by hour of day** for staffing decisions.

**`RPT-03` Profitability**
Gross profit and margin by item, category, invoice, and period — computed in USD.

**`RPT-04` Inventory reports**
Stock on hand, valuation, slow-moving, below-minimum, and the item card (`STK-04`).

**`RPT-05` Expiry report**
Approaching expiry by stage and already-expired stock, with value at risk.

**`RPT-06` Waste and shrinkage report**
Categorised by reason, valued, and trended over time.

**`RPT-07` Cashier and shift variance report**
Variance per shift, per cashier, per currency, over time — the primary loss-prevention report.

**`RPT-08` Receivables and payables**
Aging, statements, and a delinquent-accounts list, per currency.

**`RPT-09` Purchasing analysis**
By supplier and item, with purchase price movement over time.

**`RPT-10` Cash and FX report**
Till movements, balances, and realised and unrealised FX gains and losses.

**`RPT-11` Stocktake variance report**
Current and historical count variances by quantity and value.

**`RPT-12` Best and worst sellers**
Top and bottom movers by quantity, revenue, and profit, plus items that have never sold.

**`RPT-13` Below-cost sales report**
Every sale executed below cost, with who authorised it.

**`RPT-14` Price change and exceptional discount report**
All price changes and all discounts beyond standard promotions, with authoriser.

**`RPT-15` Financial statements**
Trial balance, income statement, balance sheet, and general ledger (surfaced from `FIN-07`).

**`RPT-16` Export and print**
Excel, PDF, and direct print for every report, in the chosen presentation currency, with filters recorded on the output.

---

## 12. `SEC` — Roles, Permissions and Audit

**`SEC-01` Seven seeded roles**
Owner, Manager, Accountant, Purchasing, Warehouse Keeper, Floor Supervisor, and Cashier — seeded with sensible permission sets, fully editable, and extensible with new roles.

**`SEC-02` Action-level permissions**
Permissions are granted per action (view, create, edit, delete, approve), not per screen, so a role can view a document without being able to approve it.

**`SEC-03` Cost and margin visibility control**
Cost, margin, and supplier pricing are hidden from any user without the specific permission, including in exports and printed documents.
_Acceptance:_ no API response or export reachable by a cashier contains cost or margin data.

**`SEC-04` Location- and branch-scoped permissions**
A user's rights can be limited to specific branches and locations.

**`SEC-05` Supervisor override by PIN**
A supervisor can authorise a discount, price change, void, return, or limit override at a register **without the cashier logging out**, and the authorising identity is recorded on the transaction. The PIN is at least six digits, authorises an override only — it is never a sign-in credential — and locks after repeated failures, each failure logged.

**`SEC-06` Full audit trail**
Who, when, what, the value before and after, from which device and which branch — for every change to data that matters.
_Acceptance:_ audit records are append-only and cannot be altered by any application role.

**`SEC-07` Sensitive action monitoring**
A dedicated, reportable stream for voids, discounts, drawer openings outside a sale, price edits, cost edits, stock adjustments, and document edits.

**`SEC-08` Device and session management**
Registered devices, active sessions, and the ability to revoke either remotely.

**`SEC-09` User management**
Create, deactivate, and reactivate users within the tenant; assign roles and branch scope; reset passwords; force sign-out. Performed by the **tenant's own administrator**, never by the vendor. Users are deactivated, never deleted, so their historical transactions remain attributable.
A tenant administrator may reset the password only of a sign-in identity that belongs to this tenant alone. An identity shared with another tenant can be deactivated in this tenant, but its password changes only through its owner's current credential or a recovery approved by an administrator of every tenant it belongs to — otherwise one tenant's administrator could sign in to another tenant.
_Acceptance:_ a tenant administrator can add a cashier and have them working at a register with no vendor involvement and **no internet connection**; a deactivated user's historical transactions remain attributable to them.

---

## 13. `HW` — Hardware and Peripherals

**`HW-01` ESC/POS thermal printing (80 mm)**
Support for generic 80 mm ESC/POS receipt printers.

**`HW-02` Arabic raster printing**
Arabic receipt content is rendered to an image and sent as raster data, guaranteeing correct shaping and direction on printers with incomplete Arabic code pages.
_Acceptance:_ Arabic text prints correctly on a printer with no Arabic code page support.

**`HW-03` Cash drawer via printer**
Drawer kick through the receipt printer, with every opening recorded (`POS-15`).

**`HW-04` USB barcode scanner**
Standard keyboard-emulation scanners work with no driver, at every screen that accepts a scan.

**`HW-05` Label-printing scale integration**
Reading and parsing scale-produced embedded-weight labels, with a configurable format and a test tool (`CAT-05`).

**`HW-06` Label printer**
Dedicated label printer support for internal barcodes and shelf labels, with designable templates (`CAT-07`).

**`HW-07` Customer display**
Optional customer-facing screen (`POS-21`).

**`HW-08` A4 printing**
Standard-paper output for reports, wholesale invoices, and statements.

---

## 14. `SYN` — Offline, Sync and Backup

The hardest engineering surface in the product. Nothing here is optional.

**`SYN-01` Local store node and local terminal store**
A local server inside the shop, plus a local datastore on each register, so the store operates fully with no external connectivity.

**`SYN-02` Outbox with idempotency keys**
Every operation is queued locally with a unique idempotency key and a monotonic per-device sequence, then delivered at least once and applied exactly once.
_Acceptance:_ replaying the entire outbox produces no duplicate documents and no changed balances.

**`SYN-03` Delta-based stock sync**
Stock synchronises as movements (deltas), never as absolute quantities, so concurrent offline sales of the same item at different registers reconcile correctly.
_Acceptance:_ two registers selling the same item while both offline produce a correct final quantity after sync.

**`SYN-04` Conflict resolution**
Deterministic per-entity rules, plus a review queue that surfaces the small number of conflicts that genuinely need a human decision.

**`SYN-05` Power-loss durability**
A sale is durably committed before the receipt prints, and an interrupted operation leaves no partial document.
_Acceptance:_ killing power at any point during a sale leaves either a complete stored sale or no sale, never a partial one, and never a printed receipt without a stored sale.

**`SYN-06` Sync status and failure handling**
Visible sync state, a list of pending and failed operations, retry with backoff, and a clear escalation path for anything that cannot be applied.

**`SYN-07` Automatic backup**
Scheduled local backups plus an optional encrypted off-site copy, with retention policy and a periodic automated restore test.
_Acceptance:_ a restore test runs on schedule and reports success or failure; backups are verified, not merely written.

**`SYN-08` Point-in-time restore**
Restore the dataset to a chosen moment, with a documented and rehearsed procedure.

**`SYN-09` Full customer data export**
The tenant can export all of its data in an open, documented format at any time, without vendor involvement. This is a trust feature and is not negotiable.

---

## 15. `MIG` — Data Migration and Import

**Chosen interchange format:** Excel/CSV workbooks against published templates, with images supplied as a single ZIP archive whose filenames match item code or barcode. This format was selected because the customer's staff can actually produce it, and every legacy system in this market can export to it.

**`MIG-01` Template-driven import**
A published template per entity, downloadable from the application, with column documentation and examples.

**`MIG-02` Image import**
A ZIP archive matched to items by code or barcode, with a report of unmatched images and image-less items.

**`MIG-03` Covered entities**
Items, categories, barcodes, units, prices, images, suppliers, customers, opening stock, opening customer debts, opening supplier debts, opening till balances, and historical invoices.
Historical invoices are imported as **non-posting reference data** — they are readable, searchable, and returnable against, but they generate no journal entries and no stock movements. All financial and stock truth at go-live is carried by the opening balances (`FIN-06`), so the ledger has exactly one origin and imported history can never unbalance it or post into a closed period.
_Acceptance:_ importing historical invoices changes no account balance, no stock quantity, and no customer or supplier balance.

**`MIG-04` Pre-import validation**
Row-by-row validation reporting every error with its row number and reason — duplicate barcode, unknown category, invalid number, missing required field — before anything is written.

**`MIG-05` Dry run**
A full simulated import showing exactly what would be created, updated, and rejected, with no data written.

**`MIG-06` Batched import with full rollback**
Imports run in reversible batches; any batch can be rolled back completely after the fact — master and reference data by deactivation, and anything that posted (opening balances) by reversing entries and movements, never by deletion.

**`MIG-07` Repeatable incremental import**
The same mechanism serves ongoing bulk updates — price lists, new items, supplier catalogues — not just the initial migration.

**`MIG-08` Migration report**
A permanent record per import: what was accepted, what was rejected, why, by whom, and when.

---

## 16. `SYS` — System Foundations

**`SYS-01` Arabic-first RTL interface**
Arabic RTL as the primary interface, built with logical properties from the first line of styling, with optional English. Not a retrofit.

**`SYS-02` Document numbering series**
Independent series per document type, per branch, per register, and per fiscal year, with a configurable format. Every number carries the register's prefix and its device generation, so a replacement device on the same register can never reuse a number still unsynced on the device it replaced. Offline-safe by construction (`POS-19`).

**`SYS-03` Fiscal year, periods and closing**
Surfaced administration of the fiscal calendar and period closing defined in `FIN-05`.

**`SYS-04` Alert centre**
A single place for expiring stock, out-of-stock and below-minimum items, credit limit breaches, cashier variances, sync failures, stocktake variances, integrity-check failures, and due recurring expenses — with delivery preferences per role.

**`SYS-05` Business profile**
Name, logo, address, phone, tax identifiers, and receipt header and footer, used across screens and printed documents.

**`SYS-06` Designable document templates**
Receipt, A4 invoice, labels, shelf labels, and statements — editable per tenant without code changes.

**`SYS-07` Global search**
Fast search across items, customers, suppliers, and documents from anywhere in the application.

**`SYS-08` Terminology overrides**
A tenant may rename core concepts in the interface — calling an item a "material" or a branch a "shop" — without any code change. One of the highest-leverage contributors to the bespoke feel.

**`SYS-09` Organisation structure management**
Create and manage companies, branches, stock locations, and registers within the tenant, including activation state and per-branch settings. Performed by the **tenant's own administrator**, never by the vendor. Structural entities are deactivated, never deleted, because stock movements and documents reference them permanently.
_Acceptance:_ adding a branch, a location, or a register requires no vendor involvement and no code change; a deactivated location retains its full movement history and remains reportable.

**`SYS-10` Signed updates with automatic rollback**
Updates arrive as a signed package that is verified before anything changes. The installer stops writes, snapshots the database, migrates, and on any failed health or integrity check restores the snapshot and the previous version — unattended, on a machine nobody is watching.
_Acceptance:_ a package with an invalid signature is refused with nothing changed; an update whose migration fails leaves the store node on its previous version with no lost operation, and every register's unsynced operations still sync afterwards.

**`SYS-11` Offline licence**
A signed licence file carrying tenant, edition, entitlements, expiry and grace period, verified with no internet. Beyond the grace period the system becomes read-only with complete data export still available (`SYN-09`); it never deletes or withholds data.
_Acceptance:_ verification succeeds with all network interfaces disabled; a tampered licence is rejected; beyond the grace period a complete export still succeeds.

**`SYS-12` Operator-initiated support access**
Remote support runs over a secure tunnel that the customer's operator opens, for a recorded reason and a bounded time. There is never a permanently open inbound port, and every session is visible in the tenant's own audit trail.
_Acceptance:_ no inbound support port listens while no session is open; a session closes automatically at its time limit; every session appears in the tenant's audit trail with its reason.

**`SYS-13` First-run installation**
A new installation creates its tenant, company, first branch, and owner account locally, loads its seed data, and needs no vendor connection.
_Acceptance:_ a store node installed with no internet connection reaches a completed register sale over the shop LAN, using only the installer and the owner's input.

---
