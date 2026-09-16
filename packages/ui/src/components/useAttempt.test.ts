import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAttempt } from './useAttempt.js';

/**
 * `useAttempt` is the machine `NameDialog`, `PlaceDialog`, `NewBranchDialog`
 * and `NewLocationDialog` (`SYS-09`, `SYS-14`) each hand-rolled once — tested
 * here on its own because packages/ui is the one place that can see all four
 * call sites at once and notice them drift.
 */

function settle(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

describe('useAttempt', () => {
  it('resets when `active` turns truthy, not on every render', () => {
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useAttempt(active, onReset),
      {
        initialProps: { active: false },
      },
    );
    expect(onReset).not.toHaveBeenCalled();

    rerender({ active: false });
    expect(onReset).not.toHaveBeenCalled();

    rerender({ active: true });
    expect(onReset).toHaveBeenCalledTimes(1);

    rerender({ active: true });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('resets on every distinct truthy value, for a dialog retargeted without closing', () => {
    // `PlaceDialog` is reused across rows: the subject can move from branch A
    // straight to branch B without `isOpen` ever going false in between.
    const onReset = vi.fn();
    const { rerender } = renderHook(
      ({ subject }: { subject: string | null }) => useAttempt(subject, onReset),
      {
        initialProps: { subject: 'a' },
      },
    );
    expect(onReset).toHaveBeenCalledTimes(1);

    rerender({ subject: 'b' });
    expect(onReset).toHaveBeenCalledTimes(2);
  });

  it('sets isWorking while the action runs and clears it once it settles', async () => {
    const { result } = renderHook(() => useAttempt(true, vi.fn()));
    let release!: (message: string | null) => void;
    const promise = new Promise<string | null>((resolve) => {
      release = resolve;
    });

    let attempted: Promise<void> = Promise.resolve();
    act(() => {
      attempted = result.current.attempt(() => promise);
    });
    expect(result.current.isWorking).toBe(true);

    await act(async () => {
      release(null);
      await attempted;
    });
    expect(result.current.isWorking).toBe(false);
    expect(result.current.refused).toBeNull();
  });

  it('shows the refusal an action reports, and clears it on the next attempt', async () => {
    const { result } = renderHook(() => useAttempt(true, vi.fn()));

    await act(async () => {
      await result.current.attempt(() => Promise.resolve('الاسم مستخدم بالفعل'));
    });
    expect(result.current.refused).toBe('الاسم مستخدم بالفعل');

    await act(async () => {
      await result.current.attempt(() => Promise.resolve(null));
    });
    expect(result.current.refused).toBeNull();
  });

  it('ignores a second attempt while the first is still in flight', async () => {
    // Two separate calls, as two separate clicks would arrive — not two calls
    // in one synchronous burst, which even the hand-rolled original never
    // guarded against: `isWorking` only becomes visible once React re-renders
    // between them.
    const action = vi.fn(async () => {
      await settle();
      return null;
    });
    const { result } = renderHook(() => useAttempt(true, vi.fn()));

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.attempt(action);
    });
    expect(result.current.isWorking).toBe(true);

    await act(async () => {
      await result.current.attempt(action);
    });
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      await first;
    });
  });

  it('lets a dialog clear a stale refusal itself, ahead of its own validation error', () => {
    const { result } = renderHook(() => useAttempt(true, vi.fn()));

    act(() => {
      result.current.setRefused('الشركة غير نشطة');
    });
    expect(result.current.refused).toBe('الشركة غير نشطة');

    act(() => {
      result.current.setRefused(null);
    });
    expect(result.current.refused).toBeNull();
  });
});
