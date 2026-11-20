import '@mieweb/ui/styles.css';
import '@mieweb/ui/brands/ozwell.css';
import './widget.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WidgetApp } from './WidgetApp';
import { WidgetErrorBoundary, installGlobalErrorReporting } from './ErrorBoundary';

installGlobalErrorReporting();

document.documentElement.dataset.theme = document.documentElement.dataset.theme || 'light';
document.documentElement.dataset.brand = document.documentElement.dataset.brand || 'ozwell';

const root = document.createElement('div');
root.id = 'ozwell-widget-root';
document.body.innerHTML = '';
document.body.appendChild(root);

createRoot(root).render(
  <StrictMode>
    <WidgetErrorBoundary>
      <WidgetApp />
    </WidgetErrorBoundary>
  </StrictMode>
);
