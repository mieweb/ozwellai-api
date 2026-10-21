# ozwell browser extension

A small Manifest V3 shell around the hosted ozwell widget, stacked on
[PR #323](https://github.com/mieweb/ozwellai-api/pull/323). Click the mascot in the
browser toolbar to open chat directly. The yellow power button switches ozwell
on or off immediately; **Page settings** controls the optional floating launcher.
Chat, models, rendering, and authentication stay in the hosted widget.

**The public widget server still needs this PR's embedding update before toolbar
chat can render.** See [deployment status](#widget-deployment). The
[screenshots and 30-second walkthrough](./docs/README.md) use a local preview.

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

Closing a page chat panel preserves its iframe. Hiding its launcher, navigating,
or switching off destroys it. Existing host grants remain until revoked in the
browser's extension site-access settings; revocation stops automatic injection.

## Widget deployment

[`config.js`](./config.js) selects the widget origin. It currently uses
`https://ozwellapi.os.mieweb.org` while the primary domain is prepared.

Deployment checks on **October 21, 2026** found:

- `https://ozwell.ai/widget/frame/` returns **404** with
  `X-Frame-Options: SAMEORIGIN`; its widget, API, and auth routes need deployment
  or reverse proxying.
- `https://ozwellapi.os.mieweb.org/widget/frame/` returns **200**, but its current
  `frame-ancestors *` policy blocks extension toolbar popups. This PR updates the
  reference server to `frame-ancestors * chrome-extension: safari-web-extension:`.
  That server change and the widget autofocus update must be deployed there.

The configured origin must serve `/widget/frame/`, `/widget/ozwell.js`, `/v1/*`,
and `/auth/*`. Its proxy must preserve the widget embedding policy and avoid
conflicting `X-Frame-Options`. A visited site's own `frame-src` can also block the
page widget. The shell shows an **Open ozwell** fallback after a failed handshake;
it does not rewrite response headers.

For local development, [build the widget](../reference-server/embed/README.md#building-and-validating),
start the reference server, and set `WIDGET_ORIGIN` to `http://localhost:3000` in
`config.js`. Reload the extension. The manifest permits the two public hosts and
HTTP loopback development servers. For another HTTPS deployment, also add its
origin to `content_security_policy.extension_pages` → `frame-src` in
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

All extension scripts are packaged locally. The sandboxed remote iframe receives
only widget configuration and the empty MCP tool handshake. Both message origin
and sender frame are checked. The extension supplies no page content, native
WebMCP tools, browser commands, or API keys to chat.

```sh
npm --prefix browser-extension test
npm --prefix browser-extension run test:browser
```

The browser check requires the built widget and landing-page Playwright
dependencies. It loads the extension, routes requests to the actual widget bundle
with demonstration auth responses, and verifies toolbar chat, focus, power,
launcher modes, and message boundaries. It does not validate a live model,
provider sign-in, or browser permission consent dialogs. See the
[preview evidence](./docs/README.md) for screenshots and the recorded workflow.
