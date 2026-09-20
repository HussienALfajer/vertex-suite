import type { BranchId, DeviceId, TenantId } from '@vertex/contracts';
import { isId, ok, parseId, refuse, type Result } from '@vertex/kernel';

import {
  NUMBERING_FIELDS,
  type IssuedNumber,
  type NumberingField,
  type NumberingRefusal,
  type NumberingSeries,
  type NumberingSpecimen,
  type RecordSession,
  type SeriesScope,
} from './contract.js';
import { readRecord, scanRecords, writeRecord } from './records.js';
import { branchIn, companyIn, registerIn } from './structure.js';

/**
 * `SYS-02`: the document number, and why it needs nobody's permission to exist.
 *
 * The hard case is stated in the feature and is worth restating, because every
 * decision below follows from it. A register prints sales all day with no
 * connection. The machine dies. A replacement is plugged into the same till,
 * and **nobody knows which of the dead machine's numbers ever reached the store
 * node** — that is what "unsynced" means. Any scheme in which the replacement
 * has to continue the old machine's count is a scheme that has to know
 * something nobody knows.
 *
 * So it does not continue it. Each machine counts from one, and every number
 * carries the register's prefix — unique across the tenant — and the generation
 * under which that machine took the position. Two runs of "1, 2, 3" on one till
 * are six different numbers, and no coordination took place at any point. That
 * is what "offline-safe by construction" means, as against offline-safe by
 * reservation, which is a promise that fails exactly when the connection does.
 */

const DEFAULT_REGISTER_FORMAT = '{prefix}-{generation}-{year}-{sequence:6}';
const DEFAULT_BRANCH_FORMAT = '{year}-{sequence:6}';

type FieldName = NumberingField;

/** Only a number can be padded; padding a prefix would be padding a name. */
const PADDABLE: ReadonlySet<FieldName> = new Set<FieldName>(['sequence', 'generation']);
/** From the published list, so that the grammar and what is published are one thing. */
const FIELDS: ReadonlySet<string> = new Set<FieldName>(NUMBERING_FIELDS);

type Token =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'field'; readonly name: FieldName; readonly width: number };

/**
 * Reads a format, or refuses to.
 *
 * Returns null rather than a partial parse: a format is configuration an
 * administrator typed, and half-understanding it would print half a number on
 * a document that cannot be reprinted.
 */
function parseFormat(format: string): readonly Token[] | null {
  const tokens: Token[] = [];
  let literal = '';
  let index = 0;

  while (index < format.length) {
    const character = format[index] ?? '';
    if (character === '}') return null;
    if (character !== '{') {
      literal += character;
      index += 1;
      continue;
    }

    const close = format.indexOf('}', index);
    if (close === -1) return null;
    const inside = format.slice(index + 1, close);
    const parts = inside.split(':');
    if (parts.length > 2) return null;
    const [name, width] = parts;
    if (name === undefined || !FIELDS.has(name)) return null;
    const field = name as FieldName;

    let padding = 1;
    if (width !== undefined) {
      if (!PADDABLE.has(field) || !/^[1-9]\d?$/.test(width)) return null;
      padding = Number(width);
    }

    if (literal !== '') {
      tokens.push({ kind: 'literal', text: literal });
      literal = '';
    }
    tokens.push({ kind: 'field', name: field, width: padding });
    index = close + 1;
  }

  if (literal !== '') tokens.push({ kind: 'literal', text: literal });
  return tokens;
}

function fieldsOf(tokens: readonly Token[]): ReadonlySet<FieldName> {
  const present = new Set<FieldName>();
  for (const token of tokens) {
    if (token.kind === 'field') present.add(token.name);
  }
  return present;
}

/**
 * What each field can print, from the rules that shape its value: a count and a
 * generation are digits, a prefix is `PREFIX` in `structure.ts`, a fiscal year
 * is `FISCAL_YEAR` below.
 */
const PRINTS: Readonly<Record<FieldName, RegExp>> = {
  sequence: /^\d$/,
  generation: /^\d$/,
  prefix: /^[A-Za-z0-9]$/,
  year: /^[A-Za-z0-9-]$/,
};

/**
 * Whether a printed number can be read back into the fields that made it.
 *
 * Two fields with nothing between them run into each other: `{prefix}{sequence}`
 * prints `T123` for till `T1`'s 23rd document and for till `T12`'s 3rd, and
 * padding does not rescue it, because a count outgrows its width.
 *
 * With something between them, the boundary can be found from one side or the
 * other: from the left when the first character between them is one the left
 * field cannot print, from the right when the last character is one the right
 * field cannot print. `{year}-{sequence}` reads back although a year may hold a
 * dash — the count holds none — and `{prefix}g{generation}` reads back although
 * a prefix may hold a `g`. What cannot be read from either side is refused:
 * `{prefix}1{sequence}` prints `AL11001` for `AL1`'s 1001st and `AL`'s 1st.
 */
function fieldsSeparated(tokens: readonly Token[]): boolean {
  let left: FieldName | null = null;
  let between = '';
  for (const token of tokens) {
    if (token.kind === 'literal') {
      between += token.text;
      continue;
    }
    if (left !== null) {
      if (between === '') return false;
      const fromLeft = !PRINTS[left].test(between.at(0) ?? '');
      const fromRight = !PRINTS[token.name].test(between.at(-1) ?? '');
      if (!fromLeft && !fromRight) return false;
    }
    left = token.name;
    between = '';
  }
  return true;
}

/**
 * The format is configurable, and bounded by the things that make it safe.
 *
 * An administrator who could drop `{generation}` from a register's format would
 * be turning off `SYS-02`'s guarantee from a settings screen, with nothing
 * failing until the day a till is replaced. So the two marks are not optional
 * decoration on a register series; a format without them is refused, and a
 * format that asks for them where there is no register is refused too, because
 * there would be nothing to fill them from.
 *
 * The same reasoning holds for the year and for the separators. A series counts
 * from one each fiscal year, so a format without `{year}` prints last year's
 * numbers again; and parts that run into each other print two different
 * documents under one number. Both are refused where they can still be retyped.
 */
function checkFormat(
  format: string,
  hasRegister: boolean,
): Result<readonly Token[], NumberingRefusal> {
  const tokens = parseFormat(format);
  if (tokens === null) return refuse('sys.series-format-invalid', { format });

  const present = fieldsOf(tokens);
  if (!present.has('sequence')) {
    // Without a counter every document of the series takes the same number,
    // which is not a numbering series but a rubber stamp.
    return refuse('sys.series-format-invalid', { format });
  }

  const carriesRegister = present.has('prefix') && present.has('generation');
  const mentionsRegister = present.has('prefix') || present.has('generation');
  if (hasRegister && !carriesRegister) {
    return refuse('sys.series-format-must-carry-register', { format });
  }
  if (!hasRegister && mentionsRegister) {
    return refuse('sys.series-format-carries-absent-register', { format });
  }
  if (!present.has('year')) return refuse('sys.series-format-must-carry-year', { format });
  if (!fieldsSeparated(tokens)) return refuse('sys.series-format-fields-adjacent', { format });
  return ok(tokens);
}

interface Filling {
  readonly sequence: number;
  readonly prefix: string;
  readonly generation: number;
  readonly year: string;
}

function render(tokens: readonly Token[], filling: Filling): string {
  let rendered = '';
  for (const token of tokens) {
    if (token.kind === 'literal') {
      rendered += token.text;
      continue;
    }
    const value =
      token.name === 'prefix'
        ? filling.prefix
        : token.name === 'year'
          ? filling.year
          : String(token.name === 'sequence' ? filling.sequence : filling.generation);
    rendered +=
      token.name === 'prefix' || token.name === 'year' ? value : value.padStart(token.width, '0');
  }
  return rendered;
}

/**
 * One series, as a key part: the four dimensions of `SYS-02`, in order.
 *
 * Each part is encoded before the join. The document type and the fiscal year
 * are strings the caller chose, so a separator inside one would shift the parts
 * and let two different series share a counter — which is the one failure a
 * numbering series may not have.
 */
function seriesKey(scope: SeriesScope): string {
  return [scope.documentType, scope.branch, scope.register ?? '-', scope.fiscalYear]
    .map(encodeURIComponent)
    .join('|');
}

/**
 * `pos.sale`, `pur.invoice`: a module's name and then the document's.
 *
 * Strict, and not merely "contains a dot", because the document type is half of
 * what tells two counters apart. `pos.sale` and `pos.sale ` would be two series
 * counting separately and **printing the same numbers**, since the type appears
 * in the key and not in the format. A stray space would put two sales of one
 * day under one number, and nothing would say so until somebody reconciled.
 */
const DOCUMENT_TYPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * A label, not a date. `SYS` does not know when a year turns — `FIN` does — so
 * whatever `FIN` calls it is what partitions the series: `2026`, `2026-27`,
 * `1447`. It is held to a shape for the reason above and no other.
 */
const FISCAL_YEAR = /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/;

function checkScope(scope: SeriesScope): Result<null, NumberingRefusal> {
  // A document type belongs to the module that issues it, the way every other
  // declared name in this system does. A bare "sale" names nobody, and two
  // modules would eventually both mean it.
  if (!DOCUMENT_TYPE.test(scope.documentType)) {
    return refuse('sys.document-type-unowned', { documentType: scope.documentType });
  }
  if (!FISCAL_YEAR.test(scope.fiscalYear)) {
    return refuse('sys.fiscal-year-required', { fiscalYear: scope.fiscalYear });
  }
  return ok(null);
}

interface Place {
  readonly prefix: string;
  readonly generation: number;
}

/**
 * Resolves what the number will say about where it came from — and whether this
 * machine is the one entitled to say it.
 */
function placeOf(
  session: RecordSession,
  tenant: TenantId,
  scope: SeriesScope,
  device: DeviceId | null,
): Result<Place, NumberingRefusal> {
  const branch = branchIn(session, tenant, scope.branch);
  if (branch === null) return refuse('sys.branch-not-found', { branch: scope.branch });
  if (!branch.active) return refuse('sys.branch-inactive', { branch: branch.name });
  // The legal entity that issues the document, one level further up. A company
  // withdrawn from use went on numbering documents in its branches, because only
  // the branch was asked.
  const company = companyIn(session, tenant, branch.company);
  if (company?.active !== true) {
    return refuse('sys.company-inactive', { company: company?.name ?? branch.company });
  }

  if (scope.register === null) return ok({ prefix: '', generation: 0 });

  const register = registerIn(session, tenant, scope.register);
  if (register === null) return refuse('sys.register-not-found', { register: scope.register });
  if (register.branch !== scope.branch) {
    return refuse('sys.register-outside-branch', { register: register.name });
  }
  if (!register.active) return refuse('sys.register-inactive', { register: register.name });
  if (register.heldBy === null) {
    // Nothing is standing at the till, so the number would have no generation
    // to carry and the guarantee would be a blank.
    return refuse('sys.register-has-no-device', { register: register.name });
  }
  // The generation keeps a replacement's numbers apart from the machine it
  // replaced — **provided the replaced machine stops**. It need not be dead: set
  // aside and switched on again, it reads the new generation after a sync and
  // counts from one under it, printing the replacement's numbers a second time.
  // The store node, which stands at no till, would print them a third. So only
  // the machine named as holding the till numbers its documents.
  const machine = device !== null && isId(device) ? parseId<'device'>(device) : null;
  if (machine === null || machine !== register.heldBy) {
    return refuse('sys.register-held-elsewhere', { register: register.name });
  }
  return ok({ prefix: register.prefix, generation: register.generation });
}

export function seriesIn(
  session: RecordSession,
  tenant: TenantId,
  scope: SeriesScope,
): NumberingSeries | null {
  return readRecord(session, 'series', tenant, [seriesKey(scope)]);
}

export function defineSeries(
  session: RecordSession,
  tenant: TenantId,
  scope: SeriesScope,
  format: string,
): Result<NumberingSeries, NumberingRefusal> {
  const scoped = checkScope(scope);
  if (!scoped.ok) return scoped;
  const place = placeAsConfigured(session, tenant, scope);
  if (!place.ok) return place;

  const checked = checkFormat(format, scope.register !== null);
  if (!checked.ok) return checked;

  const series: NumberingSeries = {
    tenant,
    scope: Object.freeze({ ...scope }),
    format,
  };
  return ok(writeRecord(session, 'series', tenant, [seriesKey(scope)], series));
}

/**
 * The same question as `placeOf`, asked of **configuration** rather than of a
 * document about to be printed.
 *
 * Defining a format happens before the till is plugged in as often as after, so
 * the checks here stop at "this is a real place in this tenant": whether it can
 * print — a machine standing at it, a branch still trading — is left to the
 * moment it tries to. A register nobody has plugged anything into reports
 * generation zero, which is the truth about it and exactly what a specimen
 * should show rather than hide behind a refusal.
 */
function placeAsConfigured(
  session: RecordSession,
  tenant: TenantId,
  scope: SeriesScope,
): Result<Place, NumberingRefusal> {
  if (branchIn(session, tenant, scope.branch) === null) {
    return refuse('sys.branch-not-found', { branch: scope.branch });
  }
  if (scope.register === null) return ok({ prefix: '', generation: 0 });

  const register = registerIn(session, tenant, scope.register);
  if (register === null) return refuse('sys.register-not-found', { register: scope.register });
  if (register.branch !== scope.branch) {
    return refuse('sys.register-outside-branch', { register: register.name });
  }
  return ok({ prefix: register.prefix, generation: register.generation });
}

/**
 * The format a scope's numbers are actually taken under, and where it came from.
 *
 * A format defined for one fiscal year carries into the years after it until
 * somebody defines another. A series is counted per year, but a format is a
 * decision about what a document looks like, and it once lapsed silently at the
 * year's end: the first sale of the new year printed under the default, on a
 * document that cannot be reprinted. The nearest earlier year's format is the
 * one in force; years are compared as the labels they are, which orders
 * `2026`, `2026-27` and `1447` the way each scheme counts.
 */
function formatInForce(
  session: RecordSession,
  tenant: TenantId,
  scope: SeriesScope,
): { readonly format: string; readonly isDefault: boolean } {
  const defined = seriesIn(session, tenant, scope);
  if (defined !== null) return { format: defined.format, isDefault: false };

  const earlier = scanRecords(session, 'series', tenant)
    .filter(
      (one) =>
        one.scope.documentType === scope.documentType &&
        one.scope.branch === scope.branch &&
        one.scope.register === scope.register &&
        one.scope.fiscalYear < scope.fiscalYear,
    )
    .sort((one, two) => (one.scope.fiscalYear < two.scope.fiscalYear ? 1 : -1))[0];
  if (earlier !== undefined) return { format: earlier.format, isDefault: false };

  return {
    format: scope.register === null ? DEFAULT_BRANCH_FORMAT : DEFAULT_REGISTER_FORMAT,
    isDefault: true,
  };
}

/**
 * Where a series' count lives: **per generation, not per series**.
 *
 * One function rather than the shape written out at each of the three places
 * that needs it — the read that issues, the write that advances, and the read
 * that only looks. A specimen taken from a differently-spelled key would be a
 * specimen of a number this till will never print.
 */
function counterKey(scope: SeriesScope, generation: number): readonly string[] {
  return [seriesKey(scope), String(generation)];
}

/** Where the counter stands, without moving it: what the next document gets. */
function sequenceAt(
  session: RecordSession,
  tenant: TenantId,
  scope: SeriesScope,
  generation: number,
): number {
  return readRecord(session, 'counter', tenant, counterKey(scope, generation))?.next ?? 1;
}

/**
 * What a scope's next number would look like, under a proposed format or under
 * the one in force (`format` null).
 *
 * Reads only. It is the same parser and the same renderer `nextNumber` uses,
 * reached the only way a screen is allowed to reach them — which is the point:
 * a dialog that worked the answer out for itself would be a second copy of the
 * thing that prints on every receipt in the shop, and the two would drift.
 */
export function specimenOf(
  session: RecordSession,
  tenant: TenantId,
  scope: SeriesScope,
  format: string | null,
): Result<NumberingSpecimen, NumberingRefusal> {
  const scoped = checkScope(scope);
  if (!scoped.ok) return scoped;

  const place = placeAsConfigured(session, tenant, scope);
  if (!place.ok) return place;

  const inForce =
    format === null ? formatInForce(session, tenant, scope) : { format, isDefault: false };
  const checked = checkFormat(inForce.format, scope.register !== null);
  if (!checked.ok) return checked;

  const { prefix, generation } = place.value;
  const sequence = sequenceAt(session, tenant, scope, generation);
  return ok({
    scope: Object.freeze({ ...scope }),
    format: inForce.format,
    isDefault: inForce.isDefault,
    specimen: render(checked.value, { sequence, prefix, generation, year: scope.fiscalYear }),
    sequence,
    generation,
  });
}

/**
 * Every series somebody has configured in one branch, in a stable order.
 *
 * Ordered here rather than left to the store, because the order a list is read
 * in is part of being readable: a screen that rearranged itself between two
 * reads would make an administrator lose the row they were looking at. Sorted
 * by the parts of the scope that a person can actually see — the document type
 * first, then the till, then the year — and a series with no till sorts before
 * the tills, because that is the branch's own.
 */
export function configuredSeries(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
): readonly NumberingSpecimen[] {
  const found: NumberingSpecimen[] = [];
  for (const series of scanRecords(session, 'series', tenant)) {
    if (series.scope.branch !== branch) continue;
    const specimen = specimenOf(session, tenant, series.scope, series.format);
    if (!specimen.ok) {
      // Impossible by construction, and raised rather than skipped because of
      // what skipping would look like. Every stored format passed `checkFormat`
      // when it was defined, nothing this module offers can invalidate one
      // afterwards — no structural entity is ever deleted, and the only way to
      // change a format is `defineSeries`, which checks it again — so a refusal
      // here is a defect in this file rather than an answer about the shop. A
      // row quietly missing from a numbering screen is a series nobody
      // maintains and nobody knows they are not maintaining.
      throw new Error(`A stored numbering series will not render: ${specimen.error.code}.`);
    }
    found.push(specimen.value);
  }

  return found.sort((one, two) => compareBy(orderOf(one.scope), orderOf(two.scope)));
}

function orderOf(scope: SeriesScope): readonly string[] {
  return [scope.documentType, scope.register ?? '', scope.fiscalYear];
}

/** Plain comparisons rather than a locale's: every part here is ASCII by rule. */
function compareBy(one: readonly string[], two: readonly string[]): number {
  for (const [index, left] of one.entries()) {
    const right = two[index] ?? '';
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

/**
 * Takes the next number of a series.
 *
 * Written against a session the caller already has open, so that the counter
 * moves only if the document does. A sale that rolls back takes its number with
 * it, and the series has no gap for anybody to ask about.
 */
export function nextNumber(
  session: RecordSession,
  tenant: TenantId,
  scope: SeriesScope,
  reference: string,
  device: DeviceId | null,
): Result<IssuedNumber, NumberingRefusal> {
  const scoped = checkScope(scope);
  if (!scoped.ok) return scoped;
  // One document, one spelling. The reference is usually the document's own
  // identifier, and a UUID is case-insensitive by specification: the same sale
  // replayed with its identifier upper-cased took a second number.
  const trimmed = reference.trim();
  const document = isId(trimmed) ? parseId(trimmed) : trimmed;
  if (document === '') {
    // The caller's own reference is what makes the issue repeatable, so an
    // empty one is not a small omission: two documents that both passed it
    // would be told they are the same document and would print one number
    // between them. Loud here, silent and unrecoverable later.
    return refuse('sys.document-reference-required');
  }

  const key = seriesKey(scope);

  // Before anything else, and deliberately. `SYN-02` delivers at least once,
  // so this call may be the second one for a document that was numbered on a
  // machine that has since been replaced and a till that has since been shut.
  // None of that changes what was printed, so none of it may refuse now.
  const already = readRecord(session, 'issued', tenant, [document, key]);
  if (already !== null) return ok(already);
  // One row per numbered document, kept for as long as a replay can arrive.
  // That window is the outbox's, not this module's, so pruning belongs to the
  // slice that owns the outbox — `U07` — and until then it is unbounded and
  // known to be.

  const place = placeOf(session, tenant, scope, device);
  if (!place.ok) return place;

  // Through the same function a specimen asks. Written out here once and there
  // once, the two would agree until somebody changed a default — and the day
  // they stopped agreeing, a screen would show an administrator one number and
  // the till would print another.
  const inForce = formatInForce(session, tenant, scope);
  const checked = checkFormat(inForce.format, scope.register !== null);
  if (!checked.ok) return checked;

  // The counter is per generation, not per series. See the note at the top of
  // this file: carrying it across a handover is the one thing that cannot be
  // done without knowing what the replaced machine never told anyone.
  const sequence = sequenceAt(session, tenant, scope, place.value.generation);

  const issued: IssuedNumber = {
    number: render(checked.value, {
      sequence,
      prefix: place.value.prefix,
      generation: place.value.generation,
      year: scope.fiscalYear,
    }),
    sequence,
    generation: place.value.generation,
    scope: Object.freeze({ ...scope }),
  };

  writeRecord<'counter'>(session, 'counter', tenant, counterKey(scope, place.value.generation), {
    next: sequence + 1,
  });
  return ok(writeRecord(session, 'issued', tenant, [document, key], issued));
}
