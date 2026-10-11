# Settings and data

## Where things are stored

Everything lives under `%APPDATA%\au.com.aukalen.vnotch-tauri`
(usually `C:\Users\<you>\AppData\Roaming\au.com.aukalen.vnotch-tauri`).

| Path | Contents | Sensitive? |
| --- | --- | --- |
| `settings.json` | All the settings below | No |
| `tasks.json` | Your tasks | Personal |
| `codex\slot1\`, `codex\slot2\` | One Codex home per account, including `auth.json` | **Yes: login tokens** |
| `claude\browser\` | The Claude sign-in browser profile (cookies) | **Yes: login session** |
| `claude\connected` | Marker that Claude was connected | No |

Nothing in this folder is part of the repository, and `.gitignore` blocks `settings.json`,
`tasks.json`, `auth.json`, `session.json` and similar files so they cannot be committed by
accident. **Never share the `codex` or `claude` folders.**

To reset the notch completely, close it and delete the folder. To sign an account out, use
**Disconnect** in Settings > Accounts, which removes that account's login.

## Settings

The Settings screen writes `settings.json`. Values are checked on load; anything out of
range is brought back into range, and an unreadable file falls back to defaults.

### Appearance

| Setting | Range / values | Default | Meaning |
| --- | --- | --- | --- |
| `uiScale` | 80 to 130 (%) | 100 | Size of the whole notch interface |
| `compactHeight` | 35 to 70 (px) | 60 | Height of the small notch, independent of `uiScale` |
| `notchOpacity` | 50 to 100 (%) | 100 | Opacity of the black notch body |
| `displayAlwaysOpen` | true / false | true | Keep Day / Night / Off visible beside Display |
| `monitor` | `"x,y"` or empty | empty | Position of the monitor to show on; empty uses the default |

### Accounts

| Setting | Values | Default | Meaning |
| --- | --- | --- | --- |
| `names` | three names, up to 24 characters | `Mariano`, `OzNano`, `Claude` | Labels for the three accounts (change them in Settings) |
| `accountsEnabled` | three true / false | all true | Show each account in Piggy Bank and the small notch. At least one stays on. |
| `browsers` | one per account | `Chrome`, `Edge`, `Default` | Browser used for the sign-in page |

Browser choices: `Default`, `Chrome`, `Chrome (private)`, `Edge`, `Edge (private)`,
`DuckDuckGo`. One browser profile can only be signed in to one account at a time, which is why
the two Codex accounts default to different browsers.

### Behavior

| Setting | Values | Default | Meaning |
| --- | --- | --- | --- |
| `collapseOnClickAway` | true / false | true | Collapse the notch when you click another app |

### Tasks

| Setting | Range | Default | Meaning |
| --- | --- | --- | --- |
| `tasksWidth` | 420 to 1000 (px) | 650 | Width of the open Tasks screen (corner grip) |
| `tasksListHeight` | 120 to 560 (px) | 340 | Tallest the list grows before it scrolls |
| `tasksListMin` | 0 or 75 to 560 (px) | 0 | Shortest the list may be (0 fits the tasks); set by dragging the handle |
| `tasksScroll` | 0 and up | 0 | Where the list was scrolled when last left |
| `tasksCompletedOpen` | true / false | false | Whether the Completed section was open |

### Display

| Setting | Meaning |
| --- | --- |
| `displayPresets` | Day, Night and Custom 1-3: a name plus brightness and contrast (0 to 100) for each monitor |
| `displayLinked` | Monitors whose brightness and contrast move together |

## Importing tasks from the older V-Notch app

The first time Tasks loads and no `tasks.json` exists, the notch automatically copies the
tasks from the older WPF app's `%APPDATA%\V-Notch\tasks.json` and saves them as its own. That
file is only read, never changed. If you never used the older app, nothing happens.

## Environment variables

| Variable | Effect |
| --- | --- |
| `VNOTCH_MONITOR=primary` | Default to the primary monitor when none is chosen in Settings |
| `VNOTCH_ALLOW_MULTIPLE=1` | Allow more than one copy to run |
| `VNOTCH_DEBUG=1` | Print hit-testing and stacking-order information |
| `VNOTCH_CLAUDE_DEBUG=1` | Print the sites visited by the Claude sign-in (address and path only) |
