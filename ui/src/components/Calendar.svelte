<!--
  A small calendar inside a day field at its right end, like a native date picker
  (TextField's `trailing`; Verfügbar ab): its button (a small ghost one, a Tab stop of its own)
  opens a month under the field, its right edge on the field's, the week from Monday, the
  month's name from the catalog. The chosen day is filled, today has a ring. The keys move
  like a native date picker (input.ts gridKeys): the arrows a day or a week, Home and End the
  week's ends, PageUp and PageDown a month; Enter or Space and a click take the day, Esc
  closes and gives the focus back to the button; leaving it closes it. The month's buttons
  move the focus to the same day in the other month. It only offers a day: the field keeps
  what is typed.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { formKeys, gridKeys, type GridMove } from '$lib/input/input';
  import { menuIn, menuOut } from '$lib/motion/transitions';
  import { tick } from 'svelte';
  import Button from './Button.svelte';

  interface Props {
    /** The day the field holds (`YYYY-MM-DD`), or null. */
    value: string | null;
    testid?: string | null;
    onpick: (day: string) => void;
  }

  let { value, testid = null, onpick }: Props = $props();

  const DAY_MS = 24 * 60 * 60 * 1000;
  const pad = (n: number): string => String(n).padStart(2, '0');
  /** A day as a number of days since 1970 (UTC), so a step is plain arithmetic. */
  const serial = (iso: string): number => {
    const [year, month, day] = iso.split('-').map(Number);
    return Math.round(Date.UTC(year!, month! - 1, day!) / DAY_MS);
  };
  const isoOf = (days: number): string => {
    const date = new Date(days * DAY_MS);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  };
  const todayIso = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };

  let open = $state(false);
  /** The month shown: its first day. */
  let first = $state(todayIso().slice(0, 8) + '01');
  /** The day that holds the focus in the grid (one Tab stop). */
  let focus = $state(todayIso());
  let root = $state<HTMLElement | null>(null);
  let grid = $state<HTMLElement | null>(null);

  const year = $derived(Number(first.slice(0, 4)));
  const month = $derived(Number(first.slice(5, 7)) - 1);
  const heading = $derived(`${t.calendar.months[month]} ${year}`);
  const today = $derived(open ? todayIso() : '');

  /** The weeks of the month, Monday first; days of other months are empty cells. */
  const weeks = $derived.by((): (string | null)[][] => {
    const start = serial(first);
    const lead = (new Date(start * DAY_MS).getUTCDay() + 6) % 7;
    const length = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const cells: (string | null)[] = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length }, (_, i) => isoOf(start + i)),
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  });

  const valid = (iso: string | null): iso is string =>
    iso !== null && /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(serial(iso));

  async function show(day: string): Promise<void> {
    focus = day;
    first = `${day.slice(0, 8)}01`;
    await tick();
    grid?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus();
  }

  async function toggle(): Promise<void> {
    if (open) {
      open = false;
      return;
    }
    open = true;
    await show(valid(value) ? value : todayIso());
  }

  /** Closed by Esc or a chosen day: the focus goes back to the button. */
  function close(): void {
    open = false;
    root?.querySelector<HTMLElement>('[data-calendar-button] button')?.focus();
  }

  function pick(day: string): void {
    onpick(day);
    close();
  }

  /** The same day a month before or after (the last day of a shorter month). */
  function monthAway(day: string, by: -1 | 1): string {
    const [y, m, d] = day.split('-').map(Number);
    const length = new Date(Date.UTC(y!, m! - 1 + by + 1, 0)).getUTCDate();
    const target = new Date(Date.UTC(y!, m! - 1 + by, Math.min(d!, length)));
    return isoOf(Math.round(target.getTime() / DAY_MS));
  }

  function move(step: GridMove): void {
    const at = serial(focus);
    const weekday = (new Date(at * DAY_MS).getUTCDay() + 6) % 7;
    const next =
      step === 'left'
        ? isoOf(at - 1)
        : step === 'right'
          ? isoOf(at + 1)
          : step === 'up'
            ? isoOf(at - 7)
            : step === 'down'
              ? isoOf(at + 7)
              : step === 'rowStart'
                ? isoOf(at - weekday)
                : step === 'rowEnd'
                  ? isoOf(at + 6 - weekday)
                  : monthAway(focus, step === 'back' ? -1 : 1);
    void show(next);
  }

  /** The month before or after, from its buttons: the same day there takes the focus
   *  (WebKit gives a clicked button none). */
  function turn(by: -1 | 1): void {
    void show(monthAway(focus, by));
  }

  /** A press inside the calendar: the focus it takes away (WebKit) is no leaving. */
  let pressed = false;
  function press(): void {
    pressed = true;
    setTimeout(() => (pressed = false));
  }

  /** The focus left the calendar (a click elsewhere, Tab out): it closes. */
  function leave(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (open && !pressed && !(next instanceof Node && root?.contains(next))) open = false;
  }
</script>

<span
  class="calendar"
  role="presentation"
  bind:this={root}
  onfocusout={leave}
  onpointerdown={press}
>
  <span class="toggle" data-calendar-button>
    <Button
      variant="ghost"
      iconOnly
      icon="pickDay"
      label={t.calendar.open}
      expanded={open}
      {testid}
      onclick={() => void toggle()}
    />
  </span>
  {#if open}
    <div
      class="popover"
      data-testid={testid ? `${testid}-popover` : undefined}
      use:formKeys={{ cancel: close }}
      in:menuIn
      out:menuOut
    >
      <div class="head">
        <Button
          variant="ghost"
          iconOnly
          icon="back"
          label={t.calendar.previous}
          testid={testid ? `${testid}-previous` : null}
          onclick={() => turn(-1)}
        />
        <span class="title" aria-live="polite" data-testid={testid ? `${testid}-month` : undefined}
          >{heading}</span
        >
        <Button
          variant="ghost"
          iconOnly
          icon="forward"
          label={t.calendar.next}
          testid={testid ? `${testid}-next` : null}
          onclick={() => turn(1)}
        />
      </div>
      <div class="grid" role="grid" aria-label={heading} bind:this={grid} use:gridKeys={move}>
        <div class="week" role="row">
          {#each t.calendar.weekdays as weekday (weekday)}
            <span class="weekday" role="columnheader">{weekday}</span>
          {/each}
        </div>
        {#each weeks as week, row (row)}
          <div class="week" role="row">
            {#each week as day, column (column)}
              <span class="cell" role="gridcell" aria-selected={day !== null && day === value}>
                {#if day !== null}
                  <button
                    type="button"
                    class="day"
                    class:chosen={day === value}
                    class:today={day === today}
                    tabindex={day === focus ? 0 : -1}
                    data-day={day}
                    aria-label={t.calendar.day(
                      Number(day.slice(8)),
                      t.calendar.months[month]!,
                      year,
                    )}
                    aria-current={day === today ? 'date' : undefined}
                    onclick={() => pick(day)}
                  >
                    {Number(day.slice(8))}
                  </button>
                {/if}
              </span>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</span>

<style>
  .calendar {
    position: relative;
    display: inline-flex;
  }

  .toggle {
    display: inline-flex;
  }

  /* Under the field, over what follows, like a menu: the small button sits 2 px inside the
     field's bottom edge and 4 px and the border inside its right edge. */
  .popover {
    position: absolute;
    z-index: var(--z-overlay);
    top: calc(100% + var(--space-2) + var(--menu-gap));
    right: calc(-1 * (var(--space-4) + var(--border-width)));
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-8);
    border: var(--border-width) solid var(--border);
    border-radius: var(--radius-control);
    background-color: var(--surface-raised);
    box-shadow: var(--sh-pop);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-8);
  }

  .title {
    color: var(--text);
    font: var(--type-sm);
    font-weight: var(--weight-medium);
  }

  .grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .week {
    display: grid;
    grid-template-columns: repeat(7, var(--calendar-cell));
    gap: var(--space-2);
  }

  .weekday {
    color: var(--text-muted);
    font: var(--type-xs);
    line-height: var(--calendar-cell);
    text-align: center;
  }

  .cell {
    display: flex;
  }

  .day {
    width: var(--calendar-cell);
    height: var(--calendar-cell);
    border-radius: var(--radius-xs);
    color: var(--text);
    font: var(--type-sm);
    font-variant-numeric: var(--numeric);
    transition: background-color var(--dur-fast) var(--ease-standard);
  }

  .day:hover {
    background-color: var(--quiet-hover);
    transition-duration: var(--dur-hover);
  }

  .day:focus-visible {
    box-shadow: var(--focus-ring);
  }

  .today {
    font-weight: var(--weight-semibold);
    box-shadow: inset 0 0 0 var(--border-width) var(--border-strong);
  }

  .chosen,
  .chosen:hover {
    background-color: var(--active-surface);
    color: var(--active-text);
    font-weight: var(--weight-semibold);
  }
</style>
