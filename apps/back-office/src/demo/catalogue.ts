import type { CurrencyCode } from '@vertex/kernel';
import type { RateQuote } from '@vertex/fx';
import type { LocationKind } from '@vertex/sys';

/*
 * The demo shop, as the words and figures it is made of.
 *
 * A catalogue, and named as one, because everything in it is read by a person
 * on a screen — company names, branch names, addresses — in the language the
 * product speaks, and a translated edition would want its own. It is never in
 * a production bundle: only `dev-system.ts` imports it, and `main.tsx` keeps
 * that out of every build.
 */

/**
 * The shop `demo` opens with: a tenant already set up, so that a person
 * exploring the screens by hand does not re-type it after every reload — the
 * memory store behind this stand-in holds nothing between page loads.
 *
 * Shaped to put every state the screens can be in on screen at once, which is
 * the only reason it is this size. Five companies, because a company filter
 * over one company has nothing to narrow. Two branches each, because "all
 * branches" over one branch is that branch. The same two locations in every
 * branch — a shop floor at the branch's own door and a store room across town
 * — because those are the two cases `SYS-14` treats differently: a location
 * that shares its branch's point, and one with a point of its own.
 *
 * Only the first branch of each company opens a till and pairs a machine to
 * it, and only that branch starts with today's rates. The second branch is
 * what a shop looks like before either: `Registers.tsx`'s idle banner and
 * `FX-04`'s missing-rate badge are states a demo that furnished everything
 * would never show.
 */
export interface SeedLocation {
  readonly name: string;
  readonly kind: LocationKind;
  readonly address?: string;
}

export interface SeedRegister {
  readonly name: string;
  readonly prefix: string;
}

export interface SeedBranch {
  readonly name: string;
  readonly address: string;
  /** Only the branch that opens with one — `SYS-02`'s mark is scarce on purpose. */
  readonly register?: SeedRegister;
  /**
   * Whether the branch's board already holds today's rates, from `DEMO_RATES`.
   * Not every branch, for the reason the till above is not: a board where
   * every currency already has a rate never shows `FX-04`'s missing one — the
   * badge that says a currency cannot be traded at this branch today.
   */
  readonly hasRates?: true;
}

export interface SeedCompany {
  readonly name: string;
  readonly branches: readonly SeedBranch[];
}

/** The two locations every demo branch opens with. */
export const DEMO_LOCATIONS: readonly SeedLocation[] = [
  { name: 'صالة العرض الرئيسية', kind: 'shop-floor' },
  { name: 'مستودع التخزين', kind: 'store-room', address: 'المنطقة الصناعية' },
];

export const DEMO_ORGANISATION: readonly SeedCompany[] = [
  {
    name: 'شركة النور للتجارة العامة',
    branches: [
      {
        name: 'فرع دمشق المركزي',
        address: 'شارع بغداد، دمشق',
        register: { name: 'صندوق المدخل', prefix: 'DM1' },
        hasRates: true,
      },
      { name: 'فرع حمص', address: 'الشارع الرئيسي، حمص' },
    ],
  },
  {
    name: 'مؤسسة الياسمين للمواد الغذائية',
    branches: [
      {
        name: 'فرع اللاذقية',
        address: 'طريق الشاطئ، اللاذقية',
        register: { name: 'صندوق المدخل', prefix: 'LT1' },
        hasRates: true,
      },
      { name: 'فرع طرطوس', address: 'كورنيش طرطوس' },
    ],
  },
  {
    name: 'شركة الأمانة للأدوات المنزلية',
    branches: [
      {
        name: 'فرع حماة',
        address: 'شارع العاصي، حماة',
        register: { name: 'صندوق المدخل', prefix: 'HM1' },
        hasRates: true,
      },
      { name: 'فرع إدلب', address: 'الشارع العام، إدلب' },
    ],
  },
  {
    name: 'مجموعة الرافدين التجارية',
    branches: [
      {
        name: 'فرع الحسكة',
        address: 'شارع الكورنيش، الحسكة',
        register: { name: 'صندوق المدخل', prefix: 'HS1' },
        hasRates: true,
      },
      { name: 'فرع القامشلي', address: 'الشارع العام، القامشلي' },
    ],
  },
  {
    name: 'شركة حوران للتوزيع والنقل',
    branches: [
      {
        name: 'فرع درعا',
        address: 'شارع دمشق، درعا',
        register: { name: 'صندوق المدخل', prefix: 'DR1' },
        hasRates: true,
      },
      { name: 'فرع السويداء', address: 'شارع الثورة، السويداء' },
    ],
  },
];

/**
 * Today's rates at every branch marked `hasRates`, one figure pair per currency
 * the functional one (the dollar, `SEEDED_FUNCTIONAL`) has a rate against.
 *
 * Each is typed in the form its own market quotes, which is also what checks
 * the two orientations against each other here: the pound and the lira in
 * pounds and liras per dollar, the euro in dollars per euro. `buy` is what the
 * shop applies receiving the currency, and receiving must never be at fewer
 * units per functional than paying out is (`fx.rate-spread-inverted`) — so the
 * pound's `buy` is the higher figure, and the euro's, typed the other way up,
 * the lower.
 */
export const DEMO_RATES: readonly { readonly currency: CurrencyCode; readonly quote: RateQuote }[] =
  [
    { currency: 'SYP', quote: { form: 'units-per-functional', buy: '13100', sell: '12900' } },
    { currency: 'TRY', quote: { form: 'units-per-functional', buy: '41.90', sell: '41.60' } },
    { currency: 'EUR', quote: { form: 'functional-per-unit', buy: '1.07', sell: '1.09' } },
  ];
