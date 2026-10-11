// Claude account quota.
//
// Same idea as the WPF app: sign in to claude.ai inside a private browser window that only
// this app uses, then read the same usage numbers Claude's own Usage page shows. No cookies
// are imported from any other browser or app, and no prompts or conversations are read.
//
// How the numbers get back to Rust without giving claude.ai any access to this app:
// a small script runs inside the claude.ai page, fetches the usage numbers with the signed-in
// session, and "navigates" to a fake address that carries the numbers in its fragment. Rust
// watches navigations, reads that address, and cancels the navigation so the page stays put.
// The claude.ai window has no Tauri access at all.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::codex::{Reading, Window};

const USAGE_PAGE: &str = "https://claude.ai/settings/usage";
const REPORT_HOST: &str = "vnotch-report.invalid";
const WINDOW_LABEL: &str = "claude";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(600);
const REFRESH_TIMEOUT: Duration = Duration::from_secs(40);

enum Report {
    Usage { five: Option<Window>, week: Option<Window> },
    Failed(&'static str),
}

static WAITER: Mutex<Option<mpsc::Sender<Report>>> = Mutex::new(None);
static POPUPS: AtomicU32 = AtomicU32::new(0);

// Set VNOTCH_CLAUDE_DEBUG=1 to print the sites the sign-in visits (address and path only,
// never the query or fragment, which can carry one-time codes).
fn debug() -> bool {
    std::env::var("VNOTCH_CLAUDE_DEBUG").is_ok()
}
fn log_visit(kind: &str, url: &Url) {
    if debug() {
        println!("claude {kind}: {}://{}{}", url.scheme(), url.host_str().unwrap_or(""), url.path());
    }
}

const SCRIPT: &str = r#"
(() => {
 if (window.top !== window || location.hostname !== 'claude.ai' || window.__vnotchClaude) return;
 window.__vnotchClaude = true;
 const MODE = '__MODE__';
 const send = (pairs) => {
  const q = Object.entries(pairs).map(([k, v]) => k + '=' + v).join('&');
  try { location.assign('https://vnotch-report.invalid/r#' + q); } catch (e) {}
 };
 const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const get = async (path) => {
  const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
 };
 function orgFromPage() {
  for (const e of performance.getEntriesByType('resource')) {
   try {
    const u = new URL(e.name);
    const m = /^\/api\/organizations\/([^/]+)\/usage$/.exec(u.pathname);
    if (u.hostname === 'claude.ai' && m && UUID.test(m[1])) return m[1];
   } catch (e) {}
  }
  return null;
 }
 const pick = (w) => {
  if (!w || typeof w.utilization !== 'number' || typeof w.resets_at !== 'string') return null;
  const at = Math.floor(Date.parse(w.resets_at) / 1000);
  return Number.isFinite(at) ? { u: Math.min(100, Math.max(0, w.utilization)), at } : null;
 };
 let done = false, attempts = 0, authFailures = 0;
 // While someone is signing in, leave claude.ai alone: no background requests on its
 // login, sign-up or OAuth pages.
 const onSignInPage = () => /^\/(login|logout|signup|magic-link|oauth|verify|api\/auth)/.test(location.pathname);
 async function tick() {
  if (done) return;
  if (MODE === 'connect' && onSignInPage()) { setTimeout(tick, 3000); return; }
  attempts++;
  try {
   const candidates = [];
   const fromPage = orgFromPage();
   if (fromPage) candidates.push(fromPage);
   const list = await get('/api/organizations');
   if (list.status === 401 || list.status === 403) authFailures++;
   if (Array.isArray(list.body)) {
    for (const o of list.body) if (o && typeof o.uuid === 'string' && UUID.test(o.uuid) && !candidates.includes(o.uuid)) candidates.push(o.uuid);
   }
   for (const org of candidates) {
    const usage = await get('/api/organizations/' + org + '/usage');
    if (usage.status === 200 && usage.body) {
     const five = pick(usage.body.five_hour), week = pick(usage.body.seven_day);
     if (five || week) {
      done = true;
      const out = { ok: 1 };
      if (five) { out.fu = five.u; out.fr = five.at; }
      if (week) { out.wu = week.u; out.wr = week.at; }
      send(out);
      return;
     }
    }
   }
  } catch (e) {}
  if (MODE === 'refresh' && (authFailures >= 2 || attempts >= 14)) {
   done = true;
   send({ ok: 0, why: authFailures >= 2 ? 'signin' : 'none' });
   return;
  }
  setTimeout(tick, MODE === 'connect' ? 3000 : 1500);
 }
 const start = () => setTimeout(tick, 1200);
 if (document.readyState === 'complete') start(); else addEventListener('load', start);
})();
"#;

fn base_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("claude"))
        .map_err(|e| format!("error|{e}"))
}

fn marker(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(base_dir(app)?.join("connected"))
}

// ---- reading what the page sent --------------------------------------------------

fn parse_report(fragment: &str) -> Option<Report> {
    let mut fields = std::collections::HashMap::new();
    for part in fragment.split('&') {
        let (k, v) = part.split_once('=')?;
        if k.len() > 8 || v.len() > 24 {
            return None;
        }
        fields.insert(k, v);
    }
    if fields.get("ok") != Some(&"1") {
        return Some(Report::Failed(if fields.get("why") == Some(&"signin") { "signin" } else { "none" }));
    }
    let window = |used: &str, at: &str| -> Option<Window> {
        let used = fields.get(used)?.parse::<f64>().ok()?;
        let at = fields.get(at)?.parse::<i64>().ok()?;
        if !used.is_finite() {
            return None;
        }
        let used = used.round().clamp(0.0, 100.0) as i32;
        Some(Window { remaining: 100 - used, resets_at: Some(at), duration_mins: None })
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    // A reset time that has already passed does not prove a fresh allowance: leave it out.
    let current = |w: Option<Window>| w.filter(|w| w.resets_at.map_or(false, |at| at > now));
    let five = current(window("fu", "fr")).map(|mut w| { w.duration_mins = Some(300); w });
    let week = current(window("wu", "wr")).map(|mut w| { w.duration_mins = Some(10080); w });
    if five.is_none() && week.is_none() {
        return Some(Report::Failed("none"));
    }
    Some(Report::Usage { five, week })
}

fn deliver(report: Report) {
    if let Ok(mut waiter) = WAITER.lock() {
        if let Some(tx) = waiter.take() {
            let _ = tx.send(report);
        }
    }
}

// ---- the private browser window --------------------------------------------------

fn open_window(app: &AppHandle, mode: &'static str) -> Result<WebviewWindow, String> {
    if let Some(old) = app.get_webview_window(WINDOW_LABEL) {
        let _ = old.destroy();
    }
    let visible = mode == "connect";
    let profile = base_dir(app)?.join("browser");
    std::fs::create_dir_all(&profile).map_err(|e| format!("error|{e}"))?;
    let url: Url = USAGE_PAGE.parse().map_err(|_| "error|Bad address.".to_string())?;
    WebviewWindowBuilder::new(app, WINDOW_LABEL, WebviewUrl::External(url))
        .title("Connect Claude")
        .inner_size(520.0, 760.0)
        .center()
        .visible(visible)
        .focused(visible)
        .skip_taskbar(!visible)
        .data_directory(profile)
        .initialization_script(SCRIPT.replace("__MODE__", mode))
        .on_new_window({
            let app = app.clone();
            move |url, features| {
                log_visit("popup", &url);
                // Sign in with Google or Apple opens a popup that has to stay linked to the
                // window that opened it. Only the sign-in window may do this, and only over https.
                if !visible || !(url.scheme() == "https" || url.as_str() == "about:blank") {
                    return NewWindowResponse::Deny;
                }
                let label = format!("claude-popup-{}", POPUPS.fetch_add(1, Ordering::Relaxed));
                let blank: Url = "about:blank".parse().expect("valid address");
                let built = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(blank))
                    .window_features(features)
                    .title("Sign in")
                    .on_navigation(|u| {
                        log_visit("popup nav", u);
                        u.as_str() == "about:blank" || (u.scheme() == "https" && u.host_str() != Some(REPORT_HOST))
                    })
                    .build();
                match built {
                    Ok(window) => NewWindowResponse::Create { window },
                    Err(_) => NewWindowResponse::Deny,
                }
            }
        })
        .on_navigation(move |url| {
            log_visit("nav", url);
            if url.host_str() == Some(REPORT_HOST) {
                if let Some(report) = parse_report(url.fragment().unwrap_or("")) {
                    deliver(report);
                }
                return false; // keep the page where it is
            }
            if url.as_str() == "about:blank" {
                return true;
            }
            // Sign-in may pass through other https sites (Google, Apple); background
            // refreshes may only ever stay on claude.ai.
            url.scheme() == "https" && (visible || url.host_str() == Some("claude.ai"))
        })
        .build()
        .map_err(|e| format!("error|Could not open the Claude window: {e}"))
}

fn into_reading(report: Report) -> Result<Reading, String> {
    match report {
        Report::Usage { five, week } => Ok(Reading {
            email: None,
            plan_type: None,
            five,
            week,
            banked: Vec::new(),
            banked_known: false,
        }),
        Report::Failed("signin") => Err("not_connected|Claude sign-in expired. Connect again.".into()),
        Report::Failed("cancelled") => Err("cancelled|Sign-in cancelled.".into()),
        Report::Failed(_) => Err("error|Claude did not return subscription usage.".into()),
    }
}

async fn wait_for(rx: mpsc::Receiver<Report>, timeout: Duration) -> Result<Report, String> {
    tauri::async_runtime::spawn_blocking(move || match rx.recv_timeout(timeout) {
        Ok(report) => Ok(report),
        Err(RecvTimeoutError::Timeout) => Err("timeout|Claude took too long to answer.".to_string()),
        Err(RecvTimeoutError::Disconnected) => Err("error|Claude window closed.".to_string()),
    })
    .await
    .map_err(|e| format!("error|{e}"))?
}

// ---- commands used by main.rs ----------------------------------------------------

pub async fn connect(app: AppHandle) -> Result<Reading, String> {
    let (tx, rx) = mpsc::channel();
    if let Ok(mut waiter) = WAITER.lock() {
        *waiter = Some(tx.clone());
    }
    let win = open_window(&app, "connect")?;
    // Closing the sign-in window by hand cancels the sign-in.
    let closed = tx.clone();
    win.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed) {
            let _ = closed.send(Report::Failed("cancelled"));
        }
    });

    let outcome = wait_for(rx, CONNECT_TIMEOUT).await;
    if let Ok(mut waiter) = WAITER.lock() {
        *waiter = None;
    }
    let _ = win.destroy();
    let reading = into_reading(outcome?)?;
    if let Ok(path) = marker(&app) {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(path, "1");
    }
    Ok(reading)
}

pub async fn refresh(app: AppHandle) -> Result<Reading, String> {
    if !marker(&app)?.exists() {
        return Err("not_connected|Sign in to connect Claude.".into());
    }
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return Err("busy|Claude sign-in is in progress.".into());
    }
    let (tx, rx) = mpsc::channel();
    if let Ok(mut waiter) = WAITER.lock() {
        *waiter = Some(tx);
    }
    let win = open_window(&app, "refresh")?;
    let outcome = wait_for(rx, REFRESH_TIMEOUT).await;
    if let Ok(mut waiter) = WAITER.lock() {
        *waiter = None;
    }
    let _ = win.destroy();
    into_reading(outcome?)
}

pub async fn disconnect(app: AppHandle) -> Result<(), String> {
    if let Ok(mut waiter) = WAITER.lock() {
        *waiter = None;
    }
    if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
        let _ = win.destroy();
    }
    if let Ok(path) = marker(&app) {
        let _ = std::fs::remove_file(path);
    }
    // Wipe the private browser profile so the saved Claude login is really gone. Its
    // files stay locked for a moment after the window closes, so retry briefly.
    let profile = base_dir(&app)?.join("browser");
    tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..8 {
            if !profile.exists() || std::fs::remove_dir_all(&profile).is_ok() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        Err("error|Claude was disconnected, but its browser data could not be fully removed yet.".to_string())
    })
    .await
    .map_err(|e| format!("error|{e}"))?
}
