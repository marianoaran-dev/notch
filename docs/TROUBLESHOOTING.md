# Troubleshooting

## The notch looks blurry or stops responding

Almost always this means **another always-on-top window has slipped above the notch**. A
frosted-glass dock bar (such as a menu bar replacement) blurs whatever is underneath it and
swallows the clicks. The notch checks its stacking order every 150 ms and raises itself back,
so it should recover within a fraction of a second. If it does not:

- Make sure you are running a current build (`cargo tauri build --no-bundle`).
- Run with `VNOTCH_DEBUG=1` from a terminal. When the notch had to climb back on top it
  prints "notch was covered by another always-on-top window; raised it".
- Taking a screenshot can trigger the reshuffle on some systems, which is why the problem
  can seem to start after one.

## Nothing appears, or it is on the wrong monitor

- The notch opens on the **secondary** monitor by default. With one monitor it uses the
  primary. Pick another in Settings > Appearance, or set `VNOTCH_MONITOR=primary`.
- Only one copy can run. Starting it again re-shows and re-places the running one. Look for
  `v-notch-tauri.exe` in Task Manager.
- The window is blank: you probably built with plain `cargo build --release`. Rebuild with
  `cargo tauri build --no-bundle`.

## A Codex account will not connect

- Check `codex --version` works in a normal terminal. The notch looks for `codex` on your
  `PATH`.
- Press **Connect**, open the shown address in a browser that is signed in to the *right*
  OpenAI account, and enter the code. Use **Copy code** to avoid typing it.
- A browser profile can only be signed in to one account. If both accounts open in the same
  browser, choose different browsers (or a private window) for each in Settings > Accounts.
- Use **Disconnect** and connect again to start from a clean login.

## Claude shows an error or no numbers

- Press **Connect** and sign in to claude.ai in the window that opens. Close it when it
  says you are connected.
- Quotas come from an unofficial claude.ai endpoint, so they can break if the site changes.
  Run with `VNOTCH_CLAUDE_DEBUG=1` to see which pages the sign-in visits.
- To start over, **Disconnect** and connect again.

## A plan shows 100% with weekly 0%

Some plans (for example a free plan) report a single usage window instead of a 5-hour and a
weekly one. The notch currently shows that single window as the 5-hour figure.

## Display controls do nothing

- Turn **DDC/CI** on in the monitor's own on-screen menu. It is often off by default.
- Use the monitor's real video cable. Some docks, adapters and KVM switches block DDC/CI.
- Laptop panels usually do not support DDC/CI.
- Controls are rate limited on purpose (35 ms between writes). Dragging a slider very quickly
  may feel slightly behind the monitor.
- Monitors you turn off from the notch wake when you move the mouse or press a key.

## Part of the notch cannot be clicked

The window is click-through except over rectangles the page reports. If an icon looks dead,
check for a CSS `pointer-events: none` rule covering it, and confirm that its container is
included when `app-shell.js` measures the hit rectangles. See
[ARCHITECTURE.md](ARCHITECTURE.md#click-through).

## My settings or tasks disappeared

- They are stored in `%APPDATA%\au.com.aukalen.vnotch-tauri`. Check that folder first.
- If the app was started from a sandboxed host, Windows may have redirected `%APPDATA%` to a
  private copy for that process. Start the exe from Explorer or a normal terminal instead.
- A damaged `settings.json` is replaced by defaults when it cannot be read.

## Where to look for output

Start the exe from a terminal with `VNOTCH_DEBUG=1` to see messages. In development,
`cargo tauri dev` prints Rust output in the terminal and the page's console is available
through the WebView developer tools.
