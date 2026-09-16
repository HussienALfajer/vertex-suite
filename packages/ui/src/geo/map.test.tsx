import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Translator } from '@vertex/i18n';

import { VertexProvider } from '../providers/VertexProvider.js';
import { GeoMap, type MapPlace } from './GeoMap.js';
import { PointPicker, type PickedPoint } from './PointPicker.js';

afterEach(cleanup);

const translator = new Translator({
  locale: 'ar',
  catalogue: {
    'action.close': 'إغلاق',
    'map.zoomIn': 'تقريب',
    'map.zoomOut': 'تبعيد',
    'map.reset': 'إعادة الإطار',
    'map.marker.count': '{count, number}',
    'map.marker.many': '{count, number} أماكن هنا',
    'map.search': 'ابحث في أماكنك',
    'map.search.results': 'نتائج البحث في أماكنك',
    'picker.search': 'ابحث عن مكان بالاسم',
    'picker.search.placeholder': 'مثل: حلب',
    'picker.search.searching': 'جارٍ البحث…',
    'picker.search.empty': 'لا نتائج بهذا الاسم.',
    'picker.search.failed': 'تعذّر البحث بالاسم الآن.',
    'picker.placeHere': 'ضع هنا',
    'picker.useMyLocation': 'موقعي',
    'picker.locating': 'جارٍ التحديد…',
    'picker.clear': 'أزل النقطة',
    'picker.paste': 'ألصق رابطًا أو إحداثيًا',
    'picker.paste.description': 'رابط خرائط، أو زوج إحداثيات.',
    'picker.paste.shortened': 'رابط مختصر: افتحه وانسخ الرابط الكامل.',
    'picker.paste.unreadable': 'لم نتعرّف على موقع في هذا النص.',
    'picker.device.insecure': 'تحديد موقع الجهاز يحتاج اتصالًا مؤمَّنًا بعقدة المتجر.',
    'picker.device.unsupported': 'هذا المتصفّح لا يعرف موقع الجهاز.',
    'picker.device.refused': 'رُفض إذن الموقع لهذا الموقع.',
    'picker.device.unavailable': 'تعذّر تحديد موقع الجهاز الآن.',
  },
});

function wrap(children: ReactNode): void {
  render(
    <VertexProvider translator={translator} root={null}>
      {children}
    </VertexProvider>,
  );
}

const ALEPPO: MapPlace = {
  id: 'b-aleppo',
  label: 'فرع حلب',
  kind: 'branch',
  lat: '36.199700',
  lng: '37.163700',
  isActive: true,
};

const DAMASCUS: MapPlace = {
  id: 'b-damascus',
  label: 'فرع دمشق',
  kind: 'branch',
  lat: '33.513800',
  lng: '36.276500',
  isActive: true,
};

/** Half a kilometre from the Aleppo branch: close enough to gather with it. */
const NEXT_DOOR: MapPlace = {
  id: 'b-aleppo-2',
  label: 'فرع حلب الجديد',
  kind: 'branch',
  lat: '36.201000',
  lng: '37.165000',
  isActive: true,
};

const WAREHOUSE: MapPlace = {
  id: 'l-warehouse',
  label: 'مستودع خان شيخون',
  kind: 'store',
  lat: '35.442000',
  lng: '36.651000',
  isActive: false,
  address: 'طريق دمشق، بجانب المعمل',
};

const details = (place: MapPlace): ReactNode => <span>{place.label}</span>;

describe('The map of a tenant’s places — SYS-14', () => {
  it('puts every placed branch on the map as a named control', async () => {
    wrap(<GeoMap label="خريطة الفروع" places={[ALEPPO, DAMASCUS]} renderDetails={details} />);

    expect(await screen.findByRole('button', { name: 'فرع حلب' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'فرع دمشق' })).toBeTruthy();
  });

  it('opens what a marker is when it is pressed, and closes it again', async () => {
    const user = userEvent.setup();
    wrap(<GeoMap label="خريطة الفروع" places={[ALEPPO, DAMASCUS]} renderDetails={details} />);

    await user.click(screen.getByRole('button', { name: 'فرع دمشق' }));
    expect(await screen.findByRole('dialog', { name: 'فرع دمشق' })).toBeTruthy();

    // Escape, because a panel that can only be closed with a pointer is a panel
    // the register's own rule (§11) would not allow anywhere in this system.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'فرع دمشق' })).toBeNull();
  });

  it('gathers markers that would overlap into one that says how many', async () => {
    wrap(
      <GeoMap
        label="خريطة الفروع"
        places={[ALEPPO, NEXT_DOOR, DAMASCUS]}
        renderDetails={details}
      />,
    );

    // Two branches a few hundred metres apart cannot be told apart at a zoom
    // that also shows Damascus, so they are drawn as one that counts them.
    const gathered = await screen.findByRole('button', { name: '2 أماكن هنا' });
    expect(gathered.textContent).toBe('2');
  });

  it('names both members when a gathered marker is opened', async () => {
    const user = userEvent.setup();
    wrap(
      <GeoMap
        label="خريطة الفروع"
        places={[ALEPPO, NEXT_DOOR, DAMASCUS]}
        renderDetails={details}
      />,
    );

    await user.click(await screen.findByRole('button', { name: '2 أماكن هنا' }));
    const panel = await screen.findByRole('dialog');
    expect(panel.textContent).toContain('فرع حلب');
    expect(panel.textContent).toContain('فرع حلب الجديد');
  });

  it('does not mirror the Earth with the language', () => {
    // §9 makes RTL the default for the document. Syria is east of the
    // Mediterranean in every locale, and a surface that flipped with the text
    // would put it west — so the map is an `ltr` island and its controls are
    // not.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <GeoMap label="خريطة الفروع" places={[ALEPPO]} renderDetails={details} />
      </VertexProvider>,
    );

    const surface = container.querySelector('[role="application"]');
    expect(surface?.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('[dir="rtl"]')).toBeNull();
  });

  it('tells a withdrawn place from a working one without using colour to do it', () => {
    // §4.8: colour is never the only channel. A withdrawn place is hollow and
    // dashed, which survives both a colour-blind reader and a monochrome print.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <GeoMap label="خريطة الفروع" places={[WAREHOUSE]} renderDetails={details} />
      </VertexProvider>,
    );

    const marker = container.querySelector('[role="application"] button');
    expect(marker?.className).toContain('border-dashed');
    expect(marker?.className).not.toContain('bg-fill-accent');
  });

  it('keeps the markers in one order however the data arrives', () => {
    // They are focus stops. A list that reordered itself between renders would
    // move a keyboard's place in it under the person using it.
    const names = (places: readonly MapPlace[]): readonly string[] => {
      cleanup();
      const { container } = render(
        <VertexProvider translator={translator} root={null}>
          <GeoMap label="خريطة الفروع" places={places} renderDetails={details} />
        </VertexProvider>,
      );
      return [...container.querySelectorAll('[role="application"] button')].map(
        (one) => one.getAttribute('aria-label') ?? '',
      );
    };

    expect(names([ALEPPO, DAMASCUS, WAREHOUSE])).toEqual(names([WAREHOUSE, DAMASCUS, ALEPPO]));
  });

  it('offers the frame back once somebody has moved the map', async () => {
    const user = userEvent.setup();
    wrap(<GeoMap label="خريطة الفروع" places={[ALEPPO, DAMASCUS]} renderDetails={details} />);

    // Nothing to put back until something has been moved, so the control that
    // puts it back is not offered as a thing that does nothing.
    const reset = screen.getByRole('button', { name: 'إعادة الإطار' });
    expect(reset.hasAttribute('disabled') || reset.getAttribute('aria-disabled') === 'true').toBe(
      true,
    );

    await user.click(screen.getByRole('button', { name: 'تقريب' }));
    expect(
      screen.getByRole('button', { name: 'إعادة الإطار' }).getAttribute('aria-disabled'),
    ).not.toBe('true');
  });

  it('finds a place by its name, and by the street it is on', async () => {
    const user = userEvent.setup();
    wrap(
      <GeoMap
        label="خريطة الفروع"
        places={[ALEPPO, DAMASCUS, WAREHOUSE]}
        renderDetails={details}
      />,
    );

    // Over the tenant's own places rather than over the world: this is the
    // search a person on this screen is actually doing — they know the shop
    // exists and want to see where it is — and it answers with no line at all.
    const search = screen.getByRole('searchbox');
    const results = (): HTMLElement => screen.getByRole('list', { name: 'نتائج البحث في أماكنك' });

    await user.type(search, 'دمشق');
    await user.click(within(results()).getByRole('button', { name: /فرع دمشق/ }));
    expect(await screen.findByRole('dialog', { name: 'فرع دمشق' })).toBeTruthy();

    // The panel is dismissed before searching again, because while it is open
    // the rest of the page is hidden from assistive technology — which is what
    // makes a panel a panel, and is exactly what the next search has to get
    // past to be reachable.
    await user.keyboard('{Escape}');

    // And by address, because people look for a shop by the street it is on.
    await user.type(search, 'المعمل');
    expect(within(results()).getByRole('button', { name: /مستودع خان شيخون/ })).toBeTruthy();
  });

  it('folds the marks nobody types when searching', async () => {
    const user = userEvent.setup();
    const marked: MapPlace = { ...ALEPPO, label: 'فَرْعُ حَلَبَ' };
    wrap(<GeoMap label="خريطة الفروع" places={[marked, DAMASCUS]} renderDetails={details} />);

    // The name on screen carries harakat; nobody types them into a search box.
    // A comparison of bytes would fail to find a branch the person is looking
    // straight at.
    await user.type(screen.getByRole('searchbox'), 'فرع حلب');
    const results = screen.getByRole('list', { name: 'نتائج البحث في أماكنك' });
    expect(within(results).getByRole('button', { name: /فَرْعُ حَلَبَ/ })).toBeTruthy();
  });

  it('draws the land it shipped with underneath the tiles, not instead of them', () => {
    // The tiles carry the streets and need a line; the outline needs nothing.
    // Drawing one under the other is what makes `SYS-14`'s "with every network
    // interface disabled" true without an error state to get wrong: when no
    // tile arrives, the land is already painted.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <GeoMap
          label="خريطة الفروع"
          places={[ALEPPO]}
          renderDetails={details}
          basemap={{
            kind: 'tiles',
            url: 'https://tiles.example/{z}/{x}/{y}.png',
            maxZoom: 19,
            attribution: '© مثال',
          }}
        />
      </VertexProvider>,
    );

    expect(container.querySelectorAll('svg path').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('svg image').length).toBeGreaterThan(0);
    // Attribution is rendered, not remembered.
    expect(screen.getByText('© مثال')).toBeTruthy();
  });

  it('shows nothing but the empty surface when the tenant has placed nothing', () => {
    // The screens decide what to say about that; what matters here is that the
    // map does not answer it with a view of the middle of the Atlantic.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <GeoMap label="خريطة الفروع" places={[]} renderDetails={details} />
      </VertexProvider>,
    );
    expect(container.querySelectorAll('[role="application"] button')).toHaveLength(0);
  });
});

function Picking({ initial = null }: { readonly initial?: PickedPoint | null }): ReactNode {
  const [point, setPoint] = useState<PickedPoint | null>(initial);
  return (
    <>
      <PointPicker label="اختيار الموقع" value={point} onChange={setPoint} />
      <output data-testid="chosen">{point === null ? '' : `${point.lat},${point.lng}`}</output>
    </>
  );
}

describe('Putting a place on the map — SYS-14', () => {
  it('reads the maps link a shop owner already has', async () => {
    const user = userEvent.setup();
    wrap(<Picking />);

    await user.type(
      screen.getByLabelText('ألصق رابطًا أو إحداثيًا'),
      'https://www.google.com/maps/@36.1997,37.1637,17z',
    );

    expect(screen.getByTestId('chosen').textContent).toBe('36.1997,37.1637');
  });

  it('says what to do about a shortened link instead of following it', async () => {
    const user = userEvent.setup();
    wrap(<Picking />);

    // Following it would ask a third party where this tenant's shop is, and
    // would fail in a shop with no line. So it is refused with instructions.
    await user.type(screen.getByLabelText('ألصق رابطًا أو إحداثيًا'), 'https://maps.app.goo.gl/x1');

    expect(await screen.findByText('رابط مختصر: افتحه وانسخ الرابط الكامل.')).toBeTruthy();
    expect(screen.getByTestId('chosen').textContent).toBe('');
  });

  it('takes the middle of the map when somebody says to place it there', async () => {
    const user = userEvent.setup();
    wrap(<Picking />);

    await user.click(screen.getByRole('button', { name: 'ضع هنا' }));

    // The centre of the opening view is the middle of the country this edition
    // is sold in, which is in Syria — so the two figures are its latitude and
    // longitude to the same six places the store keeps.
    const chosen = screen.getByTestId('chosen').textContent;
    const [lat, lng] = chosen.split(',').map(Number);
    expect(lat).toBeGreaterThan(32);
    expect(lat).toBeLessThan(38);
    expect(lng).toBeGreaterThan(35);
    expect(lng).toBeLessThan(43);
    expect(chosen.split(',')[0]?.split('.')[1]).toHaveLength(6);
  });

  it('takes a point off, because a place wrongly marked is worse than unmarked', async () => {
    const user = userEvent.setup();
    wrap(<Picking initial={{ lat: '36.199700', lng: '37.163700' }} />);

    expect(screen.getByTestId('chosen').textContent).toBe('36.199700,37.163700');
    await user.click(screen.getByRole('button', { name: 'أزل النقطة' }));
    expect(screen.getByTestId('chosen').textContent).toBe('');
  });

  it('names the deployment problem when the browser will not say where the device is', async () => {
    const user = userEvent.setup();
    // `navigator.geolocation` is disabled outside a secure context, silently.
    // A back office served over plain HTTP on the shop network is exactly that,
    // and "nothing happened" is the least useful thing a screen can say.
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    wrap(<Picking />);

    await user.click(screen.getByRole('button', { name: 'موقعي' }));

    expect(
      await screen.findByText('تحديد موقع الجهاز يحتاج اتصالًا مؤمَّنًا بعقدة المتجر.'),
    ).toBeTruthy();
    Reflect.deleteProperty(window, 'isSecureContext');
  });

  it('places a point where the map was clicked, and not where a drag ended', () => {
    // A press that went nowhere is a click; a press that travelled is a drag,
    // and dropping a marker wherever a drag happened to end would place it
    // somewhere nobody chose.
    const { container } = render(
      <VertexProvider translator={translator} root={null}>
        <Picking />
      </VertexProvider>,
    );
    const surface = container.querySelector('[role="application"]');
    expect(surface).not.toBeNull();

    const press = (from: [number, number], to: [number, number]): void => {
      fireEvent.pointerDown(surface!, {
        button: 0,
        pointerId: 1,
        clientX: from[0],
        clientY: from[1],
      });
      fireEvent.pointerMove(surface!, { pointerId: 1, clientX: to[0], clientY: to[1] });
      fireEvent.pointerUp(surface!, { pointerId: 1, clientX: to[0], clientY: to[1] });
    };

    press([400, 260], [400, 260]);
    const clicked = screen.getByTestId('chosen').textContent;
    expect(clicked).not.toBe('');

    press([300, 200], [520, 340]);
    expect(screen.getByTestId('chosen').textContent).toBe(clicked);
  });
});
