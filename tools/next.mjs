#!/usr/bin/env node
/**
 * What to work on, derived rather than written down.
 *
 * A session that starts with no memory of the last one needs one thing: which
 * unit is next and what it has to be able to do. Both are already stated — the
 * order in `modules.md` §7, the requirements in `core-features.md` — so writing
 * them into a plan file would create a third copy that goes stale the moment
 * the first two move. This prints them instead, from the documents, every time.
 *
 * It is the briefing. Run it, read the features it names in `core-features.md`,
 * write the acceptance tests, then make them pass.
 */
import { execFileSync } from 'node:child_process';

import { DELIVERED, readProofs, readSpec } from './spec.mjs';

const { features, units, owner, problems } = readSpec();
const proofs = readProofs();
const delivered = new Set(DELIVERED);

if (problems.length > 0) {
  process.stdout.write('The specification disagrees with itself. Run pnpm check:coverage.\n\n');
}

function branch() {
  try {
    return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const next = [...units.values()].find((unit) => !delivered.has(unit.id));

if (next === undefined) {
  process.stdout.write('Every unit is delivered.\n');
  process.exit(0);
}

const current = branch();
if (current !== '' && current !== 'main') {
  process.stdout.write(
    `On branch ${current}. A slice is already in progress: run pnpm test, and the failing\n` +
      'acceptance tests are what is left of it. What follows is the unit it belongs to.\n\n',
  );
}

const owned = [...owner.entries()]
  .filter(([, unit]) => unit === next.id)
  .map(([id]) => id)
  .sort();

process.stdout.write(`${next.id} — ${next.delivers}\n`);
process.stdout.write(
  `${String(owned.length)} feature(s). A unit is finished when the acceptance criterion of every\n` +
    'one of them is automated and passing (modules.md §7), which pnpm check:coverage enforces\n' +
    'once the unit is added to DELIVERED in tools/spec.mjs.\n',
);

for (const id of owned) {
  const feature = features.get(id);
  if (feature === undefined) continue;
  const started = proofs.get(id) ?? [];

  process.stdout.write(`\n  ${id}  ${feature.title}\n`);
  for (const line of wrap(feature.description, 88)) {
    process.stdout.write(`      ${line}\n`);
  }
  if (feature.acceptance !== null) {
    process.stdout.write('      Acceptance:\n');
    for (const line of wrap(feature.acceptance, 84)) {
      process.stdout.write(`        ${line}\n`);
    }
  }
  for (const proof of started) {
    process.stdout.write(`      already named by ${proof.file}:${String(proof.line)}\n`);
  }
}

process.stdout.write(
  '\nRead before writing: docs/core-features.md for the text above in full, docs/modules.md §7\n' +
    'for why this unit sits where it does, §4 for what a module may depend on, §5 for the five\n' +
    'places the obvious dependency points the wrong way.\n',
);

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/).filter((one) => one !== '')) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}
