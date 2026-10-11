# Notch

A small, always-on-top "notch" that sits at the top edge of one of your monitors
and keeps three things within reach:

- **Piggy Bank**: live usage quotas for two Codex accounts and one Claude account
  (5-hour window, weekly window, and banked resets).
- **Tasks**: a quick to-do list that remembers its size, position in the list and contents.
- **Display**: real brightness and contrast for each monitor, one-click Day / Night
  presets, and a button that turns the monitors off.

It is a Windows app built with [Tauri 2](https://tauri.app) (Rust) and a plain
HTML/CSS/JavaScript interface, with smooth liquid animations adapted from
[Codenotch](https://github.com/vinzdg/codenotch) (see [Credits](#credits)).

> **Status: preview.** It is a personal tool that is usable day to day, but it is not a
> finished product. See [Not done yet](#not-done-yet). This project is not affiliated
> with or endorsed by OpenAI or Anthropic.

## What you get

| Area | What it does |
| --- | --- |
| **Notch** | Transparent window placed flush with the top edge of your chosen monitor, over any docked menu bar. Everything outside the notch and its open panels is click-through. Collapses when you click another app (optional). |
| **Piggy Bank** | Three accounts: two Codex accounts and Claude. Shows the 5-hour and weekly quota, and banked resets. Each account can be switched on or off, and renamed. |
| **Codex sign-in** | Starts `codex login --device-auth`, shows the web address and one-time code (with a Copy button), and opens a browser of your choice. Each account has its own Codex data folder, so two accounts never share tokens. |
| **Claude sign-in** | Opens a private sign-in window with its own browser profile and reads your usage from claude.ai. |
| **Tasks** | Add, tick off, edit and remove tasks. Drag the rim handle to make the list taller, and the corner grip to make it wider. Click the black area at the top to close it. |
| **Display** | Brightness and contrast per monitor through DDC/CI, presets (Day, Night, Custom 1-3), linking monitors so they move together, and monitor power off. |
| **Settings** | A full screen inside the notch with a vertical menu: Accounts, Appearance, Behavior. Appearance opens as a floating card so you can watch changes live. |
| **Housekeeping** | Only one copy runs at a time. The notch keeps itself above other always-on-top windows, such as a frosted dock bar. |

## Requirements

- Windows 10 or 11 (64-bit) with the **WebView2 runtime** (already included in Windows 11).
- For the **Codex** accounts: the [Codex CLI](https://github.com/openai/codex) installed and
  available on your `PATH` (`codex --version` should work).
- For **Display** controls: a monitor with **DDC/CI** switched on. Most external monitors
  support it; many laptop panels do not.
- A second monitor is recommended. The notch opens on the secondary monitor by default and
  falls back to the primary monitor if there is only one.

To build it yourself you also need:

- [Rust](https://rustup.rs) (stable) with the MSVC toolchain, which needs the Visual Studio
  Build Tools "Desktop development with C++" workload.
- [Node.js](https://nodejs.org) (current LTS or newer).
- The Tauri CLI: `cargo install tauri-cli --version "^2"`.

## Build and run

Standalone exe (what you normally want):

```bash
npm install                  # first time only
cargo tauri build --no-bundle
```

The result is `src-tauri/target/release/v-notch-tauri.exe`. Double-click it to run.
It does not need Node or Rust at runtime.

> **Do not use plain `cargo build --release`.** That builds the Rust shell without embedding
> the interface, and the notch comes up blank. `cargo tauri build --no-bundle` embeds `ui/`.

Development with instant reload:

```bash
npm install                  # first time only
cargo tauri dev
```

Saving a file in `ui/` updates the running notch straight away (CSS without a reload,
JavaScript with a page reload). Saving Rust code rebuilds and restarts the app. If a copy of
the notch is already running, start the dev copy with `VNOTCH_ALLOW_MULTIPLE=1`.

The first build downloads and compiles the Rust dependencies and takes a few minutes.
Later builds are much faster.

## First run

1. The notch appears at the top of your secondary monitor. Click it to open Piggy Bank.
2. Open **Settings** (the gear) > **Accounts**. For each Codex account choose a sign-in
   browser, press **Connect**, then open the shown web address and enter the code
   (**Copy code** puts it on your clipboard).
3. For Claude, press **Connect** and sign in to claude.ai in the window that opens.
4. Use **Appearance** to pick the monitor, interface size and the height of the small notch.

Your settings, tasks and sign-ins are stored per user in
`%APPDATA%\au.com.aukalen.vnotch-tauri`. See [docs/SETTINGS-AND-DATA.md](docs/SETTINGS-AND-DATA.md).

## Configuration

Everything day to day is in the Settings screen. A few environment variables help when
developing or debugging:

| Variable | Effect |
| --- | --- |
| `VNOTCH_MONITOR=primary` | Show on the primary monitor when no monitor has been chosen in Settings. |
| `VNOTCH_ALLOW_MULTIPLE=1` | Allow a second copy to run (for example `cargo tauri dev` beside the real one). |
| `VNOTCH_DEBUG=1` | Print hit-testing and stacking-order information to the console. |
| `VNOTCH_CLAUDE_DEBUG=1` | Print the sites (address and path only) the Claude sign-in visits. |

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the window, click-through, scaling and data flow work.
- [docs/SETTINGS-AND-DATA.md](docs/SETTINGS-AND-DATA.md): every setting, where data lives, and what is sensitive.
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): blurry or unresponsive notch, sign-in problems, display controls.
- [CHANGELOG.md](CHANGELOG.md): what changed and when.

## Project layout

```text
ui/            The interface (HTML, CSS, JavaScript)
  index.html                   page and screens
  codenotch-integration.js     notch shapes, screens, tasks, Piggy logic
  codenotch-motion.js          spring and liquid animation helpers
  app.css, settings.css        overlay layout and Settings styling
  app-shell.js                 hit rectangles, page scale, click-away collapse, Quit
  settings-store.js            settings defaults, validation, saving
  settings-screen.js           Settings menu, pages and Appearance card
  live-data.js                 Codex and Claude quota data
  display-live.js              Display screen wired to the monitors
  tasks-store.js, tasks-ui.js  Tasks storage and interface
src-tauri/     The Rust shell
  src/main.rs                  window, click-through, stacking order, commands
  src/codex.rs                 Codex app-server and sign-in
  src/claude.rs                Claude sign-in window and usage reader
  src/display.rs               DDC/CI brightness, contrast and monitor power
  src/tasks.rs                 Tasks file, and one-time import from the old app
docs/          Documentation
```

## Not done yet

- **Alerts** (for example "tell me when a quota is nearly used"). Planned as a fresh design.
- **Start with Windows.** For now, start the exe yourself or add a shortcut to your Startup folder.
- Dragging tasks to reorder them.
- Some Behavior options from the earlier app, such as expand-on-hover.
- A free plan that reports a single usage window is shown as 100% with weekly 0%.
- Windows only. There is no macOS or Linux build.

## Credits

- Motion and liquid-merge techniques adapted from [Codenotch](https://github.com/vinzdg/codenotch)
  by Vinz (MIT licence).
- Icons from [Lucide](https://lucide.dev) (ISC licence).
- Full notices are in [ui/THIRD_PARTY_NOTICES.md](ui/THIRD_PARTY_NOTICES.md) and
  [ui/LICENSE-LUCIDE.txt](ui/LICENSE-LUCIDE.txt).

## Licence

Apache License 2.0. See [LICENSE](LICENSE). Third-party components keep their own licences, as
listed above.
