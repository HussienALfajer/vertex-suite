/**
 * A `selectionchange` that changed nothing is not dispatched.
 *
 * The Selection API says the event is *queued* when the selection's range has
 * *changed* — a browser fires it after the handler that moved the selection has
 * returned, and only if the selection now stands somewhere else. happy-dom
 * (20.14) dispatches it synchronously from inside `Selection.collapse`, and
 * for a fresh `Range` object every time, so collapsing a selection onto the
 * very place it already stands is announced as a change while the caller is
 * still on the stack.
 *
 * React Aria's date segments do exactly that: on `selectionchange` they
 * collapse the selection to the focused segment, so that Android Chrome fires
 * input events rather than composition events. In a browser that is one
 * collapse; here it was a collapse that raised the event that ran the handler
 * that collapsed again, until `RangeError: Maximum call stack size exceeded` —
 * caught by happy-dom's listener dispatch, printed to stderr, and left in the
 * output of every test that touched a `DateInput`, a hundred and fifty times
 * a run. Nothing failed, which is what made it worth stopping: a page of stack
 * traces nobody reads is a page the next real error hides in.
 *
 * So this stands between happy-dom and its listeners, and drops the event when
 * the selection's four coordinates are the ones last announced. It runs before
 * each test file in every package whose tests need a document (`setupFiles`),
 * and it is the only thing that touches the environment there.
 */

const { document } = globalThis;

if (document === undefined) {
  throw new Error('happy-dom-selection runs under a document; this environment has none.');
}

const announce = document.dispatchEvent.bind(document);

/** Where the selection stood the last time a change was announced. */
let announced = null;

/**
 * The four coordinates of a selection, or null for none: what "the selection
 * changed" means, as distinct from "a new Range object was made for it".
 */
function whereItStands() {
  const selection = document.getSelection();
  if (selection === null || selection.anchorNode === null) return null;
  return {
    anchorNode: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode,
    focusOffset: selection.focusOffset,
  };
}

function sameStanding(one, other) {
  if (one === null || other === null) return one === other;
  return (
    one.anchorNode === other.anchorNode &&
    one.anchorOffset === other.anchorOffset &&
    one.focusNode === other.focusNode &&
    one.focusOffset === other.focusOffset
  );
}

document.dispatchEvent = (event) => {
  if (event.type === 'selectionchange') {
    const now = whereItStands();
    if (sameStanding(now, announced)) return true;
    announced = now;
  }
  return announce(event);
};
