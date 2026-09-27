<!--
  The only importer of @lucide/svelte. It draws an icon by its meaning: lib/icons.ts maps
  each meaning to one Lucide glyph, and this file imports exactly those glyphs (one import
  per glyph keeps the bundle small; a glyph without its import is a type error). Size from
  the tokens, colour inherited from the text. Each glyph is drawn once by its Lucide
  component; every Icon shows a copy of that drawing. A Lucide component per icon (props,
  derived attributes, an element per path) made icons the most expensive part of a list row
  and of the reader.
-->
<script lang="ts" module>
  import { mount, unmount, type Component } from 'svelte';
  import type { Action } from 'svelte/action';
  import { ICONS, type Glyph, type IconMeaning } from '$lib/icons';
  import Archive from '@lucide/svelte/icons/archive';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Award from '@lucide/svelte/icons/award';
  import Ban from '@lucide/svelte/icons/ban';
  import Banknote from '@lucide/svelte/icons/banknote';
  import Briefcase from '@lucide/svelte/icons/briefcase';
  import Building from '@lucide/svelte/icons/building';
  import Building2 from '@lucide/svelte/icons/building-2';
  import Calendar from '@lucide/svelte/icons/calendar';
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleDashed from '@lucide/svelte/icons/circle-dashed';
  import CircleQuestionMark from '@lucide/svelte/icons/circle-question-mark';
  import CircleStop from '@lucide/svelte/icons/circle-stop';
  import CircleX from '@lucide/svelte/icons/circle-x';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import Clock from '@lucide/svelte/icons/clock';
  import Contrast from '@lucide/svelte/icons/contrast';
  import Copy from '@lucide/svelte/icons/copy';
  import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
  import DatabaseBackup from '@lucide/svelte/icons/database-backup';
  import Delete from '@lucide/svelte/icons/delete';
  import Download from '@lucide/svelte/icons/download';
  import Ellipsis from '@lucide/svelte/icons/ellipsis';
  import Euro from '@lucide/svelte/icons/euro';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Factory from '@lucide/svelte/icons/factory';
  import FilePenLine from '@lucide/svelte/icons/file-pen-line';
  import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
  import FileText from '@lucide/svelte/icons/file-text';
  import FileUp from '@lucide/svelte/icons/file-up';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Funnel from '@lucide/svelte/icons/funnel';
  import Globe from '@lucide/svelte/icons/globe';
  import Handshake from '@lucide/svelte/icons/handshake';
  import History from '@lucide/svelte/icons/history';
  import Hourglass from '@lucide/svelte/icons/hourglass';
  import House from '@lucide/svelte/icons/house';
  import Inbox from '@lucide/svelte/icons/inbox';
  import Info from '@lucide/svelte/icons/info';
  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import LogIn from '@lucide/svelte/icons/log-in';
  import LogOut from '@lucide/svelte/icons/log-out';
  import Mail from '@lucide/svelte/icons/mail';
  import MapPin from '@lucide/svelte/icons/map-pin';
  import MessageSquareText from '@lucide/svelte/icons/message-square-text';
  import OctagonX from '@lucide/svelte/icons/octagon-x';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Scale from '@lucide/svelte/icons/scale';
  import Scissors from '@lucide/svelte/icons/scissors';
  import Search from '@lucide/svelte/icons/search';
  import Settings from '@lucide/svelte/icons/settings';
  import Shield from '@lucide/svelte/icons/shield';
  import Star from '@lucide/svelte/icons/star';
  import Target from '@lucide/svelte/icons/target';
  import TextSelect from '@lucide/svelte/icons/text-select';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Undo2 from '@lucide/svelte/icons/undo-2';
  import UserRound from '@lucide/svelte/icons/user-round';
  import X from '@lucide/svelte/icons/x';

  /** The Lucide component of each glyph of lib/icons.ts (exactly those). */
  const GLYPHS = {
    archive: Archive,
    'arrow-down': ArrowDown,
    'arrow-right': ArrowRight,
    award: Award,
    ban: Ban,
    banknote: Banknote,
    briefcase: Briefcase,
    building: Building,
    'building-2': Building2,
    calendar: Calendar,
    check: Check,
    'chevron-down': ChevronDown,
    'chevron-left': ChevronLeft,
    'circle-check': CircleCheck,
    'circle-dashed': CircleDashed,
    'circle-question-mark': CircleQuestionMark,
    'circle-stop': CircleStop,
    'circle-x': CircleX,
    'clipboard-paste': ClipboardPaste,
    clock: Clock,
    contrast: Contrast,
    copy: Copy,
    'corner-down-left': CornerDownLeft,
    'database-backup': DatabaseBackup,
    delete: Delete,
    download: Download,
    ellipsis: Ellipsis,
    euro: Euro,
    'external-link': ExternalLink,
    eye: Eye,
    'eye-off': EyeOff,
    factory: Factory,
    'file-pen-line': FilePenLine,
    'file-spreadsheet': FileSpreadsheet,
    'file-text': FileText,
    'file-up': FileUp,
    'folder-open': FolderOpen,
    funnel: Funnel,
    globe: Globe,
    handshake: Handshake,
    history: History,
    hourglass: Hourglass,
    house: House,
    inbox: Inbox,
    info: Info,
    'layout-dashboard': LayoutDashboard,
    'log-in': LogIn,
    'log-out': LogOut,
    mail: Mail,
    'map-pin': MapPin,
    'message-square-text': MessageSquareText,
    'octagon-x': OctagonX,
    pencil: Pencil,
    plus: Plus,
    'refresh-cw': RefreshCw,
    'rotate-ccw': RotateCcw,
    'rotate-cw': RotateCw,
    scale: Scale,
    scissors: Scissors,
    search: Search,
    settings: Settings,
    shield: Shield,
    star: Star,
    target: Target,
    'text-select': TextSelect,
    'trash-2': Trash2,
    'triangle-alert': TriangleAlert,
    'undo-2': Undo2,
    'user-round': UserRound,
    x: X,
  } satisfies Record<Glyph, Component<Record<string, unknown>>>;

  /** What an icon says (lib/icons.ts): the name every component and view passes. */
  export type IconName = IconMeaning;
  export type IconSize = 'xs' | 'sm' | 'md' | 'lg';
  export const ICON_NAMES = Object.keys(ICONS) as IconName[];

  /** The drawing of each glyph used so far (the SVG its Lucide component renders). */
  const drawn: Partial<Record<Glyph, SVGSVGElement>> = {};

  /** A copy of the glyph of `name`, drawn by its Lucide component the first time. */
  function glyph(name: IconName): SVGSVGElement {
    const shape = ICONS[name];
    let svg = drawn[shape];
    if (svg === undefined) {
      const host = document.createElement('span');
      const component = mount(GLYPHS[shape], { target: host, props: { 'aria-hidden': 'true' } });
      const rendered = host.querySelector('svg');
      if (rendered === null) throw new Error(`icon ${name} drew no svg`);
      svg = rendered.cloneNode(true) as SVGSVGElement;
      void unmount(component);
      drawn[shape] = svg;
    }
    return svg.cloneNode(true) as SVGSVGElement;
  }

  /** `use:draw={name}`: the element shows the glyph `name` (drawn again only for another
   *  name: Svelte also calls an action's update when a row renders again with the same one). */
  const draw: Action<HTMLElement, IconName> = (node, name) => {
    let current = name;
    node.replaceChildren(glyph(name));
    return {
      update(next: IconName) {
        if (next === current) return;
        current = next;
        node.replaceChildren(glyph(next));
      },
    };
  };
</script>

<script lang="ts">
  interface Props {
    name: IconName;
    size?: IconSize;
    /** Filled glyph (the pinned star). */
    filled?: boolean;
  }

  let { name, size = 'md', filled = false }: Props = $props();
</script>

<span class="icon {size}" class:filled aria-hidden="true" use:draw={name}></span>

<style>
  .icon {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--icon-size);
    height: var(--icon-size);
    color: inherit;
  }

  .icon :global(svg) {
    width: 100%;
    height: 100%;
    stroke-width: var(--icon-stroke);
  }

  .filled :global(svg) {
    fill: currentcolor;
  }

  .xs {
    --icon-size: var(--icon-xs);
    --icon-stroke: var(--icon-stroke-xs);
  }

  .sm {
    --icon-size: var(--icon-sm);
    --icon-stroke: var(--icon-stroke-sm);
  }

  .md {
    --icon-size: var(--icon-md);
    --icon-stroke: var(--icon-stroke-md);
  }

  .lg {
    --icon-size: var(--icon-lg);
    --icon-stroke: var(--icon-stroke-lg);
  }
</style>
