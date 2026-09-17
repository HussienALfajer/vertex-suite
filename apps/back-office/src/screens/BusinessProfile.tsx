import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  Banner,
  Button,
  ConfirmationDialog,
  EmptyState,
  IconButton,
  PageHeader,
  Panel,
  Select,
  TextArea,
  TextInput,
  useToast,
  useTranslator,
  type SelectOption,
} from '@vertex/ui';
import type { BusinessProfile as Profile, Company, ProfileRevision } from '@vertex/sys/contract';

import { useDeliveryMessage, useLoaded, useOrganisation } from '../organisation.js';
import { hrefOf, redirect, useNavigateTo, useRoute } from '../routing.js';
import { ReadState, StaleBanner } from './structure.js';

/**
 * `SYS-05`: what every receipt and every printed document carries.
 *
 * **It belongs to a company, not to the tenant**, and this screen says so by
 * asking which one first. A group that trades as two legal entities issues
 * documents from both, and a receipt that printed the wrong legal name and tax
 * number is a document that does not stand up in front of an inspector. A shop
 * with one company never sees the question — the answer is not in doubt — but
 * the record is still the company's, which is why the address bar names it
 * either way.
 *
 * **It is a form and not a set of switches.** Every field here is revised
 * together and applies to documents printed after it, so nothing takes effect
 * as it is typed: the person filling it in is copying from a commercial
 * register, and half-copied values reaching a receipt in the meantime is the
 * failure to prevent. That is the whole reason the save is explicit, the
 * unsaved state is stated out loud, and there is a way back to what was stored.
 */

interface TaxRow {
  readonly key: string;
  readonly value: string;
}

interface Draft {
  readonly name: string;
  readonly logo: string;
  readonly address: string;
  readonly phone: string;
  readonly taxIdentifiers: readonly TaxRow[];
  readonly receiptHeader: string;
  readonly receiptFooter: string;
}

const BLANK: Draft = {
  name: '',
  logo: '',
  address: '',
  phone: '',
  taxIdentifiers: [],
  receiptHeader: '',
  receiptFooter: '',
};

function draftOf(profile: Profile): Draft {
  return {
    name: profile.name,
    // The stored absence is null and the typed absence is an empty field; they
    // mean the same thing and the save turns one back into the other.
    logo: profile.logo ?? '',
    address: profile.address,
    phone: profile.phone,
    taxIdentifiers: Object.entries(profile.taxIdentifiers).map(([key, value]) => ({ key, value })),
    receiptHeader: profile.receiptHeader,
    receiptFooter: profile.receiptFooter,
  };
}

/** Whether anything has been typed since the stored version was read. */
function isSame(one: Draft, two: Draft): boolean {
  return (
    one.name === two.name &&
    one.logo === two.logo &&
    one.address === two.address &&
    one.phone === two.phone &&
    one.receiptHeader === two.receiptHeader &&
    one.receiptFooter === two.receiptFooter &&
    one.taxIdentifiers.length === two.taxIdentifiers.length &&
    one.taxIdentifiers.every((row, index) => {
      const other = two.taxIdentifiers[index];
      // A row the other draft does not have cannot match, and comparing its
      // key against a present one is what says so.
      return row.key === other?.key && row.value === other.value;
    })
  );
}

export function BusinessProfile(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const goTo = useNavigateTo();
  const route = useRoute();
  const { companies, isLoading, run, ofRecord, reload: reloadStructure } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const chosen = useMemo(
    () => companies.find((one) => one.id === route.subject) ?? null,
    [companies, route.subject],
  );

  // Arriving with no company named lands on the first one in use, so that the
  // screen has something to show rather than an empty chooser.
  useEffect(() => {
    if (chosen !== null || companies.length === 0) return;
    const first = companies.find((one) => one.active) ?? companies[0];
    if (first !== undefined) redirect(hrefOf('business-profile', first.id));
  }, [chosen, companies]);

  const read = useCallback((company: Company['id']) => ofRecord.profile.read(company), [ofRecord]);
  const profile = useLoaded(chosen?.id ?? null, read);

  // Only what was actually read. Before an answer arrives, or when none can,
  // there is nothing to edit: the form once opened on `BLANK` while the read was
  // slow or had failed, took whatever was typed, and saved every field of it —
  // blanking the stored address, phone, tax numbers and receipt lines of a
  // company whose profile had simply not been reached.
  const isRead = profile.value !== null;
  const stored = useMemo(
    () => (profile.value === null ? BLANK : draftOf(profile.value)),
    [profile.value],
  );
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [isSaving, setIsSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<readonly string[]>([]);
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);

  // What was read is what the form starts from, every time a different company
  // is chosen or the record is re-read.
  useEffect(() => {
    setDraft(stored);
    setRefused(null);
    setInvalid([]);
  }, [stored]);

  const isDirty = !isSame(draft, stored);

  function discard(): void {
    setDraft(stored);
    setRefused(null);
    setInvalid([]);
  }

  function change<K extends keyof Draft>(field: K, value: Draft[K]): void {
    setDraft((was) => ({ ...was, [field]: value }));
    setInvalid([]);
  }

  /**
   * The rows that would be stored, and what is wrong with them.
   *
   * A blank row is dropped rather than refused: adding one and changing your
   * mind is the ordinary way a repeating field is used. A row with a value and
   * no name is refused, because storing it under an empty name would lose it.
   */
  function collect(): { identifiers: Record<string, string>; problems: readonly string[] } {
    const identifiers: Record<string, string> = {};
    const problems: string[] = [];
    for (const row of draft.taxIdentifiers) {
      const key = row.key.trim();
      if (key === '') {
        if (row.value.trim() !== '') problems.push(translator.format('profile.tax.key.required'));
        continue;
      }
      if (key in identifiers) {
        problems.push(translator.format('profile.tax.key.duplicate'));
        continue;
      }
      identifiers[key] = row.value.trim();
    }
    return { identifiers, problems };
  }

  async function save(): Promise<void> {
    if (isSaving || chosen === null || !isRead || !isDirty) return;

    const { identifiers, problems } = collect();
    if (problems.length > 0) {
      setInvalid([...new Set(problems)]);
      setRefused(null);
      return;
    }

    // What changed, and nothing else. `revise` is a patch because two people
    // may be revising one profile, and sending every field would put back a
    // phone number somebody else corrected a minute ago.
    const changes: {
      -readonly [K in keyof ProfileRevision]: ProfileRevision[K];
    } = {};
    if (draft.name !== stored.name) changes.name = draft.name.trim();
    // Absent would mean "leave it" and null means "there is none"; an empty
    // field is somebody saying there is none.
    if (draft.logo !== stored.logo)
      changes.logo = draft.logo.trim() === '' ? null : draft.logo.trim();
    if (draft.address !== stored.address) changes.address = draft.address.trim();
    if (draft.phone !== stored.phone) changes.phone = draft.phone.trim();
    if (!isSame({ ...stored, taxIdentifiers: draft.taxIdentifiers }, stored)) {
      changes.taxIdentifiers = identifiers;
    }
    if (draft.receiptHeader !== stored.receiptHeader) changes.receiptHeader = draft.receiptHeader;
    if (draft.receiptFooter !== stored.receiptFooter) changes.receiptFooter = draft.receiptFooter;

    setIsSaving(true);
    setRefused(null);
    const delivery = await run((of) => of.profile.revise(chosen.id, changes));
    setIsSaving(false);

    const message = messageFor(delivery);
    if (message === null) {
      profile.reload();
      // The frame shows this name, so a revision has to reach it too.
      reloadStructure();
      toast.show(translator.format('profile.saved'), { tone: 'success' });
    } else {
      setRefused(message);
    }
  }

  if (companies.length === 0 && !isLoading) {
    return (
      <>
        <PageHeader
          title={translator.format('profile.title')}
          description={translator.format('profile.description')}
        />
        <StaleBanner />
        <EmptyState
          message={translator.format('profile.empty')}
          description={translator.format('profile.empty.explanation')}
          action={
            <Button
              tone="primary"
              onPress={() => {
                goTo('companies');
              }}
            >
              {translator.format('profile.empty.action')}
            </Button>
          }
        />
      </>
    );
  }

  const companyOptions: readonly SelectOption[] = companies.map((one) => ({
    id: one.id,
    label: one.name,
  }));

  return (
    <>
      <PageHeader
        title={translator.format('profile.title')}
        description={translator.format('profile.description')}
        actions={
          <>
            <Button
              isDisabled={!isDirty || isSaving}
              onPress={() => {
                setIsConfirmingDiscard(true);
              }}
            >
              {translator.format('profile.discard')}
            </Button>
            <Button
              tone="primary"
              isDisabled={!isDirty || isSaving || chosen === null || !isRead}
              onPress={() => {
                void save();
              }}
            >
              {translator.format(isSaving ? 'profile.saving' : 'profile.save')}
            </Button>
          </>
        }
      />

      <ConfirmationDialog
        title={translator.format('profile.discard.title')}
        message={translator.format('profile.discard.message')}
        confirmLabel={translator.format('profile.discard')}
        tone="danger"
        isOpen={isConfirmingDiscard}
        onOpenChange={setIsConfirmingDiscard}
        onConfirm={discard}
      />

      <StaleBanner />

      {/* One company is not a question worth asking, and a chooser with one
          option is a control that teaches somebody to ignore controls. */}
      {companies.length > 1 ? (
        <Select
          label={translator.format('profile.company')}
          description={translator.format('profile.company.description')}
          placeholder={translator.format('profile.company.placeholder')}
          options={companyOptions}
          value={chosen?.id ?? null}
          onChange={(key) => {
            redirect(hrefOf('business-profile', String(key)));
          }}
          className="w-[22rem] max-w-full"
        />
      ) : null}

      {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
      {invalid.length === 0 ? null : (
        <Banner tone="danger">
          <ul className="flex flex-col gap-[var(--vx-gap-xs)]">
            {invalid.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Banner>
      )}
      {isDirty ? <Banner tone="info">{translator.format('profile.unsaved')}</Banner> : null}
      <ReadState loaded={profile} />

      {/*
        A **field** has a measure; a page does not. Every field here is copied
        from a document somebody is holding in the other hand, and a legal name
        typed across eleven hundred pixels is a line they lose their place in.

        That was first read as a cap on the form, which put three panels in one
        narrow column and left half the screen empty — a form that has stopped
        rather than a page that has finished. The measure belongs to the fields,
        so it is the **panels** that are two columns wide on a wide screen and
        the grid inside each that keeps the inputs readable. Identity and tax
        stand side by side; the receipt takes the full width, because what goes
        in it is printed across a receipt and is read as lines rather than as
        answers to questions.
      */}
      {isRead ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="grid w-full max-w-[96rem] gap-[var(--vx-gap-lg)] lg:grid-cols-2 lg:items-start"
        >
          {/* Save sits in the page header, outside the form, and a form with no
            submit control of its own ignores Enter. This is that control. */}
          <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
          <Panel title={translator.format('profile.section.identity')}>
            <div className="grid gap-[var(--vx-gap-md)] md:grid-cols-2">
              <TextInput
                label={translator.format('profile.name')}
                description={translator.format('profile.name.description')}
                value={draft.name}
                onChange={(next) => {
                  change('name', next);
                }}
                className="md:col-span-2"
              />
              <TextInput
                label={translator.format('profile.phone')}
                value={draft.phone}
                type="tel"
                onChange={(next) => {
                  change('phone', next);
                }}
              />
              <TextInput
                label={translator.format('profile.logo')}
                description={translator.format('profile.logo.description')}
                value={draft.logo}
                onChange={(next) => {
                  change('logo', next);
                }}
              />
              <TextArea
                label={translator.format('profile.address')}
                value={draft.address}
                onChange={(next) => {
                  change('address', next);
                }}
                rows={2}
                className="md:col-span-2"
              />
            </div>
          </Panel>

          <Panel title={translator.format('profile.section.tax')}>
            <TaxIdentifiers
              rows={draft.taxIdentifiers}
              onRows={(rows) => {
                change('taxIdentifiers', rows);
              }}
            />
          </Panel>

          <Panel title={translator.format('profile.section.receipt')} className="lg:col-span-2">
            <div className="flex flex-col gap-[var(--vx-gap-md)]">
              <p className="text-footnote text-fg-muted">
                {translator.format('profile.receipt.description')}
              </p>
              <TextArea
                label={translator.format('profile.receiptHeader')}
                value={draft.receiptHeader}
                onChange={(next) => {
                  change('receiptHeader', next);
                }}
              />
              <TextArea
                label={translator.format('profile.receiptFooter')}
                value={draft.receiptFooter}
                onChange={(next) => {
                  change('receiptFooter', next);
                }}
              />
            </div>
          </Panel>
        </form>
      ) : null}
    </>
  );
}

interface TaxIdentifiersProps {
  readonly rows: readonly TaxRow[];
  readonly onRows: (rows: readonly TaxRow[]) => void;
}

/**
 * The tax identifiers, as pairs somebody names themselves.
 *
 * Which identifiers exist is a question about a country rather than about this
 * system — a VAT number here, a commercial register number there, a national
 * tax number somewhere else — so the contract keys them by name and this asks
 * for the name. A fixed set of fields would be wrong in the second country the
 * product is sold in, and wrong in a way only a shopkeeper would notice.
 */
function TaxIdentifiers({ rows, onRows }: TaxIdentifiersProps): ReactNode {
  const translator = useTranslator();

  return (
    <div className="flex flex-col gap-[var(--vx-gap-md)]">
      <p className="text-footnote text-fg-muted">{translator.format('profile.tax.description')}</p>

      {rows.length === 0 ? (
        <p className="text-body text-fg-secondary">{translator.format('profile.tax.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-[var(--vx-gap-sm)]">
          {rows.map((row, index) => (
            <li
              // The position, because neither half of a pair is an identifier
              // until it is stored and both are being typed.
              key={index}
              className="flex items-end gap-[var(--vx-gap-sm)]"
            >
              <TextInput
                label={translator.format('profile.tax.key')}
                placeholder={translator.format('profile.tax.key.placeholder')}
                value={row.key}
                onChange={(next) => {
                  onRows(rows.map((one, at) => (at === index ? { ...one, key: next } : one)));
                }}
                className="flex-1"
              />
              <TextInput
                label={translator.format('profile.tax.value')}
                value={row.value}
                onChange={(next) => {
                  onRows(rows.map((one, at) => (at === index ? { ...one, value: next } : one)));
                }}
                className="flex-1"
              />
              <IconButton
                aria-label={translator.format('profile.tax.remove', { position: index + 1 })}
                onPress={() => {
                  onRows(rows.filter((_, at) => at !== index));
                }}
              >
                <svg
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                  className="fill-none stroke-current"
                  strokeWidth="1.5"
                >
                  <path d="M5 10h10" strokeLinecap="round" />
                </svg>
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button
          onPress={() => {
            onRows([...rows, { key: '', value: '' }]);
          }}
        >
          {translator.format('profile.tax.add')}
        </Button>
      </div>
    </div>
  );
}
