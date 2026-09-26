// The place of a job without the work mode a portal appends to it ("München (Vor Ort)" is
// "München"): the work mode is a fact of its own.
const MODE = /\s*\((?:vor ort|hybrid|remote|on-?site)\)\s*$/i;

/** The place as the list and the reader show it. */
export function placeOf(location: string): string {
  return location.replace(MODE, '').trim();
}
