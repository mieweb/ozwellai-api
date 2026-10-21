// The only deployment setting. For development, use http://localhost:3000.
// Move to https://ozwell.ai once its widget/API/auth routes are deployed.
export const WIDGET_ORIGIN = 'https://ozwellapi.os.mieweb.org';

export const WIDGET = Object.freeze({
  origin: WIDGET_ORIGIN,
  frameUrl: `${WIDGET_ORIGIN}/widget/frame/?ozwellLoader=1`,
  endpoint: `${WIDGET_ORIGIN}/v1/chat/completions`,
});
