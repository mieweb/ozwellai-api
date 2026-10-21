# ozwell preview

[Watch the 30-second install and activation walkthrough](./ozwell-install-activation.mp4).
The recording shows Chrome installation, enabling, and activation using the local preview. Authentication
is demonstrated with test responses; the typed draft is not sent to a live model.
The edited screen recording skips the folder chooser and pauses between actions.
Safari installation is covered in the [packaging instructions](../scripts/README.md).

The screenshots below come from a loaded Chromium extension using the actual
locally built widget. Network routes provide demonstration authentication and an
invented test key. They show the implemented interface, rather than deployed
sign-in or chat. The public widget server still requires the
[deployment updates](../README.md#widget-deployment).

| Toolbar chat | Widget sign-in |
| --- | --- |
| ![ozwell toolbar chat with an unsent draft](./screenshots/toolbar-chat.png) | ![Widget-owned email sign-in in the toolbar popup](./screenshots/toolbar-sign-in.png) |

Opening the toolbar brings up the widget directly. Once authenticated, the
composer receives focus; the extension never stores the sign-in credential.

| Power off | Page settings |
| --- | --- |
| ![ozwell turned off with its mascot and direct on button](./screenshots/toolbar-off.png) | ![Selected sites, exact domains, and page launcher controls](./screenshots/toolbar-page-settings.png) |

The power button applies immediately and remembers the previous page mode.
**Page settings** contains On demand, Selected sites, and All sites controls;
**Save settings** applies page behavior and requests required permissions.

| Page launcher | Page widget |
| --- | --- |
| ![Branded ozwell launcher at the bottom right of the test page](./screenshots/page-launcher.png) | ![The expanded page widget with its sign-in screen](./screenshots/page-chat.png) |

The floating launcher remains optional. These page screenshots use a local fixture
at `ui.mieweb.org`; the extension does not read or send its page content.
