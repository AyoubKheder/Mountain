import React from 'react';
import { createRoot } from 'react-dom/client';
import { Dashboard } from './Dashboard';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <React.StrictMode>
    <Dashboard />
  </React.StrictMode>,
);
