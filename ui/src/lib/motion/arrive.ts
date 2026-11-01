// The row someone was taken to (Ergänzen, Weiter, Profil ergänzen, Postfach prüfen): a soft wash
// stands on it for a moment and fades, so the eye finds where it landed, also when the page did
// not have to move. `data-arrive` on a row marks it as one (base.css draws the wash under its
// words); the scope is that row or holds it. The wash only comes and goes in the quick steps of
// the app; under reduced motion it simply stands and goes.

import { arriveDelay } from './motion';

const ARRIVED = 'data-arrived';
const timers = new WeakMap<Element, number>();

/** The wash on `scope`, or on the row inside it. */
export function washOver(scope: Element): void {
  const row = scope.matches('[data-arrive]') ? scope : scope.querySelector('[data-arrive]');
  if (row === null) return;
  clearTimeout(timers.get(row));
  row.setAttribute(ARRIVED, '');
  timers.set(
    row,
    window.setTimeout(() => row.removeAttribute(ARRIVED), arriveDelay()),
  );
}
