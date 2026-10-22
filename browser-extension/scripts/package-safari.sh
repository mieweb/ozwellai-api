#!/bin/bash
# Build a local Safari development app without installing or opening it.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
extension_dir="$(cd -- "$script_dir/.." && pwd)"
bundle_id="ai.ozwell.minimal.development"
sign_identity="-"
build_number="1"
esbuild_path=""
output_dir=""
icon_path="$extension_dir/assets/ozwell-512.png"

usage() {
  cat <<'USAGE'
Usage: browser-extension/scripts/package-safari.sh [options]

Build the current extension into an ad-hoc signed ozwell.app for local Safari testing.
Nothing is installed, launched, or enabled. The default output is a fresh
system temporary directory. Existing output apps are never overwritten.

  --output-dir PATH       Directory for ozwell.app and the reproducible build sources
  --icon PATH             Square PNG for the app and setup window (default assets/ozwell-512.png)
  --bundle-id IDENTIFIER  Host identifier (default preserves the existing Ozwell development app)
  --sign-identity NAME    Local codesign identity (default '-' for ad-hoc development)
  --build-number NUMBER   Positive integer CFBundleVersion for both bundles (default 1)
  --esbuild PATH          esbuild executable (otherwise find it in PATH or repository dependencies)
  --help                 Show usage
USAGE
}

while (($#)); do
  case "$1" in
    --output-dir|--icon|--bundle-id|--sign-identity|--esbuild|--build-number)
      if (($# < 2)); then printf 'Missing value for %s\n' "$1" >&2; exit 2; fi
      case "$1" in
        --output-dir) output_dir="$2" ;;
        --icon) icon_path="$2" ;;
        --bundle-id) bundle_id="$2" ;;
        --sign-identity) sign_identity="$2" ;;
        --esbuild) esbuild_path="$2" ;;
        --build-number) build_number="$2" ;;
      esac
      shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! "$build_number" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Build number must be a positive integer: %s\n' "$build_number" >&2
  exit 2
fi
if [[ "$(uname -s)" != Darwin ]]; then
  printf 'Safari packaging requires macOS and Xcode.\n' >&2
  exit 1
fi
for tool in xcrun xcodebuild python3 sips codesign ditto; do
  if ! command -v "$tool" >/dev/null; then printf 'Required tool not found: %s\n' "$tool" >&2; exit 1; fi
done
if [[ ! "$bundle_id" =~ ^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$ ]]; then
  printf 'Invalid bundle identifier: %s\n' "$bundle_id" >&2
  exit 2
fi
if [[ -z "$esbuild_path" ]]; then
  if command -v esbuild >/dev/null; then
    esbuild_path="$(command -v esbuild)"
  else
    for candidate in "$extension_dir/../node_modules/.bin/esbuild" \
      "$extension_dir/../reference-server/node_modules/.bin/esbuild" \
      "$extension_dir/../landing-page/node_modules/.bin/esbuild"; do
      if [[ -x "$candidate" ]]; then esbuild_path="$candidate"; break; fi
    done
  fi
fi
if [[ -z "$esbuild_path" || ! -x "$esbuild_path" ]]; then
  printf 'esbuild is required to package the Safari classic background worker.\nInstall the reference-server development dependencies or use --esbuild PATH.\n' >&2
  exit 1
fi
if [[ ! -f "$icon_path" ]]; then
  printf 'App icon not found: %s\nUse --icon with the repository mascot PNG.\n' "$icon_path" >&2
  exit 1
fi
if [[ -z "$output_dir" ]]; then output_dir="$(mktemp -d "${TMPDIR:-/tmp}/ozwell-safari.XXXXXX")"; fi
mkdir -p "$output_dir"
output_dir="$(cd -- "$output_dir" && pwd)"
if [[ -e "$output_dir/ozwell.app" || -e "$output_dir/project" || -e "$output_dir/extension" ]]; then
  printf 'Output contains a previous build; choose a fresh --output-dir: %s\n' "$output_dir" >&2
  exit 1
fi

# Xcode registers macOS app build products even when asked only to build. Remove
# this run's temporary registration on success or failure, never the installed app.
cleanup_generated_registration() {
  local generated_app="$output_dir/DerivedData/Build/Products/Debug/ozwell.app"
  local lsregister="/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister"
  if [[ -d "$generated_app" ]]; then
    {
      pluginkit -r "$generated_app/Contents/PlugIns/ozwell Extension.appex" || true
      "$lsregister" -u "$generated_app" || true
    } >"$output_dir/registration-cleanup.log" 2>&1
  fi
}
trap cleanup_generated_registration EXIT

# Stage only browser runtime files; do not ship tests, package metadata, or tooling.
python3 - "$extension_dir" "$output_dir/extension" <<'PY'
import json
from pathlib import Path
import shutil
import sys
source, destination = map(Path, sys.argv[1:])
destination.mkdir()
excluded = {'.git', 'node_modules', 'test', 'tests', 'scripts', 'screenshots', 'artifacts', 'build', 'dist'}
allowed = {'.js', '.mjs', '.json', '.html', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff', '.woff2', '.ttf', '.otf', '.wasm'}
vendor_notices = {'vendor/LICENSE', 'vendor/THIRD_PARTY_NOTICES.md', 'vendor/ai-motion-LICENSE'}
for path in source.rglob('*'):
    relative = path.relative_to(source)
    if any(part in excluded or part.startswith('.') for part in relative.parts):
        continue
    if not path.is_file() or (path.suffix.lower() not in allowed and relative.as_posix() not in vendor_notices) or path.name in {'package.json', 'package-lock.json'}:
        continue
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
manifest = json.loads((destination / 'manifest.json').read_text())
if manifest.get('name') != 'ozwell':
    raise SystemExit('Rename manifest.name to "ozwell" before packaging the branded app.')
# Keep the complete toolbar chat surface and branding in the self-contained app.
required = ('background.js', 'config.js', 'content-script.js', 'policy.js', 'popup.html', 'popup.js', 'popup.css', 'widget-host.js', 'page-connection.js', 'page-tools.js', 'mcp-bridge.js', 'page-host.html', 'page-host.css', 'page-host.js', 'page-host-relay.js', 'assets/ozwell-512.png', 'vendor/page-controller.js', 'vendor/PROVENANCE.json', *sorted(vendor_notices))
for name in required:
    if not (destination / name).is_file():
        raise SystemExit(f'Required runtime resource is missing: {name}')
for name in set(manifest.get('icons', {}).values()) | set(manifest.get('action', {}).get('default_icon', {}).values()):
    if not (destination / name).is_file():
        raise SystemExit(f'Manifest icon is missing: {name}')
if manifest.get('background', {}).get('service_worker') != 'background.js':
    raise SystemExit('Expected background.js service worker; review Safari bundling for this manifest.')
# Safari ignores background.type in some converter/runtime versions. Bundle only
# the copied worker into a classic script; Chrome keeps its original ES modules.
manifest['background'].pop('type', None)
manifest.setdefault('browser_specific_settings', {}).setdefault('safari', {})['strict_min_version'] = '16.4'
(destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
PY

"$esbuild_path" "$output_dir/extension/background.js" --bundle --format=iife \
  --platform=browser --target=safari16.4 \
  --outfile="$output_dir/background.bundled.js" >"$output_dir/bundle.log" 2>&1 || {
    cat "$output_dir/bundle.log" >&2
    exit 1
  }
mv "$output_dir/background.bundled.js" "$output_dir/extension/background.js"
{
  xcodebuild -version
  printf 'esbuild %s\n' "$("$esbuild_path" --version)"
} >"$output_dir/tool-versions.txt"

packager="safari-web-extension-packager"
if ! xcrun --find "$packager" >/dev/null 2>&1; then packager="safari-web-extension-converter"; fi
printf 'Generating Safari wrapper in %s\n' "$output_dir"
xcrun "$packager" "$output_dir/extension" \
  --project-location "$output_dir/project" \
  --app-name ozwell --bundle-identifier "$bundle_id" \
  --swift --macos-only --copy-resources --no-open --no-prompt \
  >"$output_dir/convert.log" 2>&1 || {
    cat "$output_dir/convert.log" >&2
    exit 1
  }

project_dir="$output_dir/project/ozwell"
app_source="$project_dir/ozwell"
if [[ ! -d "$project_dir/ozwell.xcodeproj" ]]; then
  printf 'Safari packager output changed; inspect %s\n' "$output_dir/convert.log" >&2
  exit 1
fi

# Keep the stable development identifiers while presenting the lowercase brand.
python3 - "$project_dir" "$bundle_id" "$build_number" <<'PY'
import plistlib
import re
from pathlib import Path
import sys
project = Path(sys.argv[1])
bundle_id = sys.argv[2]
build_number = sys.argv[3]
for path in (project / 'ozwell/Info.plist', project / 'ozwell Extension/Info.plist'):
    data = plistlib.loads(path.read_bytes())
    data['CFBundleDisplayName'] = 'ozwell'
    data['CFBundleName'] = 'ozwell'
    data['CFBundleVersion'] = build_number
    path.write_bytes(plistlib.dumps(data))
settings = project / 'ozwell.xcodeproj/project.pbxproj'
text = settings.read_text()
text = re.sub(r'MACOSX_DEPLOYMENT_TARGET = [^;]+;', 'MACOSX_DEPLOYMENT_TARGET = 12.0;', text)
# Some packager versions replace the host ID's final component with the app name.
# Pin both generated target identifiers explicitly to preserve the installed identity.
def identifier(match):
    value = match.group(1).strip().strip('\"')
    suffix = '.Extension' if value.endswith('.Extension') else ''
    return f'PRODUCT_BUNDLE_IDENTIFIER = {bundle_id}{suffix};'
text = re.sub(r'PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);', identifier, text)
text = re.sub(r'INFOPLIST_KEY_CFBundleDisplayName = [^;]+;', 'INFOPLIST_KEY_CFBundleDisplayName = ozwell;', text)
text = re.sub(r'CURRENT_PROJECT_VERSION = [^;]+;', f'CURRENT_PROJECT_VERSION = {build_number};', text)
settings.write_text(text)
controller = project / 'ozwell/ViewController.swift'
text = controller.read_text()
expected = f'let extensionBundleIdentifier = "{bundle_id}.Extension"'
if expected not in text:
    raise SystemExit('Unexpected generated extension identifier; inspect ViewController.swift')
PY

cp "$icon_path" "$app_source/Resources/Icon.png"
cat > "$app_source/Resources/Base.lproj/Main.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ozwell for Safari</title>
  <link rel="stylesheet" href="../Style.css">
  <script src="../Script.js" defer></script>
</head>
<body>
  <main>
    <img src="../Icon.png" width="112" height="112" alt="ozwell mascot">
    <p class="eyebrow">YOUR ASSISTANT, IN SAFARI</p>
    <h1>ozwell</h1>
    <p class="state-unknown">Turn on ozwell in Safari Extensions settings to get started.</p>
    <p class="state-on">ozwell is on. Choose its icon in Safari's toolbar to start a conversation.</p>
    <p class="state-off">Turn on ozwell in Safari Extensions settings to get started.</p>
    <button class="open-preferences">Open Safari Extensions Settings</button>
    <p class="note">Enable ozwell, then choose the ozwell icon in your Safari toolbar.</p>
  </main>
</body>
</html>
HTML
cat > "$app_source/Resources/Style.css" <<'CSS'
:root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #fff8e5; color: #182239; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 420px; min-height: 410px; display: grid; place-items: center; }
main { width: 100%; max-width: 480px; padding: 28px 36px 34px; text-align: center; }
img { object-fit: contain; margin-bottom: 10px; }
.eyebrow { margin: 0; font-size: 10px; font-weight: 750; letter-spacing: .15em; color: #53617b; }
h1 { margin: 5px 0 15px; font-size: 42px; letter-spacing: -.06em; }
p { font-size: 14px; line-height: 1.5; }
button { border: 0; border-radius: 12px; padding: 13px 19px; margin-top: 8px; color: #182239; background: #ffd456; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
button:focus-visible { outline: 3px solid #0da6ba; outline-offset: 3px; }
.note { max-width: 330px; margin: 20px auto 0; font-size: 12px; color: #53617b; }
p.state-on, p.state-off { display: none; }
body.state-on p.state-on, body.state-off p.state-off { display: block; }
body.state-on p.state-unknown, body.state-off p.state-unknown { display: none; }
@media (prefers-color-scheme: dark) { :root { background: #182239; color: #fff8e5; } .eyebrow, .note { color: #b9c8e0; } }
CSS

cat > "$app_source/Resources/Script.js" <<'JS'
function show(enabled) {
  document.body.classList.toggle('state-on', enabled === true);
  document.body.classList.toggle('state-off', enabled === false);
}
document.querySelector('.open-preferences').addEventListener('click', () => {
  window.webkit.messageHandlers.controller.postMessage('open-preferences');
});
JS

# Asset catalogs require point-size/scale pairs, not just the web extension icons.
appicon_dir="$app_source/Assets.xcassets/AppIcon.appiconset"
mkdir -p "$appicon_dir"
for size in 16 32 128 256 512; do
  for scale in 1 2; do
    pixels=$((size * scale))
    sips -z "$pixels" "$pixels" "$icon_path" --out "$appicon_dir/icon_${size}x${size}@${scale}x.png" >/dev/null
  done
done
python3 - "$appicon_dir" <<'PY'
import json
from pathlib import Path
import sys
path = Path(sys.argv[1])
images = [{'idiom': 'mac', 'size': f'{size}x{size}', 'scale': f'{scale}x', 'filename': f'icon_{size}x{size}@{scale}x.png'} for size in (16, 32, 128, 256, 512) for scale in (1, 2)]
(path / 'Contents.json').write_text(json.dumps({'images': images, 'info': {'author': 'xcode', 'version': 1}}, indent=2) + '\n')
PY

printf 'Building ozwell.app (local development signing)…\n'
xcodebuild -project "$project_dir/ozwell.xcodeproj" \
  -scheme ozwell -configuration Debug -destination 'generic/platform=macOS' \
  -derivedDataPath "$output_dir/DerivedData" \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$sign_identity" DEVELOPMENT_TEAM= \
  CODE_SIGNING_ALLOWED=YES MACOSX_DEPLOYMENT_TARGET=12.0 \
  CURRENT_PROJECT_VERSION="$build_number" build \
  >"$output_dir/build.log" 2>&1 || {
    tail -40 "$output_dir/build.log" >&2
    exit 1
  }

built_app="$output_dir/DerivedData/Build/Products/Debug/ozwell.app"
codesign --verify --deep --strict "$built_app"
codesign --verify --strict "$built_app/Contents/PlugIns/ozwell Extension.appex"
python3 - "$built_app" "$bundle_id" "$build_number" <<'PY'
import json
import plistlib
from pathlib import Path
import sys
app = Path(sys.argv[1])
expected = sys.argv[2]
build_number = sys.argv[3]
for bundle, identifier in ((app, expected), (app / 'Contents/PlugIns/ozwell Extension.appex', expected + '.Extension')):
    info = plistlib.loads((bundle / 'Contents/Info.plist').read_bytes())
    if info['CFBundleIdentifier'] != identifier or info['CFBundleDisplayName'] != 'ozwell' or info['CFBundleVersion'] != build_number:
        raise SystemExit(f'Unexpected branding, identifier, or build number in {bundle}')
resources = app / 'Contents/PlugIns/ozwell Extension.appex/Contents/Resources'
manifest = json.loads((resources / 'manifest.json').read_text())
if manifest.get('name') != 'ozwell':
    raise SystemExit('Built extension has an unexpected name')
if manifest.get('background', {}).get('type'):
    raise SystemExit('Safari worker must be bundled as a classic script')
for name in ('popup.js', 'widget-host.js', 'page-connection.js', 'page-tools.js', 'mcp-bridge.js', 'page-host.html', 'page-host.css', 'page-host.js', 'page-host-relay.js', 'vendor/page-controller.js', 'vendor/PROVENANCE.json', 'vendor/LICENSE', 'vendor/THIRD_PARTY_NOTICES.md', 'vendor/ai-motion-LICENSE', 'assets/ozwell-512.png'):
    if not (resources / name).is_file():
        raise SystemExit(f'Built app is missing a runtime resource: {name}')
PY
ditto "$built_app" "$output_dir/ozwell.app"
codesign --verify --deep --strict "$output_dir/ozwell.app"
printf '\nBuilt app: %s\nBuild number: %s\nHost identifier: %s\nExtension identifier: %s.Extension\nBuild log: %s\n' \
  "$output_dir/ozwell.app" "$build_number" "$bundle_id" "$bundle_id" "$output_dir/build.log"
printf 'Build only: install and enable this local development app through Finder and Safari.\n'
