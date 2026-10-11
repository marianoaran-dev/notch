# Architecture

How the notch works, for anyone changing it. For setup and usage see the [README](../README.md).

## Overview

```text
 ┌────────────────────────────── one Tauri process ──────────────────────────────┐
 │  Rust shell (src-tauri/src)                       WebView2 page (ui/)          │
 │  ───────────────────────────                      ──────────────────────────   │
 │  main.rs   window, click-through, stacking   ◄──► app-shell.js  hit rectangles │
 │  codex.rs  codex app-server (per account)    ◄──► live-data.js  quotas         │
 │  claude.rs private sign-in window, usage     ◄──► live-data.js  quotas         │
 │  display.rs DDC/CI brightness, power         ◄──► display-live.js              │
 │  tasks.rs  tasks.json                        ◄──► tasks-store.js               │
 │  settings  settings.json                     ◄──► settings-store.js            │
 └────────────────────────────────────────────────────────────────────────────────┘
```

The page talks to Rust with Tauri commands (`window.__TAURI__.core.invoke`). The interface is
plain JavaScript with no framework and no bundler; Vite is only used as a dev server for
live reload (`npm run dev:ui`, port 1430). The production build embeds the `ui/` folder.

## The window

The notch is **one large transparent window** (1500 x 1000 logical pixels) placed flush with
the top edge of the chosen monitor, centred horizontally. It has no frame, no taskbar button
and no shadow, and is always on top. The visible notch is only a small part of it.

`place_on_monitor` chooses the monitor in this order: the monitor saved in Settings, then the
primary monitor if `VNOTCH_MONITOR=primary`, then the first non-primary monitor, then the
primary. It works in **physical pixels** of the target screen so a DPI change after a move
cannot resize or nudge the window, and it re-places the window if Windows shifts it (for
example by the work area of a docked menu bar).

### Click-through

A transparent window would block clicks on everything beneath it, so the window is
click-through (`set_ignore_cursor_events`) except over the notch:

1. The page measures the rectangles of the notch, its side buttons and any open panels and
   reports them with `set_hit_rects` (`ui/app-shell.js` watches for layout changes).
2. A Rust thread (`spawn_hit_tester`) reads the cursor position about every 12 ms and switches
   the window between solid and click-through depending on whether the cursor is inside a
   reported rectangle.

If something is not clickable, the first thing to check is whether its rectangle is being
reported. A CSS rule that sets `pointer-events: none` on part of the interface also makes it
look dead; the Display rail had exactly that bug.

### Scaling

Windows reports a scale factor for each monitor, but the WebView can run at a different
`devicePixelRatio` (for example 1.815 against a reported 1.5). The page therefore tells Rust
its real ratio with `set_page_scale`, and both the window size and the hit-test maths use that
value.

The interface size setting and the compact notch height are applied with CSS `zoom`
(`--ui-scale` and `--compact-scale`). **Do not replace this with `transform: scale` or
`will-change`**: they rasterise text at the wrong size and the notch looks blurry.

### Staying on top

Other always-on-top windows, such as a frosted-glass dock bar, can climb above the notch when
something reshuffles the stacking order. The notch then looks blurred through the bar's
effect and stops receiving clicks. `ensure_on_top` runs every 150 ms: it walks the windows
above the notch and, if a visible topmost window overlaps the notch's top strip, calls
`SetWindowPos(HWND_TOPMOST, NOMOVE | NOSIZE | NOACTIVATE)` to put it back. It never moves,
resizes or focuses the window.

### One copy at a time

`tauri-plugin-single-instance` makes a second launch show and re-place the running notch
instead of starting another. Set `VNOTCH_ALLOW_MULTIPLE=1` to skip the plugin.

## Piggy Bank data

### Codex

`codex.rs` starts `codex app-server --listen stdio://` and speaks JSON-RPC over stdin and
stdout: `initialize`, `initialized`, `account/read`, then `account/rateLimits/read`. Each
account slot has its own `CODEX_HOME` (`codex\slot1`, `codex\slot2` under the app data
folder), so the two accounts never share a login. Signing in runs
`codex login --device-auth`, whose web address and one-time code are shown in the notch.
Standard input must be written without a byte-order mark.

### Claude

`claude.rs` opens a normal WebView window with its **own data directory** (`claude\browser`)
for the sign-in, so cookies persist between runs but stay separate from everything else.
An injected script reads `/api/organizations/{org}/usage` from claude.ai and passes the result
back through a private navigation channel (a fake `https://vnotch-report.invalid/...` address
that `on_navigation` intercepts). This is not an official API and can change without notice.

## Display

`display.rs` uses the Windows monitor configuration API (`dxva2`) for DDC/CI: it lists the
physical monitors behind each display and reads or writes VCP code `0x10` (brightness) and
`0x12` (contrast). Writes are queued, spaced at least 35 ms apart, and retried once, because
many monitors drop commands sent too quickly. Turning monitors off sends
`SC_MONITORPOWER` to the system.

## Persistence

Rust owns all files (see [SETTINGS-AND-DATA.md](SETTINGS-AND-DATA.md)). The page asks for
them with `settings_load`, `tasks_load` and so on, and saves with a short debounce.
`settings-store.js` validates every value on load, so a damaged or hand-edited
`settings.json` falls back to defaults rather than breaking the notch. In a plain browser
preview (no Tauri) the same stores fall back to `localStorage`.

## Commands exposed to the page

| Area | Commands |
| --- | --- |
| Window | `set_hit_rects`, `set_page_scale`, `set_monitor`, `list_monitors`, `quit` |
| Settings and tasks | `settings_load`, `settings_save`, `tasks_load`, `tasks_save`, `tasks_import_old` |
| Codex | `codex_quota`, `codex_login`, `codex_login_cancel`, `codex_login_finished`, `codex_logout` |
| Claude | `claude_connect`, `claude_refresh`, `claude_disconnect` |
| Display | `monitors_list`, `monitor_set`, `monitors_off` |
| Utility | `copy_text` |

## Interface notes

- The interface began as a browser prototype of the notch. The animation logic and screens are
  in `codenotch-integration.js`, which exposes a small `window.PiggyData` object
  (`update`, `selected`, `select`, `open`, `collapse`, `expand`, `reshape`, `syncDisplay`,
  `tasks`) that the other scripts use to feed it real data.
- Script order in `index.html` matters: options, motion, integration, then the settings,
  tasks, live-data, settings-screen, display-live and app-shell scripts.
- The Tasks panel sits above the notch body in stacking order; its resize handles need a
  higher `z-index` than the panel or they cannot be grabbed.

## Building and testing notes

- Build with `cargo tauri build --no-bundle`. Plain `cargo build --release` does not embed
  `ui/`.
- To inspect the running page, start the app with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and attach any Chrome
  DevTools Protocol client to `http://127.0.0.1:9222`. Restart without the variable
  afterwards, because it leaves a debugging port open.
- Apps started from a sandboxed host (for example some packaged desktop apps) can have their
  `%APPDATA%` redirected to a private copy. If your data seems to disappear, check which
  `%APPDATA%` the process really used.
- When driving the UI automatically, avoid clicking over the notch with the real mouse; it
  changes your real settings. Use browser-level events through the debugging port.
