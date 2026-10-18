import { createRoot } from 'react-dom/client';
import './theme';

const root = createRoot(document.getElementById('root')!);

// The phone companion is a separate, lightweight entry (no three.js).
if (location.pathname.startsWith('/phone')) {
  void import('./phone/PhoneApp').then(({ default: PhoneApp }) => root.render(<PhoneApp />));
} else {
  void import('./App').then(({ default: App }) => root.render(<App />));
}
