The ozwell mascot images are copied or resized from
[`docs/static/img/ozwell.png`](../../docs/static/img/ozwell.png) in this repository.
The 512px image is unchanged; the smaller PNGs use Lanczos resampling. Original
artwork and repository licensing are preserved. No new artwork is generated.

| File | Use |
| --- | --- |
| `ozwell-16.png`, `ozwell-32.png`, `ozwell-48.png`, `ozwell-128.png` | Browser extension icons and toolbar branding |
| `ozwell-128.png` | Toolbar chat branding |
| `ozwell-48.png` | Page launcher mascot, exposed by the manifest |
| `ozwell-512.png` | Source for the native Safari app icon and setup window |

The [Safari packaging script](../scripts/package-safari.sh) copies every runtime
asset into its generated app and derives the native macOS icon sizes from the
512px source. The generated app does not reference the checkout at runtime.
