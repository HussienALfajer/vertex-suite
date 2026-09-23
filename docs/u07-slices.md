# U07 — Delivery slices

This is the execution breakdown for `U07` in [modules.md](modules.md). The feature text and
acceptance criteria in [core-features.md](core-features.md) remain authoritative. Each slice is a
reviewable, independently green change; `U07` is added to `DELIVERED` only after all six close.

| Slice                                      | Outcome                                                                                                                                                                       | Feature ownership   | Exit evidence                                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U07.1 — Durable stores**                 | Persistent store-node and terminal storage implementing the platform's transaction and migration contracts. No server API yet.                                                | `SYN-01` foundation | Committed records and migration journal survive process restart; rollback leaves neither partial data nor a journal entry; concurrent conflicting writes cannot silently overwrite each other. |
| **U07.2 — Store node and transport**       | Compose the real modules in `apps/store-node`; connect `back-office` through an authenticated transport and remove its production dependency on the development stand-in.     | `SYN-01` completion | Sign in and create a branch through the server; restart and read it back; unauthorized and cross-tenant requests are refused.                                                                  |
| **U07.3 — Transactional outbox and inbox** | Write the outgoing operation in the same transaction as its data; deliver with a unique idempotency key and monotonic per-device sequence; persist receipt/application state. | `SYN-02`            | Replaying the complete outbox creates no duplicate document and changes no balance; interruption between apply and acknowledgement is safe.                                                    |
| **U07.4 — Delta sync**                     | Synchronize stock movements as deltas, with deterministic per-device ordering and correct reconciliation across disconnected terminals.                                       | `SYN-03`            | Two offline terminals decrement the same item; either delivery order produces the correct final quantity.                                                                                      |
| **U07.5 — Power-loss durability**          | Keep document, movement and outbox write atomic; defer receipt printing until durable commit. Add restart and fault-injection tests at transaction boundaries.                | `SYN-05`            | Every interruption leaves either a complete operation or none, and never a printed receipt without a stored operation.                                                                         |
| **U07.6 — Status and recovery**            | Show connection and queue state, pending/failed operations and details; retry with backoff and expose an escalation path. Integrate the register status indicator.            | `SYN-06`, `POS-18`  | Browser journeys cover connected, offline, pending, failed and recovered states; the complete U07 test suite passes on Windows and Linux.                                                      |

## Slice boundaries

- `U07.1` establishes durable storage and migrations. HTTP transport, authentication, outbox,
  stock reconciliation, receipt printing and status UI belong to later slices. It may add the
  smallest host/test harness needed to exercise both stores across process restarts.
- `U07.2` is the first end-to-end path through a real store node. Development fixtures remain
  useful for tests, but the production app must use the real transport.
- `U07.3` must close the commit-to-delivery crash gap described in
  `packages/platform/src/events.ts`; in-memory dispatch alone is insufficient.
- `U07.4` and `U07.5` precede the full `STK` and `POS` implementations. Use a deliberately small
  sale/movement fixture that exercises the _same_ durable transaction, synchronization and
  after-commit mechanisms. Repeat both acceptance journeys with a real sale in `U12`; success in
  U07 does not claim the register is ready for trade.
- `U07.6` closes the six U07 feature claims. Only then update `DELIVERED` in `tools/spec.mjs`.

## Quality gates for every slice

1. Write failing behavioral tests from the slice's feature text before implementation, with
   stable feature identifiers in the test names. Exercise a real persistent store where a
   durability claim is made; an in-memory fixture cannot prove restart or crash behavior.
2. Preserve the package boundary rules, exact decimal and identifier conventions, explicit
   command context, tenant isolation, and transaction semantics already enforced by the repo.
3. Run `pnpm verify`; run `pnpm e2e` for any change visible on a screen. Keep Windows and Linux CI
   green. Do not update coverage assertions ahead of passing acceptance tests.
4. Review identity, tenant and transport changes for security; review the persistence and crash
   boundary for data loss, duplicate application and migration safety.

The next product milestone remains the real offline cash sale in `U12` (modules.md Stage B).
