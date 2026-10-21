# Safari development package

`package-safari.sh` builds a self-contained `ozwell.app` using the selected Xcode
installation. It requires macOS, full Xcode, Python 3, and esbuild. It finds
esbuild in `PATH` or the repository's installed root, reference-server, or
landing-page dependencies. Pass `--esbuild /absolute/path/to/esbuild` to use
another existing installation. The script does not download build tools.

```sh
browser-extension/scripts/package-safari.sh --output-dir /tmp/ozwell-safari-build --build-number 2
```

Use a fresh output directory for each build. The output contains the copied web
extension, generated Xcode project, final app, build logs, and tool versions.
`--build-number` sets and verifies `CFBundleVersion` in both the app and its
embedded extension. It defaults to `1`; choose a higher number than the installed
build when updating. The bundle identifiers stay unchanged.
The script checks that the chat host and brand assets are packaged. It bundles
only the copied background worker as a classic script for Safari compatibility;
the repository's Chrome source keeps its ES modules. Safari 16.4 or later is
required for session storage and dynamic content-script registration.

The default ad-hoc signing uses no developer certificate. The stable default
identifiers are `ai.ozwell.minimal.development` and
`ai.ozwell.minimal.development.Extension`, preserving the existing local install
identity while displaying **ozwell**. An explicit `--sign-identity` can select a
developer identity already configured on the build machine.

Building does not open or enable the app. Xcode registers macOS app build
products with Launch Services; the script unregisters only its generated
DerivedData app and extension before exiting, including after build failures.
It does not unregister an installed app. When replacing the local install, keep
only one discoverable app with these identifiers; archive an older backup rather
than leaving a second `.app` beside it. Open the installed containing app, then
enable ozwell in Safari's Extensions settings. Ad-hoc development builds need
Safari's **Allow unsigned extensions** setting, which Safari resets when it
quits. The packaging script does not change that setting.

To update a local install, disable ozwell in Safari's Extensions settings, replace
the entire installed app with a freshly built app using a higher build number,
open the new containing app, and re-enable its extension. Do not edit files or
re-sign the app in place while Safari has the extension loaded. Safari can retain
the loaded bundle's resource validation state; a newly signed disk bundle alone
does not establish that the running extension has loaded the update. If Safari
reports a resource signature error, verify the complete replacement app and
reload the extension through the disable, replace, and enable sequence.

For an additional runtime check on macOS 15.4 or later with a compatible Xcode
Swift toolchain, load the signed popup through WebKit:

```sh
xcrun swift browser-extension/scripts/validate-safari-popup.swift /path/to/ozwell.app
```

The check accepts an app or embedded `.appex` path and verifies the popup's HTML,
CSS, mascot, JavaScript, and runtime errors. It uses the signed bundle initializer,
which validates resources against the code signature, and has a 20-second timeout.
It neither installs the app nor reads Safari's profile. It does not validate live
chat or sign-in. After replacing the app, also open Safari's actual toolbar popup
to confirm its enabled instance has loaded the replacement.
