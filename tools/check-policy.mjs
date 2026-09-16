#!/usr/bin/env node
/**
 * Holds the shipped source to `design-system.md` §13. The rules, and why each
 * is as narrow as it is, are in `policy.mjs`; this walks the tree and prints.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { findPolicyViolations, isShippedSource } from './policy.mjs';
import { filesUnder, posixPath, workspacePackages } from './workspace.mjs';

const ROOT = process.cwd();

// Every package the workspace declares, rather than a list kept by hand here.
// A list here is correct until somebody adds a package, and then it is silently
// wrong in the one direction nobody notices: the new code is never checked, and
// the check goes on passing.
const files = [];
for (const pkg of workspacePackages()) {
  for (const full of filesUnder(join(ROOT, pkg.dir), isShippedSource)) {
    files.push({ file: posixPath(full), source: readFileSync(full, 'utf8') });
  }
}

const findings = findPolicyViolations({ files });

if (findings.length > 0) {
  for (const { file, line, rule, message } of findings) {
    process.stdout.write(`${file}:${String(line)}  ${rule}  ${message}\n`);
  }
  process.stdout.write(`\ncheck:policy found ${String(findings.length)} violation(s).\n`);
  process.exit(1);
}

process.stdout.write(`check:policy: clean — ${String(files.length)} shipped file(s).\n`);
