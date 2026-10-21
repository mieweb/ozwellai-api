# Safari development package

`package-safari.sh` builds a self-contained `ozwell.app` using the selected Xcode
installation. It requires macOS, full Xcode, Python 3, and esbuild. It finds
esbuild in `PATH` or the repository's installed root, reference-server, or
landing-page dependencies. Pass `--esbuild /absolute/path/to/esbuild` to use
another existing installation. The script does not download build tools.

```sh
browser-extension/scripts/package-safari.sh --output-dir /tmp/ozwell-safari-build
```

Use a fresh output directory for each build. The output contains the copied web
extension, generated Xcode project, final app, build logs, and tool versions.
The script checks that the chat host and brand assets are packaged. It bundles
only the copied background worker as a classic script for Safari compatibility;
the repository's Chrome source keeps its ES modules. Safari 16.4 or later is
required for session storage and dynamic content-script registration.

The default ad-hoc signing uses no developer certificate. The stable default
identifiers are `ai.ozwell.minimal.development` and
`ai.ozwell.minimal.development.Extension`, preserving the existing local install
identity while displaying **ozwell**. An explicit `--sign-identity` can select a
developer identity already configured on the build machine.

Building does not open or enable the app. Xcode Launch Services registration is
disabled for the generated build product. When replacing the local install, keep
only one discoverable app with these identifiers; archive an older backup rather
than leaving a second `.app` beside it. Open the installed containing app, then
enable ozwell in Safari's Extensions settings. Ad-hoc development builds need
Safari's **Allow unsigned extensions** setting, which Safari resets when it
quits. The packaging script does not change that setting.
