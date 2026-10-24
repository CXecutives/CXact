// The rows of an item list of the Profil form (competences, languages) as the list shows
// them: by their name, each name once and none without one. The name is the row's key, so a
// list that comes back after a save (a new copy of the same rows) stays as it is; a second
// row of the same name (a file edited by hand) waits unseen until the save drops it, as core
// does.

/** The rows with a name, each name once (in any case), in their order. */
export function named<Row>(rows: readonly Row[], name: (row: Row) => string): Row[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyOf(name(row));
    if (key === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A name as the list compares it. */
export const keyOf = (name: string): string => name.trim().toLowerCase();
