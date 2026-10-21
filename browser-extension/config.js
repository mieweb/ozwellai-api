// The only deployment setting. For development, use http://localhost:3000.
// This origin must serve the reference server's widget, API, and auth routes.
export const WIDGET_ORIGIN = 'https://ozwell.ai';

export const WIDGET = Object.freeze({
  origin: WIDGET_ORIGIN,
  frameUrl: `${WIDGET_ORIGIN}/widget/frame/?ozwellLoader=1`,
  endpoint: `${WIDGET_ORIGIN}/v1/chat/completions`,
});
