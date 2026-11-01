// The words of the list's search marked in a text, one idea of a hit for the title of a job's row
// and its ad: as the search finds them, in any case, with or without accents.

/** The words a search takes at most (like the backend). */
const SEARCH_WORDS = 8;

/** The words of a search. */
export function searchWords(search: string): string[] {
  return search.trim().split(/\s+/).filter(Boolean).slice(0, SEARCH_WORDS);
}

/** A character as the search compares it: lower case, without its accents. */
const fold = (char: string): string =>
  char
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

/** `text` in parts, those that hold a word of the search marked (every place a word stands). */
export function markedParts(
  text: string,
  words: readonly string[],
): { text: string; mark: boolean }[] {
  const chars = Array.from(text);
  if (words.length === 0 || chars.length === 0) return [{ text, mark: false }];
  // The folded text, and for each of its characters the character of `text` it came from.
  let folded = '';
  const from: number[] = [];
  chars.forEach((char, at) => {
    for (const part of Array.from(fold(char))) {
      folded += part;
      from.push(at);
    }
  });
  const marked = new Array<boolean>(chars.length).fill(false);
  for (const word of words.map((each) => Array.from(each).map(fold).join(''))) {
    if (word === '') continue;
    for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + 1)) {
      const end = from[at + word.length - 1] ?? chars.length - 1;
      for (let index = from[at] ?? 0; index <= end; index += 1) marked[index] = true;
    }
  }
  const parts: { text: string; mark: boolean }[] = [];
  chars.forEach((char, at) => {
    const last = parts.at(-1);
    if (last !== undefined && last.mark === marked[at]) last.text += char;
    else parts.push({ text: char, mark: marked[at] ?? false });
  });
  return parts;
}
