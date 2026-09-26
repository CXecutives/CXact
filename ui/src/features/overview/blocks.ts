// The blocks of the Übersicht, in the order the page shows them, each with the rule for when
// it shows (only with content). Reordering, hiding or adding a block is one entry here; a
// block's look comes from blocks/Block.svelte, its data from model.svelte.ts.

import type { Component } from 'svelte';
import { app } from '$lib/state/app.svelte';
import BestBlock from './blocks/BestBlock.svelte';
import FilesBlock from './blocks/FilesBlock.svelte';
import InboxBlock from './blocks/InboxBlock.svelte';
import MarketBlock from './blocks/MarketBlock.svelte';
import MustsBlock from './blocks/MustsBlock.svelte';
import OpenPointsBlock from './blocks/OpenPointsBlock.svelte';
import { overview } from './model.svelte';

export interface OverviewBlock {
  id: string;
  component: Component;
  /** The block has something to show. */
  visible: () => boolean;
}

export const BLOCKS: readonly OverviewBlock[] = [
  // "Eingang": Abrufen, the counts, a failed fetch.
  { id: 'inbox', component: InboxBlock, visible: () => true },
  // "Heute ansehen", or in its place that the jobs did not load.
  { id: 'best', component: BestBlock, visible: () => overview.failed || overview.best.length > 0 },
  { id: 'open', component: OpenPointsBlock, visible: () => overview.points.length > 0 },
  { id: 'musts', component: MustsBlock, visible: () => overview.openMusts.length > 0 },
  { id: 'market', component: MarketBlock, visible: () => overview.showMarket },
  { id: 'files', component: FilesBlock, visible: () => overview.fetchedOnce && app.state !== null },
];
