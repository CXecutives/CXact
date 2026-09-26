// The app's language: German or English. The backend decides it (the user's choice in
// Einstellungen, else German) and sends it with the app state; until that arrives the page
// is German too. Switching needs no restart:
// every text read through `t` (t.ts) and every number or date from format.ts follows
// `language.current`, which is reactive state.

import type { Language } from '../ipc/types';

/** The locale of numbers and dates per language: German, and British English (24 h, day first). */
const LOCALE: Record<Language, string> = { de: 'de-DE', en: 'en-GB' };

/** The app's language before the backend says it: the user's choice in Einstellungen, else
 *  German (`Language::DEFAULT`, whatever the OS language is). */
const BEFORE_STATE: Language = 'de';

class LanguageStore {
  current = $state<Language>(BEFORE_STATE);

  /** The locale for Intl formats. */
  get locale(): string {
    return LOCALE[this.current];
  }

  /** Switch the language of the whole page at once (also the `lang` of the document). */
  set(next: Language): void {
    this.current = next;
    document.documentElement.lang = next;
  }
}

export const language = new LanguageStore();
