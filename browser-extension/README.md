# Ozwell Minimal browser extension

A build-free Manifest V3 framework for Chrome and Chromium browsers, based on
the Ozwell widget and stacked on [PR #323](https://github.com/mieweb/ozwellai-api/pull/323).
The extension adds a small, collapsed **Ozwell** launcher. Opening it loads the
existing hosted widget; chat, rendering, models, and sign-in stay on Ozwell's
origin. There are no runtime dependencies or bundled copies of the chat app.

## Try it

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked** and select this `browser-extension` folder.
3. Pin **Ozwell Minimal** in the toolbar and open a regular HTTP or HTTPS page.
4. Open the toolbar popup and choose **Show Ozwell on this page**.
5. Click the floating **Ozwell** launcher to open chat.

No build or `npm install` is needed. After editing files, reload the extension
and refresh any test pages. Firefox and Safari packaging are outside this scaffold.

## Modes

| Mode | Behavior | Site access |
| --- | --- | --- |
| **On demand** (default) | Show or hide Ozwell for the current page from the toolbar. Resets on navigation or reload. | Temporary `activeTab` access from the toolbar action. |
| **Whitelisted domains** | Show the launcher automatically on saved exact hostnames. | Ask for those hosts when saving. |
| **Always on** | Show the launcher automatically on HTTP and HTTPS pages. | Ask for HTTP and HTTPS site access when saving. |
| **Off** | Remove all extension launchers and frames. | No injection. |

Domain entries accept hostnames or HTTP(S) URLs. `example.com` does not include
`www.example.com` or `app.example.com`; add each explicitly. Schemes, ports, and
paths are not domain filters. Browser-protected pages such as `chrome://` and
the Chrome Web Store cannot host the launcher.

The page toggle can temporarily override either automatic mode. Saving any mode
clears page overrides. Closing the chat panel preserves its frame and conversation;
hiding Ozwell, navigating, or switching Off destroys the frame. Previously granted
browser host permissions remain until revoked in Chrome's extension site-access
settings. Mode rules still control injection; revocation removes automatic
injection for the affected hosts.

## Hosted widget deployment

[`config.js`](./config.js) is the single deployment setting. The default is
`https://ozwell.ai`. That origin needs to serve the existing reference server's:

- `/widget/frame/` and `/widget/ozwell.js` (the frame's runtime bundle)
- `/v1/*` (chat, models, and agent endpoints)
- `/auth/*` (the widget's sign-in routes)

**Deployment status, checked October 21, 2026:** `https://ozwell.ai/widget/frame/`
returns 404 with `X-Frame-Options: SAMEORIGIN`. The public domain needs those
routes deployed or reverse-proxied before live chat works. This scaffold displays
a fallback link when the frame does not complete the widget handshake.

For a working local widget, follow the
[widget build instructions](../reference-server/embed/README.md#building-and-validating),
start the reference server, and change `WIDGET_ORIGIN` in `config.js` to
`http://localhost:3000`. Reload the extension. HTTP loopback origins are supported
for development; deployed widget origins must use HTTPS.

The widget host must permit cross-origin framing. The reference server already
sets `frame-ancestors *` for widget routes; its reverse proxy must also avoid
conflicting `X-Frame-Options`. A visited website's own `frame-src` policy can block
embedding; the fallback opens Ozwell directly. The extension does not rewrite
site response headers.

## Small local shell, hosted application

```text
toolbar popup → background mode/permission policy → isolated content script
                                                    └─ sandboxed Ozwell iframe
                                                       └─ hosted widget + API + auth
```

Manifest V3 requires extension scripts to be packaged locally. Code in an iframe
isolated from extension APIs can be hosted remotely under
[Chrome's MV3 policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements).
This framework therefore bundles only the mode policy, popup, launcher, and fixed
widget protocol bridge. It never loads `/widget` as a remote script into a visited
page or extension context, evaluates remote JavaScript, or accepts remote browser
commands. Store submission/review is a separate step.

The iframe uses the widget's existing `ozwell-chat-parent` / `ozwell-chat-widget`
config protocol and MCP JSON-RPC transport. Both sender window and exact origin
are checked, and outgoing messages target that origin. The shell supplies an
empty page-tool list and handles the MCP handshake. It does not read page content,
register native WebMCP tools, execute page tools, or forward arbitrary extension
APIs. Adding explicit tools can build on #323's schemas and authorization rules
in a later layer.

The extension stores only modes/domains (`storage.local`) and temporary page
overrides (`storage.session`). It does not store API keys or authentication tokens.
Sign-in and any optional remembered key belong to the hosted widget; browser
storage partitioning can require sign-in on different sites. No page context is
sent to chat by this scaffold.

## Validation

```bash
npm --prefix browser-extension test
```

Dependency-free Node tests exercise domain rules, permission changes, worker
lifecycle, temporary overrides, launcher teardown, lazy loading, and the iframe
message boundary.

After building the widget and installing the landing-page Playwright dependencies,
run `npm --prefix browser-extension run test:browser` for a loaded Chromium
extension check. It copies the extension into a disposable fixture with site access
pregranted, routes requests to the built widget bundle, and checks the real sign-in
UI, message handshake, lazy loading, and mode changes across hosts. It does not test
Chrome's permission consent dialog or a live backend. Optional environment overrides
are `PLAYWRIGHT_MODULE_PATH`, `CHROMIUM_EXECUTABLE_PATH`, and `OZWELL_WIDGET_BUNDLE`.

For a manual browser check, test all modes, navigation/reload,
permission revocation, and opening/closing chat on two unrelated hosts. Verify
network requests start only when the launcher is opened and target the configured
widget origin. A deployment must also validate its real chat backend and sign-in.
