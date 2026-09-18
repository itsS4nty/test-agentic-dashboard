import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { startLive } from './live.ts';
import { applySavedTheme } from './ui/theme.ts';

// Antes de montar: la consola se pinta ya con el tema guardado, sin parpadeo.
applySavedTheme();
startLive();
createApp(App).mount('#app');
