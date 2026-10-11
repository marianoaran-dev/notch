# V-Notch, Tauri edition (preview)

A compact Windows desktop notch with animated controls, account quota displays, tasks and display utilities. This is a newer, simplified implementation using **Tauri 2, Rust, HTML, CSS and JavaScript**, separate from the older WPF version.

**Status: early preview (0.1.0).** Some interactions and external-service integrations remain experimental. The application is supplied as-is and is not digitally signed.

## Features

- Animated notch-style desktop interface and compact overlays
- Two individually connectable Codex account quota panels
- Optional Claude usage panel using an isolated sign-in WebView
- Task list, stored locally, with optional one-time import from older V-Notch
- Display controls and presets, depending on monitor hardware support
- Appearance settings for size, monitor selection and notch opacity

The user interface may display placeholder content when opened directly in a browser. Live usage and system integrations require the Tauri desktop application. Some external quota integrations rely on undocumented service behaviour and may stop working when services change.

## Download for Windows

See [Releases](https://github.com/marianoaran-dev/notch/releases) for any available **Windows preview executable**. No installer or code-signing certificate is included. Microsoft Edge WebView2 must be available (it is normally included on current Windows installations). Windows may warn about an unsigned download; only run software you trust.

The executable runs on Windows 10 or 11 (64-bit) and may need an installed Codex CLI for account integration. This preview has not undergone broad hardware or accessibility testing.

## Build from source

On Windows, install Rust with the MSVC toolchain, the required Windows C++ build tools, WebView2 and Tauri 2 prerequisites. The source tree includes a Rust lockfile.

Build the release executable in a terminal:

    cd src-tauri
    cargo build --release

The output is under src-tauri/target/release/v-notch-tauri.exe.

For live interface development, install Node.js and the Tauri CLI, then run from the project root:

    npm ci
    cargo tauri dev

The web interface is in ui/; the Windows integration layer is in src-tauri/src/.

## Privacy and account connections

Settings, accounts and tasks are stored in local app-specific folders. The application does not ship account tokens or personal settings. The Codex integration can start codex app-server in isolated account directories; the Claude integration uses a dedicated application-controlled WebView to obtain usage data from your signed-in session.

Use your own accounts and follow the terms of the connected services. Do not publish your app-data folder, browser profiles, logs or credentials.

## Credits and licences

This project grew out of V-Notch development and its Piggy Bank interface. The original [V-Notch project](https://github.com/rainaku/V-Notch) is credited here, with its Apache 2.0 licence reproduced in [LICENSE](LICENSE).

The animation techniques adapt work from [Codenotch by Vinz](https://github.com/vinzdg/codenotch), used under MIT terms. Lucide icons use ISC and related notices. See [third-party notices](ui/THIRD_PARTY_NOTICES.md) and [Lucide licence](ui/LICENSE-LUCIDE.txt).

Not affiliated with Apple, Microsoft, OpenAI, Anthropic or the original projects. This project is an independent preview.