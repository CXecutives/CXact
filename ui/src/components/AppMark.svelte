<!--
  The app's own mark (the setup's welcome, 56): the app icon itself, drawn from
  assets/app-icon.svg, the one source tools/icon.py writes with every icon file, so the mark
  in the app is the icon of the window and the installer. A soft shadow under it follows the
  plate's shape. It says nothing to a screen reader: the heading beside it names the app.
-->
<script lang="ts">
  import icon from '../assets/app-icon.svg';
</script>

<img class="mark" src={icon} alt="" draggable="false" aria-hidden="true" />

<style>
  .mark {
    display: block;
    flex: none;
    width: var(--app-mark);
    height: var(--app-mark);
    filter: var(--app-mark-shadow);
  }
</style>
