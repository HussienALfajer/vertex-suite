#!/usr/bin/env node
/**
 * Holds the workspace to `modules.md` §4. The rules, and why they are checked
 * rather than trusted, are in `boundaries.mjs`; this walks the tree and prints.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findBoundaryBreaches } from './boundaries.mjs';
import { filesUnder, posixPath, workspacePackages } from './workspace.mjs';

const ROOT = process.cwd();
const packages = workspacePackages();

const files = [];
for (const pkg of packages) {
  for (const full of filesUnder(join(ROOT, pkg.dir), (name) => /\.(ts|tsx|mts)$/.test(name))) {
    files.push({ file: posixPath(full), source: readFileSync(full, 'utf8') });
  }
}

const findings = findBoundaryBreaches({ packages, files });

if (findings.length > 0) {
  for (const { file, line, rule, message } of findings) {
    process.stdout.write(`${file}:${String(line)}  ${rule}  ${message}\n`);
  }
  process.stdout.write(`\ncheck:boundaries found ${String(findings.length)} breach(es).\n`);
  process.exit(1);
}

const modules = packages.filter((pkg) => pkg.dir.startsWith('packages/modules/'));
process.stdout.write(
  `check:boundaries: clean — ${String(files.length)} file(s) across ` +
    `${String(packages.length)} package(s), ${String(modules.length)} of them modules.\n`,
);
