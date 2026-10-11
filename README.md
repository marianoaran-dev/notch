# V-Notch (Tauri experiment)

The V-Notch Piggy prototype (`ui/`) running as a real, transparent, always-on-top
window on the desktop. The original prototype in `../v-notch-piggy` is untouched.

## Status: Stage 1 (window only)

- Window is placed on the **second monitor**, flush with the top edge (over any
  docked menu bar). Change with `VNOTCH_MONITOR=primary` or the `DEFAULT_MONITOR`
  constant in `src-tauri/src/main.rs`.
- Click-through everywhere except the notch, its side buttons and open panels.
  The page reports those rectangles (`ui/app-shell.js`); Rust switches the window
  between solid and click-through (`spawn_hit_tester`).
- All data is still the prototype's sample data. Settings > Quit really quits.

## Status: Stage 2 in progress (real data)

- **Codex quota (tabs 1 and 2): wired.** Rust starts `codex app-server` with its own
  account folder per tab (`%APPDATA%\au.com.aukalen.vnotch-tauri\codex\slot1`, `slot2`),
  exactly as the WPF app does, and the page shows the real 5 h / weekly / banked resets.
  These folders are separate from the WPF app's, so the two never share tokens.
- Not connected yet? The header line says so; click it to sign in. Codex shows a web
  address and a one-time code, and you enter the code in your own browser.
- **Settings screen (gear button):** a fifth in-notch screen, ported from the WPF Settings
  window but keeping only what this app uses: Piggy Bank accounts (name, sign-in browser,
  Connect / Copy code / Disconnect) and Appearance (monitor, interface size, notch opacity,
  Display shortcuts always visible). Saved to `%APPDATA%\au.com.aukalen.vnotch-tauri\settings.json`.
  Options live in `ui/settings-store.js`; the screen is `ui/settings-screen.js`.
- Claude tab, Tasks, monitor brightness/power: still sample data.

## Run (development, instant reload)

    npm install          # first time only
    cargo tauri dev

Saving a file in `ui/` updates the running notch immediately (CSS without a reload,
JavaScript with a page reload). Saving Rust code rebuilds and restarts the app.
`VNOTCH_DEBUG=1` prints hit-test info to the console.

## Build a standalone exe

    cd src-tauri
    cargo build --release

## Layout

- `ui/`        the prototype, plus `app.css` (transparent overlay layout) and
               `app-shell.js` (hit rectangles, scale, click-away collapse, Quit)
- `src-tauri/` Rust shell: window placement, click-through, commands
