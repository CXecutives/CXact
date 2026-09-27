// The engine's words for the suggestions of the profile's fields (a competence, its
// synonyms, the tools and search terms; the industries): asked once per session
// (`vocabulary`), prepared once and shared by every field. Until they are there, and when
// they cannot be read, the fields take text as always (a later form asks again).

import { vocabularyOf, type Vocabulary } from '$components/Suggestions.svelte';
import { invoke } from '$lib/ipc/api';

class Words {
  skills = $state.raw<Vocabulary | null>(null);
  industries = $state.raw<Vocabulary | null>(null);
  #asked = false;

  load(): void {
    if (this.#asked) return;
    this.#asked = true;
    invoke('vocabulary')
      .then((words) => {
        this.skills = vocabularyOf(words.skills);
        this.industries = vocabularyOf(words.industries);
      })
      .catch(() => {
        this.#asked = false;
      });
  }
}

export const vocabulary = new Words();
