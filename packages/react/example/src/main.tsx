import { createRoot } from 'react-dom/client';
import App from './App';

// No StrictMode here: it would double-mount and reboot the 52 MB editor in dev.
createRoot(document.getElementById('root')!).render(<App />);
