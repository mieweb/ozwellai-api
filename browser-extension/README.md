# ozwell browser extension

A small Manifest V3 shell around the hosted ozwell widget, stacked on
[PR #326](https://github.com/mieweb/ozwellai-api/pull/326), using its pinned
`@mieweb/page-controller` fork for page control. Click the mascot in the
browser toolbar to open chat directly. The yellow power button switches ozwell
on or off immediately; **Page settings** controls the optional floating launcher.
Chat, models, rendering, and authentication stay in the hosted widget.

**The public widget server still needs this PR's embedding update before toolbar
chat can render.** See [deployment status](#widget-deployment). The
[screenshots and short videos](./docs/README.md) use a local preview.

## Install

For Chrome and Chromium browsers:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this `browser-extension` folder.
3. Pin **ozwell** in the toolbar, then click its mascot to open chat.
4. Sign in through the widget. After authentication, the composer receives focus.

No extension build or `npm install` is required. Reload the extension after
editing its files, and refresh pages containing the launcher. Toolbar chat also
opens on browser pages where a content script cannot run.

For Safari, use the [development packaging script](./scripts/README.md). It builds
a branded, self-contained `ozwell.app` on macOS with Xcode; install the containing
app and enable **ozwell** in Safari Extensions settings. The existing development
bundle identifiers are retained, so the lowercase name updates the same local
extension. Packaging does not install or enable it automatically.

## Power and page settings

Turning ozwell off immediately removes its toolbar iframe and page launchers.
It also cancels pending page tools and closes their connections.
Turning it back on restores the saved page mode. Page mode buttons select a draft;
**Save settings** applies it and requests any required site access. Saving page
settings while off keeps ozwell off and updates the mode to resume.

| Page mode | Launcher behavior | Site access |
| --- | --- | --- |
| **On demand** (default) | **Show page launcher** enables it for the current page; navigation or reload resets it. | Temporary `activeTab` access from the toolbar action. |
| **Selected sites** | Show it automatically on saved exact domains. | Request those hosts when saving or resuming. |
| **All sites** | Show it automatically on supported HTTP and HTTPS pages. | Request HTTP and HTTPS host access when saving or resuming. |

Toolbar chat is available in every enabled page mode. The page toggle can
temporarily override automatic launcher behavior; saving settings clears these
overrides. Domains accept hostnames or HTTP(S) URLs. Add `ui.mieweb.org` and
`app.ui.mieweb.org` separately; schemes, paths, and ports are not domain filters.
Browser-protected pages and the Chrome Web Store cannot host the page launcher.

Closing a page chat panel preserves its iframe and stops page tools until reopened.
Hiding its launcher, navigating, or switching off destroys it. Existing host grants
remain until revoked in the browser's extension site-access settings; revocation
stops automatic injection and resets page-tool connections.

## Page control

Opening toolbar chat while ozwell is on connects the widget to the website that
was active when the popup opened, using the browser's temporary `activeTab`
permission. This also works in **On demand** mode with the floating launcher
hidden. The popup reports whether page control is available; protected browser
pages retain ordinary chat. Opening a page launcher connects to that page only.

The widget discovers five page tools through MCP:

| Tool | Behavior |
| --- | --- |
| `browser_snapshot` | Read visible page text and indexed controls. |
| `browser_click` | Click a supported visible control. |
| `browser_fill` | Replace text in an editable input or textarea. |
| `browser_select` | Choose a native select option by its visible label. |
| `browser_scroll` | Scroll up or down. |

Actions require the latest snapshot's unpredictable `snapshotId` and element
index, show a brief cyan and gold outline, and return a fresh snapshot. Changes
to the DOM, fields, or URL invalidate old references. Closing toolbar chat,
navigation, permission revocation, or turning ozwell off cancels pending work.
The widget cannot choose another tab or frame. Tools are advertised on the wire
as `postMessage_browser_*` and respect the agent's
[`pageTools` policy](../docs/backend/agents.md#yaml-fields).

Snapshots exclude the extension UI, embedded frames, password/file/hidden and
recognized credential fields, and subtrees marked `data-ozwell-private`.
Field values and URL queries/fragments are omitted. Ordinary visible page text
may still contain sensitive information: tool results become conversation context
when the agent requests them. This filtering is not a general data-loss prevention
system.

Actions support native inputs, textareas, selects, and explicit
`button[type="button"]` controls. Links, form submission, sensitive fields,
disabled/read-only controls, arbitrary JavaScript, cross-frame actions, and
browser navigation commands are unavailable. The extension performs guarded DOM
actions locally; a website's own event handlers can still have side effects.
It cannot undo an action that the page has already handled.

## Widget deployment

[`config.js`](./config.js) selects the widget origin. It uses
`https://api.ozwell.ai`, the production API and widget origin documented in the
[project overview](../docs/overview.md). The `ozwell.ai` apex is not the API origin.

Deployment checks on **October 22, 2026** found:

- `https://api.ozwell.ai/widget/frame/?ozwellLoader=1` returns **200**, but its
  current `frame-ancestors *` policy blocks extension toolbar popups. Its response
  also includes `X-Frame-Options: SAMEORIGIN`; Chrome enforces the CSP ancestor
  policy in preference to that header.
- `https://ozwellapi.os.mieweb.org/widget/frame/` returns **200**, but its current
  embedding policy has the same restriction, so switching to that legacy host
  does not resolve the popup failure.

This PR updates the reference server to
`frame-ancestors * chrome-extension: safari-web-extension:`. That server change
and the widget autofocus update must be deployed at the configured origin.

The configured origin must serve `/widget/frame/`, `/widget/ozwell.js`, `/v1/*`,
and `/auth/*`. Its proxy must preserve the widget embedding policy and avoid
conflicting `X-Frame-Options`. A visited site's own `frame-src` can also block the
page widget. The shell shows an **Open ozwell** fallback after a failed handshake;
it does not rewrite response headers.

For local development, [build the widget](../reference-server/embed/README.md#building-and-validating),
start the reference server, and set `WIDGET_ORIGIN` to `http://localhost:3000` in
`config.js`. Reload the extension. The manifest permits the production API host,
the legacy host, and HTTP loopback development servers. For another
HTTPS deployment, also add its origin to
`content_security_policy.extension_pages` → `frame-src` in
[`manifest.json`](./manifest.json).

## Authentication and session lifetime

The widget owns sign-in and optional **Remember on this device** key storage;
the extension stores only page settings and temporary overrides. Browser toolbar
popups close when focus moves outside them, destroying their conversation and
in-memory sign-in session. Opening an OIDC provider window can therefore close
the initiating popup, and changing tabs to retrieve an email code has the same
constraint. Use **Open ozwell** to continue in the standalone widget for those
flows or longer sessions. An optionally remembered key belongs to widget-origin
storage, which browsers may partition by embedding site. Live sign-in and chat
must be checked after deployment.

## Local shell and validation

All extension scripts, including the controller, are packaged locally. The
sandboxed remote iframe receives widget configuration, five tool schemas when
available, and requested tool results. Tool requests require the configured
origin, direct sender frame, and current widget document identity. Unload notices
also require that document identity; browsers can clear the sender of a departing
document. Popup-to-page ports authenticate the extension popup and pin its original
tab, document session, and URL. The page launcher embeds an extension-owned host;
that host is the remote widget's parent and ignores website window messages.
An authenticated worker relay derives the host's tab and frame from the browser,
and the content script checks its per-frame token before exposing tools. Closing
the panel rotates the tool session while retaining chat. Reloading the remote
widget cancels its outstanding tool requests and starts a fresh page-tool session;
old results and snapshot references cannot carry into the replacement document.
Page control requires the widget's document-session handshake. Older widget
deployments without it retain chat with no page tools.
No public page events or main-world bridge expose these tools. The extension stores
no API keys.

The checked-in controller requires no installation build. Its
[provenance and rebuild instructions](./vendor/README.md) document the exact
fork commit inherited from #326, reproducible packaging, license notices, and
local patches that disable dynamic evaluation and support snapshot exclusions.

```sh
npm --prefix browser-extension test
npm --prefix browser-extension run test:browser
```

The browser check requires the built widget and landing-page Playwright
dependencies. It loads the extension, routes requests to the actual widget bundle
with demonstration auth responses, and verifies toolbar chat, focus, power,
launcher modes, page-tool round trips, and message boundaries. It does not validate a live model,
provider sign-in, or browser permission consent dialogs. See the
[preview evidence](./docs/README.md) for screenshots and the recorded workflow.
