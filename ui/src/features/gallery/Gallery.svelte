<!--
  Component gallery (`?gallery`, development and harness builds only). Token boards first,
  then every component × variant × size × state. core/tests/ui_contract.rs requires that
  every file in components/ is imported here.
-->
<script lang="ts">
  import BrandMark from '$components/BrandMark.svelte';
  import Button, { BUTTON_VARIANTS } from '$components/Button.svelte';
  import EmptyState from '$components/EmptyState.svelte';
  import Icon, { ICON_NAMES } from '$components/Icon.svelte';
  import IconTile, { TILE_TONES } from '$components/IconTile.svelte';
  import { PORTAL_MONOGRAM } from '$lib/ipc/types/portals';
  import SideNav from '$components/SideNav.svelte';
  import Spinner from '$components/Spinner.svelte';
  import Toast from '$components/Toast.svelte';
  import Menu from '$components/Menu.svelte';
  import Tooltip from '$components/Tooltip.svelte';
  import WindowButtons from '$components/WindowButtons.svelte';
  import { toasts } from '$lib/state/toasts.svelte';
  import { tooltip } from '$lib/actions/tooltip';
  import ColourBoard from './ColourBoard.svelte';
  import MotionBoard from './MotionBoard.svelte';
  import Section from './Section.svelte';
  import FeedbackBoard from './FeedbackBoard.svelte';
  import InputBoard from './InputBoard.svelte';
  import MatchBoard from './MatchBoard.svelte';
  import SurfaceBoard from './SurfaceBoard.svelte';
  import TokenBoards from './TokenBoards.svelte';
  import { text } from './gallery';

  const NAV_ICONS = ['jobs', 'profile', 'settings'] as const;
  const tabs = text.navigation.tabs.map((label, index) => ({
    id: String(index),
    label,
    icon: NAV_ICONS[index] ?? 'jobs',
    testid: `gnav-${index}`,
  }));
  let activeTab = $state('0');
  /** How many toasts the gallery showed (each says its number). */
  let toastCount = 0;
  const noop = (): void => undefined;

  /** The sidebar full and as the rail (below 1100 px). */
  const navDemos = [
    { key: 'full', rail: false },
    { key: 'rail', rail: true },
  ] as const;
</script>

<div class="gallery" data-testid="gallery">
  <header class="intro">
    <h1 class="title">{text.title}</h1>
    <p class="lead">{text.intro}</p>
  </header>

  <Section heading={text.sections.colours} id="colours">
    <ColourBoard />
  </Section>

  <TokenBoards />

  <MotionBoard />

  <Section heading={text.sections.icons} id="icons">
    {#each ['sm', 'md', 'lg'] as const as size (size)}
      <div class="icons">
        {#each ICON_NAMES as name (name)}
          <span class="icon-cell" use:tooltip={name}><Icon {name} {size} /></span>
        {/each}
      </div>
    {/each}
  </Section>

  <Section heading={text.sections.buttons} id="buttons">
    {#each BUTTON_VARIANTS as variant (variant)}
      <div class="matrix">
        <span class="row-label">{variant}</span>
        <div class="button-row" data-testid="buttons-{variant}">
          <Button {variant} label={text.buttons.fetch} onclick={noop} />
          <Button {variant} label={text.buttons.save} icon="details" onclick={noop} />
          <Button {variant} label={text.buttons.pin} icon="star" iconOnly onclick={noop} />
          <Button {variant} label={text.buttons.fetch} icon="fetch" loading />
          <Button
            {variant}
            label={text.buttons.remove}
            icon="trash"
            disabled
            disabledReason={text.buttons.busy}
          />
        </div>
      </div>
    {/each}
    <div class="button-row">
      <Button
        variant="ghost"
        label={text.buttons.pin}
        icon="star"
        iconOnly
        pressed
        onclick={noop}
      />
      <Button
        variant="ghost"
        label={text.buttons.pin}
        icon="star"
        iconOnly
        pressed={false}
        onclick={noop}
      />
      <!-- A stored value changes; a reset warns on hover before its dialog asks. -->
      <Button label={text.buttons.change} icon="edit" onclick={noop} />
      <Button label={text.buttons.reset} icon="trash" warns testid="button-warns" onclick={noop} />
    </div>
  </Section>

  <Section heading={text.sections.navigation} id="navigation">
    <div class="navs">
      {#each navDemos as demo (demo.key)}
        {@const rail = demo.rail}
        <div class="side" class:rail data-testid="gnav-{demo.key}">
          <SideNav
            items={tabs}
            active={activeTab}
            label={text.sections.navigation}
            collapsed={rail}
            onselect={(id) => (activeTab = id)}
          />
        </div>
      {/each}
    </div>
    <div class="bar">
      <Button
        label={text.navigation.toast}
        onclick={() => toasts.show(text.navigation.toastText((toastCount += 1)))}
      />
    </div>
    <!-- The caption buttons of the Windows top bar (maximize shows the restore glyph while
         the window is maximized). -->
    <div class="caption-buttons">
      <WindowButtons testid="gallery-window-buttons" />
    </div>
  </Section>

  <Section heading={text.sections.tiles} id="tiles">
    {#each ['sm', 'md', 'lg'] as const as size (size)}
      <div class="tiles">
        {#each TILE_TONES as tone (tone)}
          <IconTile {tone} {size} icon="inbox" />
        {/each}
        {#each Object.values(PORTAL_MONOGRAM) as monogram (monogram)}
          <IconTile tone="neutral" {size} {monogram} />
        {/each}
        <BrandMark {size} label={text.title} />
      </div>
    {/each}
  </Section>

  <Section heading={text.sections.empty} id="empty">
    <div class="empty">
      <EmptyState
        icon="alertMail"
        heading={text.empty.heading}
        text={text.empty.text}
        action={{ label: text.empty.action, icon: 'fetch', onclick: noop }}
        secondary={{ label: text.empty.secondary, onclick: noop }}
      />
    </div>
    <div class="empty">
      <EmptyState text={text.empty.text} action={{ label: text.empty.action, onclick: noop }} />
    </div>
  </Section>

  <Section heading={text.sections.activity} id="activity">
    <div class="tiles">
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
    </div>
  </Section>

  <SurfaceBoard />

  <InputBoard />

  <FeedbackBoard />

  <MatchBoard />

  <Toast />
  <Menu />
  <Tooltip />
</div>

<style>
  .gallery {
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
    height: 100%;
    padding: var(--space-32);
    overflow: auto;
    background-color: var(--bg);
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }

  .title {
    color: var(--text-heading);
    font: var(--type-display);
    letter-spacing: var(--tracking-tight);
  }

  .lead {
    color: var(--text-muted);
    font: var(--type-body);
  }

  .icons,
  .tiles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-12);
  }

  .icon-cell {
    display: inline-flex;
    padding: var(--space-8);
    border-radius: var(--radius-sm);
    color: var(--text-heading);
  }

  .icon-cell:hover {
    background-color: var(--quiet-hover);
  }

  .matrix {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }

  .row-label {
    color: var(--text-muted);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  .button-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-12);
  }

  .navs {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-16);
    margin-bottom: var(--space-16);
  }

  .side {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    width: var(--sidebar-width);
    padding: var(--space-12);
    border-radius: var(--radius-md);
    border: var(--border-width) solid var(--border);
    background-color: var(--bg);
  }

  .side.rail {
    align-items: center;
    width: var(--rail-width);
  }

  .bar {
    display: flex;
    align-items: center;
  }

  /* As high as the top bar, on its colour. */
  .caption-buttons {
    display: flex;
    justify-content: flex-end;
    box-sizing: content-box;
    height: var(--titlebar-height);
    border-radius: var(--radius-md);
    border: var(--border-width) solid var(--titlebar-border);
    background-color: var(--titlebar-bg);
  }

  .empty {
    display: flex;
    justify-content: center;
    padding: var(--space-32);
    border-radius: var(--radius-card);
    background-color: var(--bg);
  }
</style>
