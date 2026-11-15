import './fonts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@egdev/tokens/tokens.css';
import '@egdev/ui/styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
