import '@mieweb/ui/styles.css';
import '@mieweb/ui/brands/ozwell.css';
import './widget.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WidgetApp } from './WidgetApp';

document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
document.documentElement.dataset.brand = document.documentElement.dataset.brand || 'ozwell';

const root = document.createElement('div');
root.id = 'ozwell-widget-root';
document.body.innerHTML = '';
document.body.appendChild(root);

createRoot(root).render(
  <StrictMode>
    <WidgetApp />
  </StrictMode>
);
