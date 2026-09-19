/**
 * Moves keyboard focus to the first field a container has already marked
 * invalid, so a required `Select` left on its placeholder or a blank
 * `TextInput` gets exactly the treatment a browser's own validation gives a
 * `required` field — for the reason native validation earns that treatment:
 * focusing an element scrolls it into view in every engine, for free, which
 * a red caption alone does not when the field it names has scrolled out of
 * a dialog's own body and the person is looking at the button they just
 * pressed instead.
 *
 * `[data-invalid]` rather than `[aria-invalid]`, because the two do not
 * cover the same fields here: `TextInput` and `TextArea` set both on the
 * input itself, but `Select`'s trigger is a plain button React Aria never
 * marks `aria-invalid` — only the field's own wrapper carries `data-invalid`
 * for it. Querying that wrapper is what the field's own styling already keys
 * its danger-coloured border from (`group-data-[invalid]:border-line-danger`
 * in `Select.tsx`), so this asks the DOM the same question the styling does
 * rather than a second one only some fields would answer.
 *
 * Deferred a frame: the invalid state this looks for is the one a `setState`
 * call just asked for, and it is not yet in the document at the point a
 * caller would otherwise call this — `requestAnimationFrame` runs once the
 * browser has painted the commit that has it.
 *
 * Takes any container rather than only a `<form>`: `useAttempt`'s own
 * `reportInvalid` calls this over a dialog's form, and a dialog with no
 * `<form>` of its own — `SecurityDialog`'s single field beside its button —
 * has just as much reason to ask the same question of its own wrapping `div`.
 */
export function focusFirstInvalid(container: HTMLElement | null): void {
  if (container === null) return;
  requestAnimationFrame(() => {
    const marked = container.querySelector<HTMLElement>('[data-invalid]');
    if (marked === null) return;
    const target = marked.matches('input, button, textarea, select')
      ? marked
      : marked.querySelector<HTMLElement>('input, button, textarea, select');
    target?.focus();
  });
}
