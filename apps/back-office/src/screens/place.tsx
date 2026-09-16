import { useEffect, useState, type ReactNode } from 'react';

import { Banner, Button, Dialog, Panel, TextArea, useToast, useTranslator } from '@vertex/ui';
import {
  GeoMap,
  PointPicker,
  STREET_MAP,
  nominatimSearch,
  type MapPlace,
  type PickedPoint,
} from '@vertex/ui/map';
import type { Result } from '@vertex/kernel';
import type { GeoPoint, OrganisationRefusal } from '@vertex/sys/contract';

import { useDeliveryMessage, useOrganisation } from '../organisation.js';
import type { OrganisationOfRecord } from '../system.js';

/**
 * The address and the place on the map of `SYS-14`, for the two screens that
 * hold something with one.
 *
 * Both are written here rather than in each screen because a branch and a stock
 * location answer the same two questions in the same two controls, and the only
 * thing that differs between them is which command the answers are sent to.
 * Two copies would be two chances for the picker on one screen to behave
 * differently from the picker on the other — which is the kind of difference
 * nobody reports and everybody notices.
 */

/**
 * The back office is the screen with a line, so it is the screen that grants
 * the search.
 *
 * Built once at module scope rather than per render: a new function on every
 * keystroke would restart the picker's own debounce and turn one search into
 * one request per letter — which is both a worse answer and the thing the
 * service asks callers not to do.
 *
 * The register grants nothing of the sort and never will. That is the whole
 * shape of `SYS-14`: everything works with the line down, and the one part that
 * cannot is handed to the one application that has one.
 */
const findPlace = nominatimSearch({ locale: 'ar' });

/** Anything that carries `SYS-14`'s two fields, which is a branch or a location. */
export interface Placeable {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly point: GeoPoint | null;
  readonly active: boolean;
}

/**
 * The two commands, which is all a screen has to supply.
 *
 * The subject is passed as a plain identifier and each screen narrows it to its
 * own branded one. The alternative — making this generic over the id — would
 * put a type parameter on a dialog to express something the caller already
 * knows, and the screen that supplies the command is the screen that has the
 * record it came from.
 */
export interface PlaceCommands {
  readonly readdress: (
    of: OrganisationOfRecord,
    id: string,
    address: string,
  ) => Promise<Result<unknown, OrganisationRefusal>>;
  readonly locate: (
    of: OrganisationOfRecord,
    id: string,
    point: GeoPoint | null,
  ) => Promise<Result<unknown, OrganisationRefusal>>;
}

export interface PlaceDialogProps {
  readonly subject: Placeable | null;
  readonly commands: PlaceCommands;
  /** The other places already marked, so a new one can be put beside them. */
  readonly around: readonly PickedPoint[];
  /**
   * False for a van (`SYS-14`): its place does not hold still, the command
   * refuses one, and a picker that offered it would be offering something the
   * shop is about to be told it cannot have.
   */
  readonly canHoldPoint?: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSaved: () => void;
}

/**
 * Where something is, revised.
 *
 * Two commands behind one dialog, and both are sent because an administrator
 * who opened this to move a pin and also fixed a typo in the address would
 * otherwise lose one of the two. Sent in order and stopped at the first
 * refusal: the second has nothing to do with the first, and applying it anyway
 * would leave the screen reporting a failure over a change that was made.
 */
export function PlaceDialog({
  subject,
  commands,
  around,
  canHoldPoint = true,
  onOpenChange,
  onSaved,
}: PlaceDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { run } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<PickedPoint | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  // Named on the subject alone: a reload follows every command, and listing
  // anything that a reload replaces would throw away a half-moved pin the
  // moment something else in the application refreshed the structure.
  useEffect(() => {
    if (subject === null) return;
    setAddress(subject.address);
    setPoint(subject.point);
    setRefused(null);
    setIsWorking(false);
  }, [subject]);

  async function save(): Promise<void> {
    if (subject === null || isWorking) return;
    setIsWorking(true);
    setRefused(null);

    const of = subject;
    const wanted = point;
    const addressed = await run((port) => commands.readdress(port, of.id, address));
    let message = messageFor(addressed);
    if (message === null) {
      const located = await run((port) => commands.locate(port, of.id, wanted));
      message = messageFor(located);
    }
    setIsWorking(false);

    if (message === null) {
      onSaved();
      toast.show(translator.format('place.saved', { name: of.name }), { tone: 'success' });
      onOpenChange(false);
    } else {
      setRefused(message);
    }
  }

  return (
    <Dialog
      title={translator.format('place.title', { name: subject?.name ?? '' })}
      isOpen={subject !== null}
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
              void save();
            }}
          >
            {translator.format('action.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[var(--vx-gap-md)]">
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <PlaceFields
          address={address}
          onAddress={setAddress}
          point={point}
          onPoint={setPoint}
          around={around}
          canHoldPoint={canHoldPoint}
        />
      </div>
    </Dialog>
  );
}

export interface PlaceFieldsProps {
  readonly address: string;
  readonly onAddress: (address: string) => void;
  readonly point: PickedPoint | null;
  readonly onPoint: (point: PickedPoint | null) => void;
  readonly around: readonly PickedPoint[];
  readonly canHoldPoint?: boolean;
}

/**
 * The address, then the map.
 *
 * In that order because that is the order a person knows them in: the words
 * come off a sign or out of somebody's head, and the pin is the more deliberate
 * act. Neither is derived from the other — no address is geocoded into a point
 * and no point reverse-geocoded into an address, because both directions are a
 * query to an outside service about where a tenant's shops are, and both stop
 * working in a shop with no line.
 */
export function PlaceFields({
  address,
  onAddress,
  point,
  onPoint,
  around,
  canHoldPoint = true,
}: PlaceFieldsProps): ReactNode {
  const translator = useTranslator();

  return (
    <>
      <TextArea
        label={translator.format('place.address')}
        description={translator.format('place.address.description')}
        value={address}
        onChange={onAddress}
        rows={2}
      />
      {canHoldPoint ? (
        <PointPicker
          label={translator.format('place.map')}
          value={point}
          onChange={onPoint}
          around={around}
          basemap={STREET_MAP}
          search={findPlace}
        />
      ) : (
        // Said here rather than let the command say it: a picker offered and
        // then refused is a worse experience than one that was never offered,
        // and the reason is interesting enough to be worth a sentence.
        <Banner tone="info">{translator.format('place.moves')}</Banner>
      )}
    </>
  );
}

export interface PlacesMapProps {
  readonly label: string;
  readonly places: readonly MapPlace[];
  readonly emptyMessage: string;
  readonly renderDetails: (place: MapPlace) => ReactNode;
}

/**
 * The map under a listing.
 *
 * It appears once something is on it and not before. A map of an empty country
 * is a screen that looks broken on the day a shop installs this — every branch
 * is unplaced then — and the listing above already says what there is. What the
 * map adds is the question a table cannot answer at a glance: where they are in
 * relation to each other.
 */
export function PlacesMap({
  label,
  places,
  emptyMessage,
  renderDetails,
}: PlacesMapProps): ReactNode {
  const translator = useTranslator();
  if (places.length === 0) {
    return (
      <Panel title={label}>
        <p className="text-body text-fg-secondary">{emptyMessage}</p>
      </Panel>
    );
  }

  return (
    <Panel title={label} flush>
      <GeoMap
        label={translator.format('place.map.label')}
        places={places}
        renderDetails={renderDetails}
        basemap={STREET_MAP}
        className="h-[30rem] w-full"
      />
    </Panel>
  );
}
