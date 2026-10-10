// The words the profile's fields suggest while typing: the engine's (a competence and the
// tools; the wished roles; the industries), asked once per session (`vocabulary`), prepared once
// and shared by every field, and the regions of Germany, Austria and Switzerland from the
// catalog. Until the engine's words are there, and when they cannot be read, the fields take
// text as always (a later form asks again).

import { vocabularyOf, type Vocabulary } from '$components/Suggestions.svelte';
import { de } from '$lib/i18n/de';
import { invoke } from '$lib/ipc/api';

class Words {
  skills = $state.raw<Vocabulary | null>(null);
  roles = $state.raw<Vocabulary | null>(null);
  industries = $state.raw<Vocabulary | null>(null);
  readonly regions: Vocabulary = vocabularyOf(de.profile.regionNames);
  #asked = false;

  load(): void {
    if (this.#asked) return;
    this.#asked = true;
    invoke('vocabulary')
      .then((words) => {
        this.skills = vocabularyOf(words.skills);
        this.roles = vocabularyOf(words.roles);
        this.industries = vocabularyOf(words.industries);
      })
      .catch(() => {
        this.#asked = false;
      });
  }
}

export const vocabulary = new Words();
