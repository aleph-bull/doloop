import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../pages.css';
import { Blocked } from './Blocked';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Blocked />
  </StrictMode>,
);
