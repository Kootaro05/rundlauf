import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

// Neue Versionen: iOS hält die installierte App lange im Hintergrund, ohne sie neu zu starten.
// Darum bei jedem Zurückholen (und stündlich) nach einem Update schauen; gibt es eins,
// übernimmt der Service Worker es und die Seite lädt einmal neu.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => void registration.update().catch(() => { /* offline: beim nächsten Mal */ });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    window.setInterval(check, 60 * 60 * 1000);
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
