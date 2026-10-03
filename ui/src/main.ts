// Entry point. Order matters: styles, platform, motion (reads the tokens), input policy, error
// reporting - then mount.

import './styles/tokens.css';
import './styles/base.css';
import './styles/motion.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { installInput } from './lib/input/input';
import { installErrorReporting } from './lib/ipc/api';
import { installMotion } from './lib/motion/motion';
import { applyPlatform, trackWindowFocus } from './lib/platform';

applyPlatform();
trackWindowFocus();
installMotion();
installInput();
installErrorReporting();

const target = document.getElementById('app');
if (target === null) throw new Error('#app is missing in index.html');

// `intro: false`: nothing animates at start (Svelte 5 would play every intro of the first
// frame, the view entry included).
mount(App, { target, intro: false });
