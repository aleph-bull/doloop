import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@komodoit/ui/tokens.css';
import '@komodoit/ui/styles.css';
import { Options } from './Options';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
