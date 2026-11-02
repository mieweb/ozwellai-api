# Packaged page controller

`page-controller.js` is a checked-in local IIFE for Chrome 102 and Safari 16.4.
Loading the unpacked extension needs no dependency install or browser build.
The controller runs in the extension's isolated content world; the Ozwell chat
application remains remotely hosted in its iframe.

The source is `@mieweb/page-controller` 1.12.4-mie.2 from
[`mieweb/page-agent` commit 6963ab7a183ce38cce3f1bfc29e5c3ff206a1973](https://github.com/mieweb/page-agent/commit/6963ab7a183ce38cce3f1bfc29e5c3ff206a1973),
also pinned by the landing-page manifest and lockfile. See `PROVENANCE.json` for
verified source hashes, build tool version, local patches, and output hash.

From the repository root, install its locked build dependencies and the
landing-page dependencies, then run:

```sh
npm --prefix browser-extension run build:controller
```

To reuse an existing installation of that exact pinned package:

```sh
npm --prefix browser-extension run build:controller -- --package-dir /path/to/landing-page/node_modules/@mieweb/page-controller
```

The build command does not fetch dependencies or run package lifecycle hooks.
It verifies the pinned lockfile entry and each input file's SHA-256 before
applying exact, asserted patches. It disables arbitrary JavaScript execution,
adds subtree exclusion and attribute omission hooks, and skips invisible
upstream highlights. `excludeElements` receives Element nodes and prunes their
entire subtree before traversal. `omitAttributes` removes attributes from the
serialized snapshot even when requested through a wildcard.
`omitAttributes: ['value']` also suppresses textarea default-value text while
retaining the indexed textarea control. With both highlight
opacities set to zero, indexing works without creating upstream highlight DOM.
Hidden descendant and standalone text are excluded. Invisible controls expose
neither attributes nor action indices: display, content visibility, and zero
opacity are checked through composed ancestors, including slots and shadow
hosts. A child that restores CSS visibility and rendered `display:contents` text
remain available. Explicit native select labels use `option.label`, including
labels without text children; implicit labels retain descendant exclusion and
visibility checks. Unused fallback text and choices hidden on their option,
optgroup, select, or ancestors are omitted. The complete bundle has a document
initialization guard, so repeated injections retain the same controller export
and do not add navigation listeners or polling intervals.

Only `globalThis.OzwellPageController.PageController` is exported. The extension's
adapter owns tool exposure, authorization, stale-reference checks, exclusions,
and action presentation. It uses `enableMask: false`; upstream mask CSS is not
needed or included. No remote executable script is downloaded by this bundle.

The controller's MIT copyright and permission notice are in `LICENSE`.
`THIRD_PARTY_NOTICES.md` records upstream attribution and the included ai-motion
dependency, whose MIT notice is retained in `ai-motion-LICENSE`. These notices
ship in the Safari package alongside the controller.
