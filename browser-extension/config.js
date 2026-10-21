// The only deployment setting. For development, use http://localhost:3000.
// The production widget and API share this origin.
export const WIDGET_ORIGIN = 'https://api.ozwell.ai';

export const WIDGET = Object.freeze({
  origin: WIDGET_ORIGIN,
  frameUrl: `${WIDGET_ORIGIN}/widget/frame/?ozwellLoader=1`,
  endpoint: `${WIDGET_ORIGIN}/v1/chat/completions`,
});
