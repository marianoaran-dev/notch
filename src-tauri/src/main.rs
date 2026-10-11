#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod claude;
mod codex;
mod display;
mod tasks;

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

// Which screen the notch lives on while the new app is being tested.
// "secondary" falls back to the primary screen when only one is connected.
// Override without rebuilding: set VNOTCH_MONITOR to "primary" or "secondary".
const DEFAULT_MONITOR: &str = "secondary";

// Logical size of the transparent notch window. It must be wide and tall enough
// for the widest screen (Audio) plus the side rails; empty areas are click-through.
const WINDOW_WIDTH: f64 = 1500.0;
const WINDOW_HEIGHT: f64 = 1000.0;

// Extra pixels around each interactive rectangle that still count as "inside".
const HIT_PADDING: f64 = 4.0;

// Rectangles [x, y, width, height] in CSS pixels, reported by the page.
#[derive(Default)]
struct HitRects(Arc<Mutex<Vec<[f64; 4]>>>);

#[tauri::command]
fn set_hit_rects(state: tauri::State<HitRects>, rects: Vec<[f64; 4]>) {
    if let Ok(mut current) = state.0.lock() {
        *current = rects;
    }
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

// Pixels per CSS pixel as the web content itself sees it (window.devicePixelRatio).
// On some displays this differs from the scale Windows reports for the monitor, and
// both the window size and the click-through maths must follow the web content.
static PAGE_SCALE: AtomicU64 = AtomicU64::new(0);

// ---- Codex accounts ---------------------------------------------------------------
// Slot 0 and 1 are the two Codex accounts. Each has its own folder owned by this app.

fn codex_home(app: &AppHandle, slot: u8) -> Result<PathBuf, String> {
    if slot > 1 {
        return Err("error|Unknown account slot.".into());
    }
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("codex").join(format!("slot{}", slot + 1)))
        .map_err(|e| format!("error|{e}"))
}

#[tauri::command]
async fn codex_quota(app: AppHandle, slot: u8) -> Result<codex::Reading, String> {
    let home = codex_home(&app, slot)?;
    tauri::async_runtime::spawn_blocking(move || codex::read_quota(&home))
        .await
        .map_err(|e| format!("error|{e}"))?
}

// Starts the sign-in and opens Codex's own sign-in page. The person enters the
// one-time code there themselves; nothing is typed or submitted on their behalf.
#[tauri::command]
async fn codex_login(app: AppHandle, slot: u8, browser: Option<String>) -> Result<codex::LoginPrompt, String> {
    let home = codex_home(&app, slot)?;
    let prompt = tauri::async_runtime::spawn_blocking(move || codex::start_login(&home))
        .await
        .map_err(|e| format!("error|{e}"))??;
    if codex::is_trusted_login_url(&prompt.url) {
        open_in_browser(&prompt.url, browser.as_deref().unwrap_or("Default"));
    }
    Ok(prompt)
}

// Removes the saved sign-in for this account folder (`codex logout`).
#[tauri::command]
async fn codex_logout(app: AppHandle, slot: u8) -> Result<(), String> {
    let home = codex_home(&app, slot)?;
    tauri::async_runtime::spawn_blocking(move || codex::logout(&home))
        .await
        .map_err(|e| format!("error|{e}"))?
}

// Puts a short piece of text (a one-time sign-in code) on the clipboard using the
// Windows `clip` tool, so no extra clipboard library is needed.
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    use std::io::Write;
    if text.is_empty() || text.len() > 64 || text.chars().any(|c| c.is_control()) {
        return Err("error|Nothing suitable to copy.".into());
    }
    let mut child = std::process::Command::new("clip.exe")
        .stdin(std::process::Stdio::piped())
        .creation_flags(0x0800_0000)
        .spawn()
        .map_err(|e| format!("error|{e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(text.as_bytes()).map_err(|e| format!("error|{e}"))?;
    }
    child.wait().map_err(|e| format!("error|{e}"))?;
    Ok(())
}

#[tauri::command]
async fn claude_connect(app: AppHandle) -> Result<codex::Reading, String> {
    claude::connect(app).await
}

#[tauri::command]
async fn claude_refresh(app: AppHandle) -> Result<codex::Reading, String> {
    claude::refresh(app).await
}

#[tauri::command]
async fn claude_disconnect(app: AppHandle) -> Result<(), String> {
    claude::disconnect(app).await
}

#[tauri::command]
async fn monitors_list() -> Result<Vec<display::MonitorInfo>, String> {
    tauri::async_runtime::spawn_blocking(display::list).await.map_err(|e| format!("error|{e}"))
}

#[tauri::command]
async fn monitor_set(id: String, control: String, percent: f64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || display::set(&id, &control, percent))
        .await
        .map_err(|e| format!("error|{e}"))?
}

// Only ever called by an explicit click on Off or Sleep.
#[tauri::command]
async fn monitors_off() -> bool {
    tauri::async_runtime::spawn_blocking(display::power_off).await.unwrap_or(false)
}

#[tauri::command]
fn codex_login_cancel() {
    codex::cancel_login();
}

#[tauri::command]
fn codex_login_finished() -> bool {
    codex::login_finished()
}

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// "Default" uses the system default browser. The named browsers are launched through
// the Windows App Paths registry (`start chrome ...`), and fall back to the default.
#[cfg(windows)]
fn open_in_browser(url: &str, browser: &str) {
    // A private window starts with no saved sign-ins, so a second account can be used even
    // when the same browser is already signed in as the first.
    let (program, private_flag) = match browser {
        "Chrome" => (Some("chrome"), None),
        "Chrome (private)" => (Some("chrome"), Some("--incognito")),
        "Edge" => (Some("msedge"), None),
        "Edge (private)" => (Some("msedge"), Some("--inprivate")),
        "DuckDuckGo" => (Some("DuckDuckGo"), None),
        _ => (None, None),
    };
    if let Some(program) = program {
        // The address was already checked as an https OpenAI/ChatGPT address, so it
        // holds no characters that cmd.exe treats specially.
        let mut command = std::process::Command::new("cmd.exe");
        command.args(["/d", "/c", "start", "", program]);
        if let Some(flag) = private_flag {
            command.arg(flag);
        }
        let started = command
            .arg(url)
            .creation_flags(0x0800_0000)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if started {
            return;
        }
    }
    // FileProtocolHandler takes the address as one argument, so no shell parsing is involved.
    let _ = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .creation_flags(0x0800_0000)
        .spawn();
}

#[cfg(not(windows))]
fn open_in_browser(_url: &str, _browser: &str) {}

// ---- settings file and monitor choice ---------------------------------------------

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|e| format!("error|{e}"))
}

fn read_settings(app: &AppHandle) -> serde_json::Value {
    settings_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

#[tauri::command]
fn settings_load(app: AppHandle) -> serde_json::Value {
    read_settings(&app)
}

#[tauri::command]
fn settings_save(app: AppHandle, value: serde_json::Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("error|Settings must be an object.".into());
    }
    let text = serde_json::to_string_pretty(&value).map_err(|e| format!("error|{e}"))?;
    if text.len() > 64 * 1024 {
        return Err("error|Settings are too large.".into());
    }
    let path = settings_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("error|{e}"))?;
    }
    // Write beside the file, then swap it in, so a crash never leaves half a file.
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).map_err(|e| format!("error|{e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("error|{e}"))?;
    Ok(())
}

// Which screen the notch shows on: "x,y" of the monitor's top-left corner, or none
// to use the built-in default.
static MONITOR_PREF: Mutex<Option<String>> = Mutex::new(None);

fn monitor_id(position: &PhysicalPosition<i32>) -> String {
    format!("{},{}", position.x, position.y)
}

#[derive(serde::Serialize)]
struct MonitorInfo {
    id: String,
    label: String,
    primary: bool,
}

#[tauri::command]
fn list_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    let Some(win) = app.get_webview_window("main") else { return Vec::new() };
    let primary = win.primary_monitor().ok().flatten().map(|m| *m.position());
    let monitors = win.available_monitors().unwrap_or_default();
    let mut list: Vec<(String, bool, PhysicalSize<u32>)> = monitors
        .iter()
        .map(|m| (monitor_id(m.position()), Some(*m.position()) == primary, *m.size()))
        .collect();
    list.sort_by_key(|(id, is_primary, _)| (!*is_primary, id.clone()));
    list.into_iter()
        .enumerate()
        .map(|(number, (id, primary, size))| MonitorInfo {
            label: format!(
                "Monitor {}{} · {}×{}",
                number + 1,
                if primary { " (primary)" } else { "" },
                size.width,
                size.height
            ),
            id,
            primary,
        })
        .collect()
}

#[tauri::command]
fn set_monitor(app: AppHandle, id: Option<String>) {
    if let Ok(mut pref) = MONITOR_PREF.lock() {
        *pref = id.filter(|v| !v.is_empty());
    }
    if let Some(win) = app.get_webview_window("main") {
        let _ = place_on_monitor(&win);
    }
}

// Where the window is supposed to be (physical x, y, width, height). Something on
// the system (a docked menu bar, or Windows itself) can push the window down into
// the work area after it is activated, so the hit tester keeps putting it back.
static TARGET: Mutex<Option<(i32, i32, i32, i32)>> = Mutex::new(None);

fn page_scale(fallback: f64) -> f64 {
    let stored = f64::from_bits(PAGE_SCALE.load(Ordering::Relaxed));
    if stored >= 0.5 { stored } else { fallback }
}

#[tauri::command]
fn set_page_scale(app: tauri::AppHandle, scale: f64) {
    if !(0.5..=6.0).contains(&scale) {
        return;
    }
    let previous = f64::from_bits(PAGE_SCALE.swap(scale.to_bits(), Ordering::Relaxed));
    if (previous - scale).abs() > 0.001 {
        if let Some(win) = app.get_webview_window("main") {
            let _ = place_on_monitor(&win);
        }
    }
}

fn place_on_monitor(win: &WebviewWindow) -> tauri::Result<()> {
    let choice = std::env::var("VNOTCH_MONITOR").unwrap_or_else(|_| DEFAULT_MONITOR.to_string());
    let monitors = win.available_monitors()?;
    let primary = win.primary_monitor()?;
    let primary_pos = primary.as_ref().map(|m| *m.position());

    let saved = MONITOR_PREF.lock().ok().and_then(|p| p.clone());
    let chosen = saved.and_then(|id| monitors.iter().find(|m| monitor_id(m.position()) == id).cloned());

    let target = if chosen.is_some() {
        chosen
    } else if choice.eq_ignore_ascii_case("primary") {
        primary.clone()
    } else {
        monitors
            .iter()
            .find(|m| Some(*m.position()) != primary_pos)
            .cloned()
            .or(primary.clone())
    };

    if let Some(monitor) = target {
        // Work in physical pixels of the target screen so a DPI change after the
        // move cannot resize or nudge the window.
        let scale = page_scale(monitor.scale_factor());
        let width = (WINDOW_WIDTH * scale).round() as i32;
        let height = (WINDOW_HEIGHT * scale).round() as i32;
        let x = monitor.position().x + (monitor.size().width as i32 - width) / 2;
        let y = monitor.position().y; // the very top edge, over any reserved menu bar
        win.set_size(PhysicalSize::new(width as u32, height as u32))?;
        win.set_position(PhysicalPosition::new(x, y))?;
        pin_to_top(win, x, y, width, height);
        if let Ok(mut target) = TARGET.lock() {
            *target = Some((x, y, width, height));
        }
    }
    // WebView2 remembers a page zoom between runs; the overlay must always be 100%.
    win.set_zoom(1.0)?;
    Ok(())
}

// Windows keeps ordinary windows out of areas reserved by a docked menu bar.
// SetWindowPos with HWND_TOPMOST puts the notch exactly where we ask, above it.
#[cfg(windows)]
fn pin_to_top(win: &WebviewWindow, x: i32, y: i32, width: i32, height: i32) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    };
    if let Ok(handle) = win.hwnd() {
        // Rebuild the handle from its raw value so it does not matter which
        // version of the windows crate Tauri itself was built with.
        let hwnd = HWND(handle.0 as *mut _);
        unsafe {
            let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }
}

#[cfg(not(windows))]
fn pin_to_top(_win: &WebviewWindow, _x: i32, _y: i32, _width: i32, _height: i32) {}

#[cfg(windows)]
fn left_button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

#[cfg(not(windows))]
fn left_button_down() -> bool {
    false
}

// Keeps the notch above other always-on-top windows, such as a menu bar from a dock utility.
// Those can climb over it when something reshuffles the stacking order (a screenshot overlay
// opening and closing, say), which hides the notch behind their blur and swallows its clicks.
// Returns true when it had to put the notch back on top.
#[cfg(windows)]
fn ensure_on_top(win: &WebviewWindow) -> bool {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, GetWindowLongW, GetWindowRect, IsWindowVisible, SetWindowPos, GWL_EXSTYLE,
        GW_HWNDPREV, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_EX_TOPMOST,
    };
    let Ok(handle) = win.hwnd() else { return false };
    let me = HWND(handle.0 as *mut _);
    let topmost = WS_EX_TOPMOST.0;
    unsafe {
        let mut must_raise = (GetWindowLongW(me, GWL_EXSTYLE) as u32 & topmost) == 0;
        if !must_raise {
            let mut mine = RECT::default();
            if GetWindowRect(me, &mut mine).is_ok() {
                // Only the strip at the top of the window matters: that is where the notch lives.
                let strip_bottom = mine.top + 260;
                let mut above = GetWindow(me, GW_HWNDPREV).unwrap_or_default();
                let mut steps = 0;
                while !above.0.is_null() && steps < 300 {
                    if IsWindowVisible(above).as_bool() && (GetWindowLongW(above, GWL_EXSTYLE) as u32 & topmost) != 0 {
                        let mut other = RECT::default();
                        if GetWindowRect(above, &mut other).is_ok()
                            && other.right > other.left
                            && other.bottom > other.top
                            && other.left < mine.right
                            && other.right > mine.left
                            && other.top < strip_bottom
                            && other.bottom > mine.top
                        {
                            must_raise = true;
                            break;
                        }
                    }
                    above = GetWindow(above, GW_HWNDPREV).unwrap_or_default();
                    steps += 1;
                }
            }
        }
        if must_raise {
            // Same z-order only: no move, no resize, and the notch never takes focus.
            let _ = SetWindowPos(me, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        must_raise
    }
}

#[cfg(not(windows))]
fn ensure_on_top(_win: &WebviewWindow) -> bool {
    false
}

// The window is transparent and much larger than the notch. Clicks must pass
// through to other apps everywhere except over the notch and its buttons, so this
// watches the pointer and switches the window between "solid" and "click-through".
fn spawn_hit_tester(win: WebviewWindow, rects: Arc<Mutex<Vec<[f64; 4]>>>) {
    std::thread::spawn(move || {
        let mut ignoring = true;
        let debug = std::env::var("VNOTCH_DEBUG").is_ok();
        let mut last_log = std::time::Instant::now();
        let mut last_guard = std::time::Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(12));

            if last_guard.elapsed() > Duration::from_millis(150) {
                last_guard = std::time::Instant::now();
                let target = TARGET.lock().ok().and_then(|t| *t);
                if let (Some((tx, ty, tw, th)), Ok(pos)) = (target, win.outer_position()) {
                    if pos.x != tx || pos.y != ty {
                        pin_to_top(&win, tx, ty, tw, th);
                    }
                }
                if ensure_on_top(&win) && debug {
                    println!("notch was covered by another always-on-top window; raised it");
                }
            }
            let (Ok(cursor), Ok(origin), Ok(window_scale)) =
                (win.cursor_position(), win.inner_position(), win.scale_factor())
            else {
                continue;
            };
            let scale = page_scale(window_scale);
            let x = (cursor.x - origin.x as f64) / scale;
            let y = (cursor.y - origin.y as f64) / scale;

            let inside = rects.lock().map_or(false, |list| {
                list.iter().any(|r| {
                    x >= r[0] - HIT_PADDING
                        && x <= r[0] + r[2] + HIT_PADDING
                        && y >= r[1] - HIT_PADDING
                        && y <= r[1] + r[3] + HIT_PADDING
                })
            });

            if debug && last_log.elapsed() > Duration::from_millis(700) {
                last_log = std::time::Instant::now();
                let count = rects.lock().map_or(0, |l| l.len());
                println!("cursor css=({x:.0},{y:.0}) rects={count} inside={inside} ignoring={ignoring} scale={scale}");
            }

            // A drag that started inside (a slider, say) keeps the window solid
            // even if the pointer wanders outside the rectangles.
            let hold = left_button_down() && !ignoring;
            let want_ignore = !(inside || hold);
            if want_ignore != ignoring && win.set_ignore_cursor_events(want_ignore).is_ok() {
                ignoring = want_ignore;
            }
        }
    });
}

fn main() {
    let rects = HitRects::default();
    let shared = rects.0.clone();

    let mut builder = tauri::Builder::default();

    // Only one notch at a time. Starting a second copy hands over to the first one, which
    // snaps back to its place at the top of the screen, and the second copy quits at once.
    // (Set VNOTCH_ALLOW_MULTIPLE=1 to turn this off, e.g. for a development copy beside the real one.)
    if std::env::var_os("VNOTCH_ALLOW_MULTIPLE").is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = place_on_monitor(&win);
            }
        }));
    }

    builder
        .manage(rects)
        .invoke_handler(tauri::generate_handler![
            set_hit_rects,
            set_page_scale,
            quit,
            codex_quota,
            codex_login,
            codex_login_cancel,
            copy_text,
            codex_logout,
            monitors_list,
            monitor_set,
            monitors_off,
            tasks::tasks_load,
            tasks::tasks_save,
            tasks::tasks_import_old,
            claude_connect,
            claude_refresh,
            claude_disconnect,
            settings_load,
            settings_save,
            list_monitors,
            set_monitor,
            codex_login_finished
        ])
        .setup(move |app| {
            let win = app
                .get_webview_window("main")
                .expect("main window is declared in tauri.conf.json");
            if let Some(id) = read_settings(app.handle()).get("monitor").and_then(|v| v.as_str()) {
                if let Ok(mut pref) = MONITOR_PREF.lock() {
                    *pref = Some(id.to_owned()).filter(|v| !v.is_empty());
                }
            }
            win.set_ignore_cursor_events(true)?;
            // Show first, then move: a window moved while hidden never tells its web
            // content that the new screen has a different scale.
            win.show()?;
            place_on_monitor(&win)?;
            // The move triggers a DPI change on a screen with a different scale;
            // place it again once that has settled.
            let again = win.clone();
            std::thread::spawn(move || {
                for delay in [250u64, 750, 2000] {
                    std::thread::sleep(Duration::from_millis(delay));
                    let _ = place_on_monitor(&again);
                }
            });
            spawn_hit_tester(win, shared.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running V-Notch");
}
