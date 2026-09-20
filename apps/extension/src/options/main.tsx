import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@doloop/ui/tokens.css';
import '@doloop/ui/styles.css';
import { Options } from './Options';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
