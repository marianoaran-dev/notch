# Changelog

## Unreleased

### Added
- Live Piggy Bank quotas for two Codex accounts and Claude, with banked resets.
- Sign-in for Codex (device code with Copy button, per-account browser) and Claude
  (private sign-in window).
- Settings screen with a vertical menu: Accounts, Appearance, Behavior.
- Appearance card that floats beside the notch so changes can be seen live: interface size
  (80-130%), small-notch height (35-70 px), notch opacity, Display shortcuts, monitor choice.
- Accounts can be switched on or off; hidden accounts disappear from Piggy Bank and the small notch.
- Tasks that persist, expand downward with a designed rim handle, remember their size and
  scroll position, and close from the black area at the top. One-time import from the older app.
- Display: real brightness and contrast over DDC/CI, Day / Night / Custom presets, linked
  monitors, and monitor power off. Sub-icons are always clickable.
- Only one copy of the notch runs at a time.
- The notch keeps itself above other always-on-top windows (such as a frosted dock bar).
- Documentation: README, architecture, settings and data, troubleshooting.

### Fixed
- Banked resets are centred and spaced evenly; all accounts get a window height that fits.
- Left-hand Display icons not responding (a hover rule disabled pointer events).
- Blurry text caused by transform scaling; the interface now scales with CSS `zoom`.
- Notch appearing blurred or unresponsive after something reshuffled the stacking order.

### Not done yet
- Alerts, Start with Windows, drag-to-reorder tasks, remaining Behavior options.

## 0.1.0-preview.1

First public preview: transparent always-on-top notch window with the prototype interface.
