#!/usr/bin/env node
/**
 * The definition of finished, made checkable.
 *
 * `modules.md` §7 states it exactly: **a unit is finished when the acceptance
 * criteria of every feature it names are automated and passing.** Until this
 * check existed, nothing verified that. A unit was finished because somebody
 * said so, and with 182 features across 30 units the claim becomes unauditable
 * long before the last one — not through carelessness, but because nobody can
 * hold 182 acceptance criteria in mind and notice the one that was quietly
 * proven by a neighbouring test.
 *
 * Nothing is maintained by hand except the list of delivered units in
 * `spec.mjs`. The features, their ownership and the agreement of the two
 * documents come from the specification itself; the proof comes from the names
 * of the tests.
 *
 * It runs **after** the suites in `pnpm verify`, so "proven" means a test that
 * names the feature inside a run that went green, rather than a test that
 * merely exists. The keyboard journeys are a separate job, so the guarantee is
 * a property of the pipeline rather than of any single command — which is also
 * true of every other check here.
 */
import { DELIVERED, readProofs, readSpec } from './spec.mjs';

const { features, units, owner, problems } = readSpec();
const proofs = readProofs();
const delivered = new Set(DELIVERED);

const findings = [...problems];
const report = (where, message) => findings.push({ where, message });

// The claim of completion, against the suite.
for (const [id, unit] of owner) {
  if (delivered.has(unit) && !proofs.has(id)) {
    report(
      unit,
      `${id} is claimed delivered and no test names it. ` +
        `Either a test asserts "${features.get(id)?.title ?? id}" — and says so in its name — ` +
        `or ${unit} is not finished.`,
    );
  }
}

// The suite, against the specification.
//
// Only an identifier that is not a feature fails. Naming a feature whose unit
// has not been delivered is not an error — it is how a unit begins, since the
// acceptance tests of a slice are written from the specification before the
// code that satisfies them, and it is also how a lower layer records which
// future feature a primitive was shaped for. Those are reported below instead,
// so that standing work stays visible on every run.
const standing = new Map();
for (const [id, where] of proofs) {
  if (!features.has(id)) {
    const at = where.map((one) => `${one.file}:${String(one.line)}`).join(', ');
    report(at, `A test claims ${id}, which is not a feature. Check the identifier.`);
    continue;
  }
  const unit = owner.get(id);
  if (unit !== undefined && !delivered.has(unit)) {
    standing.set(unit, [...(standing.get(unit) ?? []), id]);
  }
}

if (findings.length > 0) {
  for (const { where, message } of findings) {
    process.stdout.write(`${where}  ${message}\n`);
  }
  process.stdout.write(`\ncheck:coverage found ${String(findings.length)} problem(s).\n`);
  process.exit(1);
}

const owned = [...owner.values()].filter((unit) => delivered.has(unit));
const withAcceptance = [...features.values()].filter((one) => one.acceptance !== null).length;

process.stdout.write(
  `check:coverage: ${String(features.size)} features across ${String(units.size)} units, ` +
    `${String(withAcceptance)} with a stated acceptance criterion.\n` +
    `  delivered: ${DELIVERED.join(', ')} — ${String(owned.length)} feature(s), every one proven.\n`,
);

for (const unit of [...standing.keys()].sort()) {
  process.stdout.write(
    `  standing:  ${unit} — ${[...(standing.get(unit) ?? [])].sort().join(', ')}\n`,
  );
}
