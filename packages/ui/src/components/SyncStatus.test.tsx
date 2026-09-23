import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Translator } from '@vertex/i18n';
import { instant } from '@vertex/kernel';

import { UI_CATALOGUE } from '../catalogue.js';
import { VertexProvider } from '../providers/VertexProvider.js';
import {
  SyncStatus,
  type SyncOperation,
  type SyncState,
  type SyncStatusProps,
} from './SyncStatus.js';

afterEach(cleanup);

const translator = new Translator({ locale: 'ar', catalogue: UI_CATALOGUE });

const NINE = instant(Date.UTC(2026, 8, 23, 6, 0)); // 09:00 in Damascus
const minutes = (count: number) => instant(NINE + count * 60_000);

function operation(sequence: number, extra: Partial<SyncOperation> = {}): SyncOperation {
  return {
    key: `01a0d0a8-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    sequence,
    kind: 'pos.sale',
    stagedAt: minutes(sequence),
    ...extra,
  };
}

const ONLINE: SyncState = { connection: 'online', queue: [], lastContact: NINE, nextAttempt: null };

function show(status: SyncState, props: Partial<SyncStatusProps> = {}) {
  const onRetry = vi.fn();
  const onEscalate = vi.fn();
  const view = render(
    <VertexProvider translator={translator} locale="ar" root={null}>
      <SyncStatus
        status={status}
        timeZone="Asia/Damascus"
        describe={(one) => `بيع ${String(one.sequence)}`}
        onRetry={onRetry}
        onEscalate={onEscalate}
        {...props}
      />
    </VertexProvider>,
  );
  return { onRetry, onEscalate, view };
}

const indicator = () => screen.getByRole('button', { name: /متصل|غير متصل|الجلسة|بانتظار/ });

async function openDetail() {
  const user = userEvent.setup();
  await user.tab();
  expect(document.activeElement).toBe(indicator());
  await user.keyboard('{Enter}');
  return { user, dialog: await screen.findByRole('dialog', { name: 'المزامنة مع عقدة المتجر' }) };
}

describe('SyncStatus — POS-18 a persistent indication of connection and pending count', () => {
  it('POS-18 says connected, and counts nothing when nothing is waiting', () => {
    show(ONLINE);
    expect(indicator().textContent).toContain('متصل');
    expect(indicator().textContent).not.toContain('بانتظار');
  });

  it('POS-18 says offline, and how many operations are waiting to sync', () => {
    show({
      connection: 'offline',
      queue: [operation(1), operation(2), operation(3)],
      lastContact: NINE,
      nextAttempt: minutes(10),
    });
    expect(indicator().textContent).toContain('غير متصل');
    expect(indicator().textContent).toContain('3 بانتظار المزامنة');
  });

  it('POS-18 tells a forgotten session and a first answer still awaited apart from a line that is down', () => {
    show({ ...ONLINE, connection: 'signed-out' });
    expect(indicator().textContent).toContain('الجلسة منتهية');
    cleanup();
    show({ ...ONLINE, connection: 'unknown', lastContact: null });
    expect(screen.getByRole('button', { name: /بانتظار عقدة المتجر/ })).toBeTruthy();
  });

  it('POS-18 never says it in colour alone: each condition has an icon of its own shape', () => {
    const shapes = new Set<string>();
    for (const status of [
      ONLINE,
      { ...ONLINE, connection: 'offline' as const },
      { ...ONLINE, connection: 'signed-out' as const },
      { ...ONLINE, connection: 'unknown' as const },
      {
        ...ONLINE,
        queue: [operation(1, { failure: { reason: 'conflict', since: NINE, attempts: 1 } })],
      },
    ]) {
      const { view } = show(status);
      shapes.add(view.container.querySelector('button svg')?.innerHTML ?? '');
      cleanup();
    }
    expect(shapes.size).toBe(5);
  });

  it('POS-18 announces a change of condition without taking focus from the sale', () => {
    const { view } = show(ONLINE);
    view.rerender(
      <VertexProvider translator={translator} locale="ar" root={null}>
        <SyncStatus
          status={{ ...ONLINE, connection: 'offline', queue: [operation(1)] }}
          timeZone="Asia/Damascus"
          describe={() => 'بيع'}
          onRetry={() => undefined}
          onEscalate={() => undefined}
        />
      </VertexProvider>,
    );
    const announced = screen.getByRole('status').textContent;
    expect(announced).toContain('غير متصل');
    // The count moves with every sale; announcing it would talk over the sale.
    expect(announced).not.toContain('بانتظار');
  });

  it('POS-18 opens its detail view from the keyboard, and gives focus back on Esc', async () => {
    show({
      connection: 'offline',
      queue: [operation(1), operation(2)],
      lastContact: NINE,
      nextAttempt: minutes(3),
    });
    const { user, dialog } = await openDetail();
    expect(within(dialog).getByText(/لا اتصال بعقدة المتجر/)).toBeTruthy();
    expect(within(dialog).getByText('آخر ردّ من عقدة المتجر')).toBeTruthy();
    expect(within(dialog).getByText('المحاولة التلقائية التالية')).toBeTruthy();
    const rows = within(within(dialog).getByRole('list')).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByText(/^بيع/).textContent)).toEqual([
      'بيع 1',
      'بيع 2',
    ]);
    expect(rows[0]?.textContent).toContain('رقم 1');
    expect(rows[0]?.textContent).toContain('بانتظار');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(indicator());
  });
});

describe('SyncStatus — SYN-06 pending and failed operations, retry and escalation', () => {
  const failed = operation(1, { failure: { reason: 'forbidden', since: NINE, attempts: 3 } });

  it('SYN-06 marks a failed operation on the indicator itself, beside the count', () => {
    show({ ...ONLINE, queue: [failed, operation(2)] });
    expect(indicator().textContent).toContain('متصل');
    expect(indicator().textContent).toContain('2 بانتظار المزامنة');
    expect(indicator().textContent).toContain('عملية لم تُطبَّق');
  });

  it('SYN-06 says why it failed, what it holds up, and the reference to quote', async () => {
    show({ ...ONLINE, queue: [failed, operation(2), operation(3)] });
    const { dialog } = await openDetail();
    const notice = within(dialog).getByRole('alert');
    expect(notice.textContent).toContain('لم تُطبَّق: بيع 1');
    expect(notice.textContent).toContain('عقدة المتجر ترفض هذا الصندوق');
    expect(notice.textContent).toContain('رفضتها عقدة المتجر 3 مرات منذ');
    expect(notice.textContent).toContain('وعمليتان بعدها تنتظرانها.');
    expect(within(notice).getByText(failed.key)).toBeTruthy();
    const [head, behind] = within(within(dialog).getByRole('list')).getAllByRole('listitem');
    expect(head?.textContent).toContain('لم تُطبَّق');
    expect(behind?.textContent).toContain('بانتظار');
  });

  it('SYN-06 names the sequence the store node expected when there is a gap', async () => {
    show({
      ...ONLINE,
      queue: [
        operation(4, {
          failure: { reason: 'sequence-gap', expected: 2, since: NINE, attempts: 1 },
        }),
      ],
    });
    const { dialog } = await openDetail();
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'تنتظر من هذا الصندوق العملية رقم 2',
    );
  });

  it('SYN-06 escalates a failed operation from the keyboard, and then says it was', async () => {
    const { onEscalate, view } = show({ ...ONLINE, queue: [failed] });
    const { user, dialog } = await openDetail();
    const escalate = within(dialog).getByRole('button', { name: 'صعّدها إلى المشرف' });
    escalate.focus();
    await user.keyboard('{Enter}');
    expect(onEscalate).toHaveBeenCalledWith(failed.key);

    view.rerender(
      <VertexProvider translator={translator} locale="ar" root={null}>
        <SyncStatus
          status={{ ...ONLINE, queue: [{ ...failed, escalation: { at: minutes(5) } }] }}
          timeZone="Asia/Damascus"
          describe={() => 'بيع 1'}
          onRetry={() => undefined}
          onEscalate={onEscalate}
        />
      </VertexProvider>,
    );
    const notice = within(screen.getByRole('dialog')).getByRole('alert');
    expect(notice.textContent).toContain('صُعِّدت إلى المشرف في');
    // The button that was pressed is gone; focus is on what now says why.
    expect(notice.contains(document.activeElement)).toBe(true);
    expect(within(notice).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('list')).getByText('صُعِّدت')).toBeTruthy();
  });

  it('SYN-06 retries now on request, and can always be asked to check now', async () => {
    const { onRetry } = show({ ...ONLINE, connection: 'offline', queue: [operation(1)] });
    const { user, dialog } = await openDetail();
    const retry = within(dialog).getByRole('button', { name: 'أعد المحاولة الآن' });
    retry.focus();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
    cleanup();

    // With nothing waiting it only asks whether the store node is there, and is
    // never disabled: a control that disables under its own focus drops it.
    const idle = show(ONLINE);
    const again = await openDetail();
    expect(within(again.dialog).getByText(/لا شيء بانتظار المزامنة/)).toBeTruthy();
    within(again.dialog).getByRole('button', { name: 'أعد المحاولة الآن' }).focus();
    await again.user.keyboard('{Enter}');
    expect(idle.onRetry).toHaveBeenCalledTimes(1);
  });

  it('SYN-06 lists the head of a long queue and counts the rest, rather than render a day of sales', async () => {
    const queue = Array.from({ length: 1_203 }, (_, index) => operation(index + 1));
    show({ ...ONLINE, connection: 'offline', queue });
    const { dialog } = await openDetail();
    expect(within(within(dialog).getByRole('list')).getAllByRole('listitem')).toHaveLength(50);
    expect(within(dialog).getByText('و1,153 غيرها بعدها.')).toBeTruthy();
    expect(indicator().textContent).toContain('1,203 بانتظار المزامنة');
  });

  it('SYN-06 says so when the store node has never answered', async () => {
    show({ connection: 'unknown', queue: [], lastContact: null, nextAttempt: null });
    const { dialog } = await openDetail();
    expect(within(dialog).getByText('لم تردّ بعد')).toBeTruthy();
    expect(within(dialog).queryByText('المحاولة التلقائية التالية')).toBeNull();
  });
});
