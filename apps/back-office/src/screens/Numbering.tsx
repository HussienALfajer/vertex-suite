import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  actionsColumnWidth,
  Banner,
  Button,
  Code,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  TableRowAction,
  TableRowActions,
  TextInput,
  useAttempt,
  useToast,
  useTranslator,
  type DataTableColumn,
  type SelectOption,
} from '@vertex/ui';
import type { Result } from '@vertex/kernel';
import {
  NUMBERING_FIELDS,
  type Branch,
  type NumberingRefusal,
  type NumberingSpecimen,
  type Register,
  type SeriesScope,
} from '@vertex/sys/contract';

import { messageForRefusal } from '../catalogue.js';
import { useDeliveryMessage, useLoaded, useOrganisation } from '../organisation.js';
import { hrefOf, redirect, useNavigateTo, useRoute } from '../routing.js';
import { FormatIcon, StaleBanner, matchesQuery } from './structure.js';

/**
 * `SYS-02` as an accountant configures it.
 *
 * **The hardest thing this screen has to say is that an empty list is not a
 * problem.** A shop numbers every document from its first sale with nothing
 * configured at all — that is what "offline-safe by construction" buys — so a
 * screen that presented numbering as setup waiting to be done would send
 * somebody looking for a setting they do not need. What is listed here is what
 * has been *overridden*; the empty state says the rest.
 *
 * **Nothing here parses or renders a format.** The specimen beside every row,
 * and the one that follows the field as it is typed, comes from `SYS` through
 * `preview` — which takes nothing and moves no counter. A dialog that worked
 * the answer out for itself would hold a second copy of the code that prints on
 * every receipt in the shop, and the copy would be the one that goes stale.
 *
 * The **branch** is in the address, because the list cannot be read without one
 * and because that makes what somebody is looking at a thing they can send to a
 * colleague. The **till** is an ordinary filter in this component's state: it
 * narrows a list that is already on screen rather than deciding what the screen
 * is about.
 */

/** Stands for "every till" in the filter. No identifier can collide with it. */
const EVERY_REGISTER = '*';

/**
 * Stands for the series a branch issues from no till at all — a purchase
 * invoice somebody types, a credit note. `null` in the scope; it needs a
 * spelling here only because a listbox option is a string.
 */
const NO_REGISTER = '-';

/**
 * A key for a row, which is what the scope already is.
 *
 * `SYS` keys a series by these four parts and nothing else, so two rows share a
 * key exactly when they are the same series — and the branch is common to every
 * row on this screen, so three of them are enough.
 *
 * **Each part is encoded, and the reason is the DOM rather than ambiguity.** A
 * row key reaches the page inside the `id` of the elements React Aria builds
 * for the row, so anything in it that a CSS selector cannot carry — a quote
 * above all — turns every later lookup of those elements into a thrown
 * exception. Encoding also makes the join unambiguous, which is the same thing
 * `SYS` does to its own key and for the same second reason.
 */
function keyOf(scope: SeriesScope): string {
  return [scope.documentType, scope.register ?? '', scope.fiscalYear]
    .map(encodeURIComponent)
    .join('|');
}

interface SeriesRow {
  readonly id: string;
  readonly series: NumberingSpecimen;
  /** The till's name as it should read here, which a scope only holds the identifier of. */
  readonly register: string;
}

export function Numbering(): ReactNode {
  const translator = useTranslator();
  const goTo = useNavigateTo();
  const route = useRoute();
  const { branches, isLoading, unreachable, ofRecord } = useOrganisation();

  const [query, setQuery] = useState('');
  const [tillFilter, setTillFilter] = useState<string>(EVERY_REGISTER);
  const [isDefining, setIsDefining] = useState(false);
  const [revising, setRevising] = useState<NumberingSpecimen | null>(null);

  const openBranches = useMemo(() => branches.filter((one) => one.active), [branches]);
  const chosen = useMemo(
    () => branches.find((one) => one.id === route.subject) ?? null,
    [branches, route.subject],
  );

  useEffect(() => {
    if (chosen !== null || branches.length === 0) return;
    const first = openBranches[0] ?? branches[0];
    if (first !== undefined) redirect(hrefOf('numbering', first.id));
  }, [chosen, branches, openBranches]);

  // A till belongs to one branch, so a filter naming one means nothing in the
  // branch next door: it would match no series at all, and the control holding
  // it would show no value — an empty list with nothing on screen explaining
  // it. Cleared here rather than in the branch chooser, because the branch also
  // changes from the address bar, which no control sees.
  useEffect(() => {
    setTillFilter(EVERY_REGISTER);
  }, [chosen?.id]);

  const readSeries = useCallback(
    (branch: Branch['id']) => ofRecord.numbering.configured(branch),
    [ofRecord],
  );
  const series = useLoaded(chosen?.id ?? null, readSeries);

  // The tills of this branch, read here as well as on their own screen. A scope
  // holds a register's identifier and nothing else — `SYS` has no business
  // knowing what a screen wants to call it — so the names have to come from
  // somewhere, and this is the screen that needs them.
  const readRegisters = useCallback(
    (branch: Branch['id']) => ofRecord.registers.list(branch, { including: 'all' }),
    [ofRecord],
  );
  const registers = useLoaded(chosen?.id ?? null, readRegisters);
  const tills = useMemo(() => registers.value ?? [], [registers.value]);

  // The two reads start together and settle apart, and until the second one
  // lands there is a till this screen cannot name. Saying so is the difference
  // between a cell that is waiting and a cell that says a till of this branch
  // is not known to it — which would be a sentence about the shop, and untrue.
  const areTillsKnown = registers.value !== null;

  const nameOfRegister = useCallback(
    (id: SeriesScope['register']): string => {
      if (id === null) return translator.format('numbering.register.none');
      const till = tills.find((one) => one.id === id);
      if (till === undefined) {
        return translator.format(areTillsKnown ? 'numbering.register.unknown' : 'data.loading');
      }
      // A withdrawn till keeps its series, because the documents it issued keep
      // their numbers (`SYS-09`). Saying so in the row is what stops somebody
      // wondering why a format they are looking at prints nothing.
      return till.active
        ? till.name
        : translator.format('numbering.register.withdrawn', { name: till.name });
    },
    [tills, areTillsKnown, translator],
  );

  const rows = useMemo(
    (): readonly SeriesRow[] =>
      (series.value ?? [])
        .filter((one) => {
          const till = one.scope.register;
          const passesFilter =
            tillFilter === EVERY_REGISTER ||
            (tillFilter === NO_REGISTER ? till === null : till === tillFilter);
          return passesFilter && matchesQuery(one.scope.documentType, query);
        })
        .map((one) => ({
          id: keyOf(one.scope),
          series: one,
          register: nameOfRegister(one.scope.register),
        })),
    [series.value, tillFilter, query, nameOfRegister],
  );

  /**
   * The years this branch already numbers under.
   *
   * Offered as the starting value for a new series, and taken from the shop's
   * own data rather than from a clock — nothing in this product reads the
   * ambient one (`README.md`), and which year is current is `FIN`'s question
   * rather than this screen's. A shop configuring its second series is almost
   * always in the same year as its first.
   */
  const years = useMemo(
    () => [...new Set((series.value ?? []).map((one) => one.scope.fiscalYear))].sort(),
    [series.value],
  );

  /**
   * Widths, and the reason this is the one table in the application that states
   * them.
   *
   * A grid lays its columns out in equal shares, which is right where every
   * column holds a name and wrong here: a format is forty characters of
   * monospace beside a fiscal year of four, and an equal share wraps the one
   * column somebody is reading onto three lines while the one beside it holds a
   * single word. The totals come to more than a narrow window, and that is what
   * §9 says to do with wide content — the grid scrolls inside its own panel,
   * and the page never scrolls sideways.
   */
  const columns: readonly DataTableColumn<SeriesRow>[] = [
    {
      id: 'documentType',
      header: translator.format('numbering.column.documentType'),
      isRowHeader: true,
      width: 140,
      // Monospaced: it is a name a module chose, read as characters rather than
      // as words, and it is never translated.
      render: (row) => <Code>{row.series.scope.documentType}</Code>,
    },
    {
      id: 'register',
      header: translator.format('numbering.column.register'),
      width: 150,
      render: (row) => <span className="text-fg-secondary">{row.register}</span>,
    },
    {
      id: 'fiscalYear',
      header: translator.format('numbering.column.fiscalYear'),
      width: 110,
      render: (row) => <Code className="text-fg-secondary">{row.series.scope.fiscalYear}</Code>,
    },
    {
      id: 'format',
      header: translator.format('numbering.column.format'),
      // The widest thing on the screen, and the thing being configured: the
      // default of `SYS-02` measures 320px set in the monospaced face, and a
      // column that wrapped it would wrap the one thing here nobody can read at
      // a glance.
      width: 340,
      render: (row) => <Code className="text-fg-secondary">{row.series.format}</Code>,
    },
    {
      id: 'specimen',
      // The column the screen exists for. A format is unreadable and what it
      // prints is not, so the thing an accountant is actually deciding about
      // stands in the list rather than only inside the dialog.
      header: translator.format('numbering.column.specimen'),
      width: 170,
      render: (row) => <Code className="font-body-medium">{row.series.specimen}</Code>,
    },
    {
      id: 'actions',
      header: translator.format('numbering.column.actions'),
      align: 'end',
      width: actionsColumnWidth(1),
      render: (row) => (
        <TableRowActions>
          <TableRowAction
            aria-label={translator.format('numbering.revise.action')}
            onPress={() => {
              setRevising(row.series);
            }}
          >
            <FormatIcon />
          </TableRowAction>
        </TableRowActions>
      ),
    },
  ];

  if (branches.length === 0 && unreachable) {
    return (
      <>
        <PageHeader
          title={translator.format('numbering.title')}
          description={translator.format('numbering.description')}
        />
        <StaleBanner />
      </>
    );
  }

  if (branches.length === 0 && !isLoading) {
    return (
      <>
        <PageHeader
          title={translator.format('numbering.title')}
          description={translator.format('numbering.description')}
        />
        <StaleBanner />
        <EmptyState
          message={translator.format('numbering.noBranches')}
          description={translator.format('numbering.noBranches.explanation')}
          action={
            <Button
              tone="primary"
              onPress={() => {
                goTo('branches');
              }}
            >
              {translator.format('numbering.noBranches.action')}
            </Button>
          }
        />
      </>
    );
  }

  const branchOptions: readonly SelectOption[] = branches.map((one) => ({
    id: one.id,
    label: one.name,
  }));

  const tillOptions: readonly SelectOption[] = [
    { id: EVERY_REGISTER, label: translator.format('numbering.filter.allRegisters') },
    { id: NO_REGISTER, label: translator.format('numbering.register.none') },
    ...tills.map((one) => ({
      id: one.id,
      label: one.active
        ? one.name
        : translator.format('numbering.register.withdrawn', { name: one.name }),
    })),
  ];

  return (
    <>
      <PageHeader
        title={translator.format('numbering.title')}
        description={translator.format('numbering.description')}
        actions={
          <Button
            tone="primary"
            isDisabled={chosen === null}
            onPress={() => {
              setIsDefining(true);
            }}
          >
            {translator.format('numbering.define')}
          </Button>
        }
      />

      <StaleBanner />

      {/*
       * `ListingBar` is not used here, and the difference is the switch it
       * carries: a series is never withdrawn from use. `SYS-09`'s rows are
       * deactivated and kept, a series is simply a format that is either
       * defined or not — so the shared bar would be offering a state that does
       * not exist.
       */}
      <div className="flex flex-wrap items-end gap-[var(--vx-gap-md)]">
        <SearchInput
          label={translator.format('numbering.search')}
          placeholder={translator.format('numbering.search')}
          value={query}
          onChange={setQuery}
          className="w-[18rem] max-w-full"
        />
        <Select
          label={translator.format('numbering.branch')}
          placeholder={translator.format('numbering.branch.placeholder')}
          options={branchOptions}
          value={chosen?.id ?? null}
          onChange={(key) => {
            redirect(hrefOf('numbering', String(key)));
          }}
          className="w-[16rem] max-w-full"
        />
        <Select
          label={translator.format('numbering.filter.register')}
          options={tillOptions}
          value={tillFilter}
          onChange={(key) => {
            setTillFilter(String(key));
          }}
          className="w-[16rem] max-w-full"
        />
      </div>

      {series.unreachable ? null : (series.value ?? []).length === 0 && !series.isLoading ? (
        <EmptyState
          message={translator.format('numbering.empty')}
          description={translator.format('numbering.empty.explanation')}
          action={
            <Button
              tone="primary"
              isDisabled={chosen === null}
              onPress={() => {
                setIsDefining(true);
              }}
            >
              {translator.format('numbering.define')}
            </Button>
          }
        />
      ) : (
        <Panel flush>
          <DataTable
            label={translator.format('numbering.table')}
            columns={columns}
            rows={rows}
            emptyMessage={translator.format(series.isLoading ? 'data.loading' : 'listing.noMatch')}
          />
        </Panel>
      )}

      {chosen === null ? null : (
        <>
          <SeriesDialog
            branch={chosen}
            registers={tills}
            subject={null}
            years={years}
            isOpen={isDefining}
            onOpenChange={setIsDefining}
            onSaved={series.reload}
          />
          <SeriesDialog
            branch={chosen}
            registers={tills}
            subject={revising}
            years={years}
            isOpen={revising !== null}
            onOpenChange={(isOpen) => {
              if (!isOpen) setRevising(null);
            }}
            onSaved={() => {
              setRevising(null);
              series.reload();
            }}
          />
        </>
      )}
    </>
  );
}

interface SeriesDialogProps {
  readonly branch: Branch;
  readonly registers: readonly Register[];
  /** The series being revised, or null when one is being defined. */
  readonly subject: NumberingSpecimen | null;
  /** The years this branch already numbers under: what a second series most likely wants. */
  readonly years: readonly string[];
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSaved: () => void;
}

/**
 * Defining a series, and revising one — one dialog, because the difference
 * between them is which parts are still a question.
 *
 * **The scope is the series' identity**, not four of its fields. Changing the
 * document type of an existing series would not rename it; it would define a
 * second one and leave the first exactly as it was, printing exactly as it did,
 * with nothing on screen saying so. So when a series is being revised the scope
 * is shown rather than offered, and the only question left is the format.
 *
 * The specimen under the field follows every keystroke. That is the whole point
 * of the dialog: `{prefix}-{generation}-{year}-{sequence:6}` is unreadable, and
 * what it prints is not — and the second is what ends up on a document nobody
 * can reprint.
 */
function SeriesDialog({
  branch,
  registers,
  subject,
  years,
  isOpen,
  onOpenChange,
  onSaved,
}: SeriesDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { run, ofRecord } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [documentType, setDocumentType] = useState('');
  const [till, setTill] = useState<string>(NO_REGISTER);
  const [fiscalYear, setFiscalYear] = useState('');
  const [format, setFormat] = useState('');
  /**
   * The format this screen suggested, if it suggested one, and where it came
   * from.
   *
   * Held rather than a flag for two reasons. A suggestion is the screen's to
   * withdraw when the shape of the series changes under it, and something
   * somebody typed never is — so the two have to be told apart. And a
   * suggestion that came from the **default** is worth saying out loud, for as
   * long as it is still what is in the field: an accountant looking at a format
   * needs to know whether they are looking at a decision somebody made or at
   * what the product does when nobody has.
   */
  const [suggested, setSuggested] = useState<{ format: string; isDefault: boolean } | null>(null);
  const [missing, setMissing] = useState({ documentType: false, fiscalYear: false, format: false });

  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(subject ?? isOpen, () => {
    setDocumentType(subject?.scope.documentType ?? '');
    setTill(subject?.scope.register ?? NO_REGISTER);
    // The last year this branch numbers under, which is the one a second series
    // almost always belongs to. Empty in a shop that has configured nothing.
    setFiscalYear(subject?.scope.fiscalYear ?? years.at(-1) ?? '');
    setFormat(subject?.format ?? '');
    setSuggested(null);
    setMissing({ documentType: false, fiscalYear: false, format: false });
  });

  // The record rather than the key out of the listbox, so what is put in the
  // scope is a till this branch actually has.
  const picked = useMemo(() => registers.find((one) => one.id === till) ?? null, [registers, till]);

  /**
   * What is being asked about, or null while the question is incomplete.
   *
   * A series being revised is asked about by its own scope and not by the
   * fields, which is the same statement as "the scope is the identity" made
   * where it has an effect.
   */
  const scope = useMemo((): SeriesScope | null => {
    if (subject !== null) return subject.scope;
    if (documentType.trim() === '' || fiscalYear.trim() === '') return null;
    return {
      documentType: documentType.trim(),
      branch: branch.id,
      register: picked?.id ?? null,
      fiscalYear: fiscalYear.trim(),
    };
  }, [subject, documentType, fiscalYear, branch.id, picked]);

  const proposed = format.trim();

  /**
   * One preview per distinct question, keyed by the question itself.
   *
   * Not debounced, and that is a decision about where this runs rather than an
   * omission. The answer is a parse and a render over records already in the
   * transaction the read opens, and the machine answering is the store node in
   * the same room (`modules.md` §2) — while a specimen that arrives a moment
   * after the keystroke that caused it is a specimen somebody has stopped
   * watching. `useLoaded` discards an answer that has been overtaken, so a slow
   * one can never land on top of a newer one.
   */
  const asked =
    scope === null
      ? null
      : JSON.stringify([scope.documentType, scope.register, scope.fiscalYear, proposed]);

  const preview = useLoaded(asked, () =>
    scope === null
      ? Promise.resolve(null)
      : ofRecord.numbering.preview(scope, proposed === '' ? null : proposed),
  );
  const shown = preview.value;

  /**
   * A **new** series starts from whatever is printing under that scope today —
   * the default, since nothing is defined there — so that the first thing an
   * accountant sees is what they are changing rather than a blank.
   *
   * Twice guarded, and both guards were paid for. `subject` keeps it away from
   * a series being revised, whose field already holds the stored format:
   * without that, clearing the field to retype it refilled it and the typing
   * landed on the end of what was supposed to be gone. `suggested` keeps it to
   * once per opening, so that a field somebody cleared on purpose stays clear.
   */
  useEffect(() => {
    if (subject !== null || suggested !== null || format !== '' || shown?.ok !== true) return;
    setFormat(shown.value.format);
    setSuggested({ format: shown.value.format, isDefault: shown.value.isDefault });
  }, [subject, suggested, format, shown]);

  /** Whether the field still holds the default this screen put there untouched. */
  const isUntouchedDefault = suggested?.isDefault === true && format === suggested.format;

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blank = {
      documentType: subject === null && documentType.trim() === '',
      fiscalYear: subject === null && fiscalYear.trim() === '',
      format: proposed === '',
    };
    setMissing(blank);
    if (scope === null || blank.documentType || blank.fiscalYear || blank.format) {
      setRefused(null);
      return;
    }

    // Everything else about the scope and the format is the domain's judgement,
    // and it has already been rendered under the field by `preview` — the same
    // check, asked of the same values, by the same code that will do the
    // printing.
    const target = scope;
    await attemptWith(async () => {
      const delivery = await run((of) => of.numbering.define(target, proposed));
      const message = messageFor(delivery);
      if (message === null) {
        onSaved();
        toast.show(translator.format('numbering.saved', { documentType: target.documentType }), {
          tone: 'success',
        });
        onOpenChange(false);
      }
      return message;
    });
  }

  const tillOptions: readonly SelectOption[] = [
    { id: NO_REGISTER, label: translator.format('numbering.register.none') },
    ...registers.map((one) => ({
      id: one.id,
      label: one.active
        ? one.name
        : translator.format('numbering.register.withdrawn', { name: one.name }),
    })),
  ];

  return (
    <Dialog
      title={translator.format(subject === null ? 'numbering.new.title' : 'numbering.revise.title')}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="max-w-[40rem]"
      footer={
        <>
          <Button
            tone="secondary"
            onPress={() => {
              onOpenChange(false);
            }}
          >
            {translator.format('action.cancel')}
          </Button>
          <Button
            tone="primary"
            isDisabled={isWorking}
            onPress={() => {
              void attempt();
            }}
          >
            {translator.format('numbering.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}

        {subject === null ? (
          <>
            <TextInput
              label={translator.format('numbering.documentType')}
              description={translator.format('numbering.documentType.description')}
              value={documentType}
              onChange={(next) => {
                setDocumentType(next);
                setMissing((was) => ({ ...was, documentType: false }));
              }}
              autoFocus
              isRequired
              isMachineText
              {...(missing.documentType
                ? { errorMessage: translator.format('numbering.documentType.required') }
                : {})}
            />
            <Select
              label={translator.format('numbering.register')}
              description={translator.format('numbering.register.description')}
              options={tillOptions}
              value={till}
              onChange={(key) => {
                setTill(String(key));
                // A series with a till and one without take different formats —
                // one has to carry the prefix and the generation, the other
                // cannot — so a format this screen suggested for the previous
                // shape is withdrawn and suggested again. One somebody typed
                // stands, and is refused under the field if it no longer fits.
                if (format === suggested?.format) {
                  setFormat('');
                  setSuggested(null);
                }
              }}
            />
            <TextInput
              label={translator.format('numbering.fiscalYear')}
              description={translator.format('numbering.fiscalYear.description')}
              value={fiscalYear}
              onChange={(next) => {
                setFiscalYear(next);
                setMissing((was) => ({ ...was, fiscalYear: false }));
              }}
              isRequired
              isMachineText
              {...(missing.fiscalYear
                ? { errorMessage: translator.format('numbering.fiscalYear.required') }
                : {})}
            />
          </>
        ) : (
          <>
            <Banner tone="info">{translator.format('numbering.revise.note')}</Banner>
            {/* The scope, shown rather than offered. Not disabled fields:
                these three are what the series *is*, and a greyed-out input
                invites somebody to wonder why they cannot change it.

                Left here rather than published as the `KeyValueList` the
                inventory names, deliberately. It is text and layout rather than
                a control, and §10 keeps a component out of `packages/ui` until
                a screen has used it — an API designed for one caller is the
                API discovered to be wrong at the second. The day a second
                screen wants one, it arrives with that screen and this moves
                into it. */}
            <dl className="bg-surface-2 border-line flex flex-col gap-[var(--vx-gap-xs)] rounded border p-[var(--vx-pad-md)]">
              <ScopeLine
                label={translator.format('numbering.documentType')}
                value={subject.scope.documentType}
                isCode
              />
              <ScopeLine
                label={translator.format('numbering.register')}
                value={
                  subject.scope.register === null
                    ? translator.format('numbering.register.none')
                    : (registers.find((one) => one.id === subject.scope.register)?.name ??
                      translator.format('numbering.register.unknown'))
                }
              />
              <ScopeLine
                label={translator.format('numbering.fiscalYear')}
                value={subject.scope.fiscalYear}
                isCode
              />
            </dl>
          </>
        )}

        <TextInput
          label={translator.format('numbering.format')}
          description={translator.format('numbering.format.description')}
          value={format}
          onChange={(next) => {
            setFormat(next);
            setMissing((was) => ({ ...was, format: false }));
          }}
          isRequired
          isMachineText
          {...(subject === null ? {} : { autoFocus: true })}
          {...(missing.format
            ? { errorMessage: translator.format('numbering.format.required') }
            : {})}
        />

        {/* Said about the **field** rather than about the specimen, because it
            is a fact about where the text came from: this is what the product
            prints when nobody has decided otherwise, and it stops being true
            the moment somebody edits it. */}
        {isUntouchedDefault ? (
          <p className="text-footnote text-fg-muted">
            {translator.format('numbering.specimen.default')}
          </p>
        ) : null}

        <Marks />
        <Specimen isAsked={asked !== null} isUnreachable={preview.unreachable} shown={shown} />

        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

function ScopeLine({
  label,
  value,
  isCode = false,
}: {
  readonly label: string;
  readonly value: string;
  /** A document type and a fiscal year are machine text; a till's name is not. */
  readonly isCode?: boolean;
}): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-[var(--vx-gap-md)]">
      <dt className="text-footnote text-fg-muted">{label}</dt>
      <dd className="text-footnote text-fg">{isCode ? <Code>{value}</Code> : value}</dd>
    </div>
  );
}

/**
 * What a format may be made of.
 *
 * The marks come from `SYS`, which owns the grammar; what each one means is
 * prose and comes from this application's catalogue. A list written out here
 * would keep working while the grammar moved under it, and the first anybody
 * would know is an administrator typing a mark that is refused.
 */
function Marks(): ReactNode {
  const translator = useTranslator();
  return (
    <div className="flex flex-col gap-[var(--vx-gap-xs)]">
      <span className="text-footnote font-body-medium text-fg-secondary">
        {translator.format('numbering.marks')}
      </span>
      <ul className="flex flex-col gap-[var(--vx-gap-xs)]">
        {NUMBERING_FIELDS.map((field) => (
          <li key={field} className="text-footnote text-fg-muted flex gap-[var(--vx-gap-sm)]">
            {/* The braces are the grammar's own punctuation, written in the one
                place that composes a mark for display. */}
            <Code className="text-fg-secondary shrink-0">{`{${field}}`}</Code>
            <span>{translator.format(`numbering.field.${field}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface SpecimenProps {
  /** False while the scope is still half-typed, which is not a failure to answer. */
  readonly isAsked: boolean;
  /**
   * The last read did not answer at all.
   *
   * Asked for rather than inferred from a missing specimen, and the difference
   * is a keystroke. Between the render that changes the question and the effect
   * that goes and asks it, there **is** no answer and nothing is in flight yet
   * — so a screen that read "no answer" as "it failed" put a failure under the
   * field on every letter somebody typed.
   */
  readonly isUnreachable: boolean;
  readonly shown: Result<NumberingSpecimen, NumberingRefusal> | null;
}

/**
 * What this series would print next.
 *
 * A refusal is shown here rather than only on save, because the field above it
 * is where it is corrected — and because the two are the same judgement: the
 * preview and the save ask `SYS` the same question about the same values.
 */
function Specimen({ isAsked, isUnreachable, shown }: SpecimenProps): ReactNode {
  const translator = useTranslator();

  if (!isAsked) {
    return (
      <p className="text-footnote text-fg-muted">
        {translator.format('numbering.specimen.waiting')}
      </p>
    );
  }
  if (shown === null) {
    return (
      <p className="text-footnote text-fg-muted">
        {translator.format(isUnreachable ? 'refusal.unknown' : 'data.loading')}
      </p>
    );
  }
  if (!shown.ok) {
    return <Banner tone="danger">{messageForRefusal(translator, shown.error)}</Banner>;
  }

  const { value } = shown;
  return (
    <div className="bg-surface-2 border-line flex flex-col gap-[var(--vx-gap-xs)] rounded border p-[var(--vx-pad-md)]">
      <span className="text-footnote text-fg-muted">{translator.format('numbering.specimen')}</span>
      {/* `output` is the element for a figure a page worked out, and `Code`
          inside it is what keeps the figure in the order it will print. */}
      <output className="text-heading font-body-semibold text-fg">
        <Code>{value.specimen}</Code>
      </output>
      <span className="text-footnote text-fg-muted">
        {translator.format('numbering.specimen.sequence', { sequence: value.sequence })}
      </span>
      {value.scope.register !== null && value.generation === 0 ? (
        // The till has no machine, so this series has a format and no way to
        // print under it. Said here because this is where somebody is looking.
        <span className="text-footnote text-fg-warning">
          {translator.format('numbering.specimen.noDevice')}
        </span>
      ) : null}
    </div>
  );
}
