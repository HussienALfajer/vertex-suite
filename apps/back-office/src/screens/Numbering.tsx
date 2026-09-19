import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  actionsColumnWidth,
  Banner,
  Button,
  Code,
  DataTable,
  Dialog,
  EmptyState,
  FormatBuilder,
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
  type FormatBuilderMark,
  type SelectOption,
} from '@vertex/ui';
import type { Result } from '@vertex/kernel';
import type {
  Branch,
  NumberingRefusal,
  NumberingSpecimen,
  Register,
  SeriesScope,
} from '@vertex/sys/contract';

import { messageForRefusal } from '../catalogue.js';
import { useDeliveryMessage, useLoaded, useOrganisation } from '../organisation.js';
import { useNavigateTo } from '../routing.js';
import { branchColumn, branchesIn, scopedMessage, ScopeFilters, useBranchScope } from './scope.js';
import { FormatIcon, ReadState, StaleBanner, matchesQuery } from './structure.js';

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
 * One branch's series, or every branch's at once (`scope.tsx`). The **till**
 * is an ordinary filter in this component's state rather than in the address:
 * it narrows a list already on screen rather than deciding what the screen is
 * about. Defining a series asks which branch in the dialog itself, so it is
 * never blocked on the listing being filtered to the right one first.
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
 * key exactly when they are the same series. The branch is included even
 * though a single-branch view never needs it to disambiguate, because "كل فروع
 * المتجر" lays rows from every branch in the same table, and a document type,
 * till and fiscal year that repeat in two branches must not collide into one
 * row key.
 *
 * **Each part is encoded, and the reason is the DOM rather than ambiguity.** A
 * row key reaches the page inside the `id` of the elements React Aria builds
 * for the row, so anything in it that a CSS selector cannot carry — a quote
 * above all — turns every later lookup of those elements into a thrown
 * exception. Encoding also makes the join unambiguous, which is the same thing
 * `SYS` does to its own key and for the same second reason.
 */
function keyOf(scope: SeriesScope): string {
  return [scope.branch, scope.documentType, scope.register ?? '', scope.fiscalYear]
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
  const { branches: everyBranch, isLoading, unreachable, ofRecord } = useOrganisation();
  const scope = useBranchScope('numbering');
  const { branches, openBranches, chosen, isAllBranches } = scope;

  const [query, setQuery] = useState('');
  const [tillFilter, setTillFilter] = useState<string>(EVERY_REGISTER);
  const [isDefining, setIsDefining] = useState(false);
  const [revising, setRevising] = useState<NumberingSpecimen | null>(null);

  // A till belongs to one branch, so a filter naming one means nothing in the
  // branch next door: it would match no series at all, and the control holding
  // it would show no value — an empty list with nothing on screen explaining
  // it. Cleared whenever the branches shown change — from the chooser, the
  // address bar, which no control sees, or the company filter.
  useEffect(() => {
    setTillFilter(EVERY_REGISTER);
  }, [scope.subject]);

  // Every series names its own branch in its scope, which is what lets the
  // aggregate's rows be told apart without a wrapper to carry it.
  const readSeries = useCallback(
    (subject: string): Promise<readonly NumberingSpecimen[]> =>
      Promise.all(branchesIn(subject).map((branch) => ofRecord.numbering.configured(branch))).then(
        (lists) => lists.flat(),
      ),
    [ofRecord],
  );
  const series = useLoaded(scope.subject, readSeries);

  // The tills of the branches shown, read here as well as on their own
  // screen. A scope holds a till's identifier and nothing else — `SYS` has no
  // business knowing what a screen calls it — so the names come from here.
  const readRegisters = useCallback(
    (subject: string): Promise<readonly Register[]> =>
      Promise.all(
        branchesIn(subject).map((branch) => ofRecord.registers.list(branch, { including: 'all' })),
      ).then((lists) => lists.flat()),
    [ofRecord],
  );
  const registers = useLoaded(scope.subject, readRegisters);
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
        // Three states and not two: a read that failed is neither still loading
        // — which it once said for ever — nor a statement that the till is not
        // this branch's. The banner above says what failed.
        if (registers.unreachable) return translator.format('data.unknown');
        return translator.format(areTillsKnown ? 'numbering.register.unknown' : 'data.loading');
      }
      // A withdrawn till keeps its series, because the documents it issued keep
      // their numbers (`SYS-09`). Saying so in the row is what stops somebody
      // wondering why a format they are looking at prints nothing.
      return till.active
        ? till.name
        : translator.format('numbering.register.withdrawn', { name: till.name });
    },
    [tills, areTillsKnown, registers.unreachable, translator],
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
   * The years the branches shown already number under.
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
    ...branchColumn<SeriesRow>(
      scope,
      translator.format('numbering.column.branch'),
      (row) => row.series.scope.branch,
      150,
    ),
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

  // Asked of the whole tenant rather than of the company filtered to, which may
  // have no branches without the shop having none.
  if (everyBranch.length === 0 && unreachable) {
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

  if (everyBranch.length === 0 && !isLoading) {
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

  const tillOptions: readonly SelectOption[] = [
    { id: EVERY_REGISTER, label: translator.format('numbering.filter.allRegisters') },
    { id: NO_REGISTER, label: translator.format('numbering.register.none') },
    ...tills.map((one) => {
      const name = one.active
        ? one.name
        : translator.format('numbering.register.withdrawn', { name: one.name });
      // Across branches, two tills may well share a name — every shop has a
      // "till by the door" — so the aggregate says whose each one is.
      return {
        id: one.id,
        label: isAllBranches
          ? translator.format('numbering.register.inBranch', {
              register: name,
              branch: scope.nameOf(one.branch),
            })
          : name,
      };
    }),
  ];

  return (
    <>
      <PageHeader
        title={translator.format('numbering.title')}
        description={translator.format('numbering.description')}
        actions={
          <Button
            tone="primary"
            isDisabled={openBranches.length === 0}
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
        <ScopeFilters scope={scope} screen="numbering" />
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

      <ReadState loaded={series} />
      <ReadState loaded={registers} />
      {series.unreachable ? null : (series.value ?? []).length === 0 && !series.isLoading ? (
        <EmptyState
          message={scopedMessage(translator, scope, 'numbering.empty')}
          description={translator.format('numbering.empty.explanation')}
          action={
            <Button
              tone="primary"
              isDisabled={openBranches.length === 0}
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

      <SeriesDialog
        branches={branches}
        openBranches={openBranches}
        preferred={chosen?.id ?? null}
        registers={tills}
        subject={null}
        years={years}
        isOpen={isDefining}
        onOpenChange={setIsDefining}
        onSaved={series.reload}
      />
      <SeriesDialog
        branches={branches}
        openBranches={openBranches}
        preferred={chosen?.id ?? null}
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
  );
}

interface SeriesDialogProps {
  /** Every branch the screen is filtered to — active or not, for naming a series being revised. */
  readonly branches: readonly Branch[];
  /** The branches a series may be **defined** in — active ones, `Branches.tsx`'s own rule. */
  readonly openBranches: readonly Branch[];
  /** The branch the listing is filtered to, which is the one somebody most likely means. Null for the aggregate. */
  readonly preferred: Branch['id'] | null;
  /** Every register of every branch in `branches`, filtered to whichever branch is picked. */
  readonly registers: readonly Register[];
  /** The series being revised, or null when one is being defined. */
  readonly subject: NumberingSpecimen | null;
  /** The years already numbered under, across `branches`: what a second series most likely wants. */
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
 *
 * **The branch is chosen here rather than assumed from the listing**, the same
 * shape `NewLocationDialog` (`Locations.tsx`) and `NewRegisterDialog`
 * (`Registers.tsx`) pick one in: a series belongs to one branch permanently, so
 * the dialog needs an answer regardless of whether the screen behind it is
 * filtered to that branch, to a different one, or to "كل فروع المتجر" — and
 * defaulting it from the filter when the filter names a branch this list
 * actually offers is what keeps the ordinary case a single click. Fixed rather
 * than offered when revising, for the same reason the other three parts of the
 * scope are: it is part of the series' identity, not a field somebody edits.
 */
function SeriesDialog({
  branches,
  openBranches,
  preferred,
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

  const only = openBranches.length === 1 ? (openBranches[0] ?? null) : null;
  // The record rather than its identifier, so that what is handed to the
  // command is a branch this shop actually has open — `NewLocationDialog`'s own
  // reason for resolving a branch the same way. Only meaningful while defining:
  // revising reads its branch straight off the subject's own scope instead.
  const [branch, setBranch] = useState<Branch | null>(null);
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
  const [missing, setMissing] = useState({
    branch: false,
    documentType: false,
    fiscalYear: false,
    format: false,
  });

  const {
    isWorking,
    refused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
  } = useAttempt(subject ?? isOpen, () => {
    // A shop with one open branch never answers this question; a listing
    // filtered to one branch has already answered it.
    setBranch(
      subject !== null ? null : (only ?? openBranches.find((one) => one.id === preferred) ?? null),
    );
    setDocumentType(subject?.scope.documentType ?? '');
    setTill(subject?.scope.register ?? NO_REGISTER);
    // The last year already numbered under, which is the one a second series
    // almost always belongs to. Empty in a shop that has configured nothing.
    setFiscalYear(subject?.scope.fiscalYear ?? years.at(-1) ?? '');
    setFormat(subject?.format ?? '');
    setSuggested(null);
    setMissing({ branch: false, documentType: false, fiscalYear: false, format: false });
    // Asked again on every opening. The next number moves whenever a document
    // is issued, and reopening the same series asks the same question — which
    // a read keyed on the question does not ask twice.
    preview.reload();
  });

  // Revising reads its branch off the subject's own scope, straight from
  // `branches` rather than `openBranches` — a series defined while its branch
  // was open keeps its scope after the branch is withdrawn, and this dialog
  // still has to say whose it is.
  const revisingBranch = useMemo(
    () =>
      subject === null ? null : (branches.find((one) => one.id === subject.scope.branch) ?? null),
    [subject, branches],
  );
  const branchId = subject === null ? (branch?.id ?? null) : subject.scope.branch;

  // The record rather than the key out of the listbox, so what is put in the
  // scope is a till the picked branch actually has — filtered by it rather
  // than trusted, because `registers` may hold every filtered branch's tills
  // at once (the aggregate's own list), and a till of the branch next door is
  // not this series' to take.
  const picked = useMemo(
    () => registers.find((one) => one.id === till && one.branch === branchId) ?? null,
    [registers, till, branchId],
  );

  /**
   * What is being asked about, or null while the question is incomplete.
   *
   * A series being revised is asked about by its own scope and not by the
   * fields, which is the same statement as "the scope is the identity" made
   * where it has an effect.
   */
  const scope = useMemo((): SeriesScope | null => {
    if (subject !== null) return subject.scope;
    if (branch === null || documentType.trim() === '' || fiscalYear.trim() === '') return null;
    return {
      documentType: documentType.trim(),
      branch: branch.id,
      register: picked?.id ?? null,
      fiscalYear: fiscalYear.trim(),
    };
  }, [subject, branch, documentType, fiscalYear, picked]);

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
      : // The branch as well: the same type, till and year in another branch is
        // another series, and leaving it out showed one branch's next number
        // for the other's from what was already held.
        JSON.stringify([
          scope.branch,
          scope.documentType,
          scope.register,
          scope.fiscalYear,
          proposed,
        ]);

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
      branch: subject === null && branch === null,
      documentType: subject === null && documentType.trim() === '',
      fiscalYear: subject === null && fiscalYear.trim() === '',
      format: proposed === '',
    };
    setMissing(blank);
    if (scope === null || blank.branch || blank.documentType || blank.fiscalYear || blank.format) {
      reportInvalid();
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
    ...registers
      .filter((one) => one.branch === branchId)
      .map((one) => ({
        id: one.id,
        label: one.active
          ? one.name
          : translator.format('numbering.register.withdrawn', { name: one.name }),
      })),
  ];

  const branchOptions: readonly SelectOption[] = openBranches.map((one) => ({
    id: one.id,
    label: one.name,
  }));

  // The marks this series' format must carry. A till's two marks come
  // together or not at all — `SYS-02` requires them the moment a till is
  // picked and refuses them without one — so they are never a person's to add
  // or leave out, only to place. In `SYS`'s own default order, so the cards a
  // new series starts from are already the arrangement it would suggest.
  //
  // Read off `picked` rather than off the revised series' scope: `useAttempt`
  // resets `till` and `format` together, a render after `subject` changes, and
  // taking the marks from `subject` would hand `FormatBuilder` the new series'
  // marks one render before its format — which it would normalise, and
  // report, as if somebody had edited it.
  const hasRegister = picked !== null;
  const marks: readonly FormatBuilderMark[] = [
    ...(hasRegister
      ? [
          { id: 'prefix', label: translator.format('numbering.mark.prefix') },
          {
            id: 'generation',
            label: translator.format('numbering.mark.generation'),
            paddable: true,
          },
        ]
      : []),
    { id: 'year', label: translator.format('numbering.mark.year') },
    {
      id: 'sequence',
      label: translator.format('numbering.mark.sequence'),
      paddable: true,
      defaultWidth: 6,
    },
  ];

  return (
    <Dialog
      title={translator.format(subject === null ? 'numbering.new.title' : 'numbering.revise.title')}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      // Wider than the `40rem` the other dialogs use: a till's series carries
      // four cards, and a format wrapped onto two lines reads as a format
      // interrupted. With room to spare for a tenant's longer labels.
      className="max-w-[52rem]"
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
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}

        {subject === null ? (
          <>
            <Select
              label={translator.format('numbering.branch')}
              placeholder={translator.format('numbering.branch.placeholder')}
              options={branchOptions}
              value={branch?.id ?? null}
              onChange={(key) => {
                setBranch(openBranches.find((one) => one.id === key) ?? null);
                setMissing((was) => ({ ...was, branch: false }));
                // A till belongs to one branch, and a format suggested for the
                // previous one may no longer even parse for this one — the same
                // reset the till field's own `onChange` already does when it
                // changes the shape of the series out from under a suggestion.
                setTill(NO_REGISTER);
                setFormat('');
                setSuggested(null);
              }}
              isRequired
              {...(missing.branch
                ? { errorMessage: translator.format('numbering.new.branch.required') }
                : {})}
            />
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
                label={translator.format('numbering.branch')}
                value={revisingBranch?.name ?? translator.format('data.unknown')}
              />
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

        <FormatBuilder
          label={translator.format('numbering.format')}
          description={translator.format('numbering.format.description')}
          marks={marks}
          value={format}
          onChange={(next) => {
            setFormat(next);
            setMissing((was) => ({ ...was, format: false }));
          }}
          {...(missing.format
            ? { errorMessage: translator.format('numbering.format.required') }
            : {})}
        />

        {/* Said about the **field** rather than about the specimen, because it
            is a fact about where the text came from: this is what the product
            prints when nobody has decided otherwise, and it stops being true
            the moment somebody edits it. Hidden rather than removed when it
            does, so the first edit does not also shrink the dialog under the
            person making it. */}
        <p
          className={
            isUntouchedDefault
              ? 'text-footnote text-fg-muted'
              : 'text-footnote text-fg-muted invisible'
          }
        >
          {translator.format('numbering.specimen.default')}
        </p>

        {/* A floor under the specimen's four shapes — a line of waiting, a
            refusal, a box of several lines. A dialog is centred by its own
            height, and without it the whole dialog jumps on every edit that
            crosses between a format that prints and one that does not. */}
        <div className="min-h-36">
          <Specimen isAsked={asked !== null} isUnreachable={preview.unreachable} shown={shown} />
        </div>

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
