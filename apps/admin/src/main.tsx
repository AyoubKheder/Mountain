import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminConsole } from './AdminConsole';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <React.StrictMode>
    <AdminConsole />
  </React.StrictMode>,
);
