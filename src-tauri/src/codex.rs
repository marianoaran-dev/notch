// Codex quota reader.
//
// Mirrors the current V-Notch app: a short-lived `codex app-server` process is started
// with its own CODEX_HOME per account slot, asked for the account and its rate limits
// over JSON-RPC on stdin/stdout, then killed. Codex owns sign-in and token renewal.
// This app uses its own account folders, never the folders of the older WPF app, so
// the two can run side by side without fighting over refresh tokens.

use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const READ_TIMEOUT: Duration = Duration::from_secs(25);
const LOGIN_PROMPT_TIMEOUT: Duration = Duration::from_secs(20);

// Errors the page needs to tell apart start with a short code, then "|", then text.
fn not_connected(text: &str) -> String {
    format!("not_connected|{text}")
}

static CODEX_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);
static LOGIN_CHILD: Mutex<Option<Child>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub remaining: i32,
    pub resets_at: Option<i64>,
    pub duration_mins: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BankedReset {
    pub id: String,
    pub title: String,
    pub granted_at: Option<i64>,
    pub expires_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub email: Option<String>,
    pub plan_type: Option<String>,
    pub five: Option<Window>,
    pub week: Option<Window>,
    pub banked: Vec<BankedReset>,
    pub banked_known: bool,
}

#[derive(Serialize)]
pub struct LoginPrompt {
    pub url: String,
    pub code: String,
}

// ---- starting Codex ---------------------------------------------------------------

fn command(exe: &Path, args: &[&str], home: Option<&Path>) -> Command {
    let is_batch = exe
        .extension()
        .and_then(|e| e.to_str())
        .map_or(false, |e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"));
    let mut cmd = if is_batch {
        // npm installs `codex` as a .cmd wrapper, which has to go through cmd.exe.
        let shell = std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".into());
        let mut c = Command::new(shell);
        c.args(["/d", "/s", "/c"]);
        let quoted: Vec<String> = args
            .iter()
            .map(|a| if a.contains(' ') { format!("\"{a}\"") } else { (*a).to_string() })
            .collect();
        c.raw_arg(format!("\"\"{}\" {}\"", exe.display(), quoted.join(" ")));
        c
    } else {
        let mut c = Command::new(exe);
        c.args(args);
        c
    };
    if let Some(home) = home {
        cmd.env("CODEX_HOME", home);
    }
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn run_quick(exe: &Path, args: &[&str]) -> Option<String> {
    let mut child = command(exe, args, None)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let out = child.wait_with_output().ok()?;
    Some(format!(
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    ))
}

fn locate_codex() -> Option<PathBuf> {
    if let Some(found) = CODEX_PATH.lock().ok().and_then(|p| p.clone()) {
        if found.exists() {
            return Some(found);
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(text) = run_quick(Path::new("where.exe"), &["codex"]) {
        for line in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
            let path = PathBuf::from(line);
            if path.is_absolute() && path.exists() && !candidates.contains(&path) {
                candidates.push(path);
            }
        }
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let standard = PathBuf::from(local).join(r"Programs\OpenAI\Codex\bin\codex.exe");
        if !candidates.contains(&standard) {
            candidates.push(standard);
        }
    }
    for candidate in candidates {
        if let Some(text) = run_quick(&candidate, &["--version"]) {
            if text.to_ascii_lowercase().contains("codex") {
                if let Ok(mut slot) = CODEX_PATH.lock() {
                    *slot = Some(candidate.clone());
                }
                return Some(candidate);
            }
        }
    }
    None
}

// Kills the child process when dropped, however the read ends.
struct KillOnDrop(Child);
impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

// ---- reading the quota ------------------------------------------------------------

pub fn read_quota(home: &Path) -> Result<Reading, String> {
    if !home.join("auth.json").exists() {
        return Err(not_connected("Sign in to connect this account."));
    }
    let exe = locate_codex().ok_or_else(|| {
        "no_codex|Install the Codex CLI to connect accounts. It does not need to stay open.".to_string()
    })?;

    let mut child = command(&exe, &["app-server", "--listen", "stdio://"], Some(home))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("error|Could not start the quota reader: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("error|No input pipe to the quota reader.")?;
    let stdout = child.stdout.take().ok_or("error|No output pipe from the quota reader.")?;
    let _guard = KillOnDrop(child);

    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + READ_TIMEOUT;
    let mut send = |value: Value| -> Result<(), String> {
        writeln!(stdin, "{value}")
            .and_then(|_| stdin.flush())
            .map_err(|_| "error|Quota reader closed unexpectedly.".to_string())
    };
    let request = |id: i64, method: &str, params: Value, send: &mut dyn FnMut(Value) -> Result<(), String>| -> Result<Value, String> {
        send(json!({ "id": id, "method": method, "params": params }))?;
        loop {
            let wait = deadline.saturating_duration_since(Instant::now());
            let line = match rx.recv_timeout(wait) {
                Ok(line) => line,
                Err(RecvTimeoutError::Timeout) => {
                    return Err("timeout|Quota refresh timed out. Your previous reading is kept.".into())
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("error|Quota reader closed before returning a result.".into())
                }
            };
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            if value.get("id").and_then(Value::as_i64) != Some(id) {
                continue;
            }
            if value.get("error").is_some() {
                return Err(not_connected("Quota service could not complete the request. Sign in again if needed."));
            }
            return Ok(value);
        }
    };

    request(
        0,
        "initialize",
        json!({ "clientInfo": { "name": "v_notch_tauri", "title": "V-Notch", "version": "0.1" } }),
        &mut send,
    )?;
    send(json!({ "method": "initialized", "params": {} }))?;
    let account = request(1, "account/read", json!({ "refreshToken": true }), &mut send)?;
    let (email, plan_type) = parse_account(&account);
    if email.as_deref().map_or(true, |e| e.trim().is_empty()) {
        return Err(not_connected("Sign in to connect this account."));
    }
    let limits = request(2, "account/rateLimits/read", json!({}), &mut send)?;
    let mut reading = parse_rate_limits(&limits);
    reading.email = email;
    reading.plan_type = plan_type;
    if reading.five.is_none() && reading.week.is_none() {
        return Err("error|This account did not return a quota reading.".into());
    }
    Ok(reading)
}

fn parse_account(response: &Value) -> (Option<String>, Option<String>) {
    let account = response.pointer("/result/account");
    let text = |key: &str| {
        account
            .and_then(|a| a.get(key))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    (text("email"), text("planType"))
}

fn parse_rate_limits(response: &Value) -> Reading {
    let result = response.get("result").cloned().unwrap_or(Value::Null);
    let limits = result
        .pointer("/rateLimitsByLimitId/codex")
        .or_else(|| result.get("rateLimits"))
        .cloned()
        .unwrap_or(Value::Null);

    let mut windows: Vec<(&str, Window)> = Vec::new();
    for source in ["primary", "secondary"] {
        let Some(value) = limits.get(source) else { continue };
        let Some(used) = value.get("usedPercent").and_then(Value::as_f64) else { continue };
        let used = used.round().clamp(0.0, 100.0) as i32;
        windows.push((
            source,
            Window {
                remaining: 100 - used,
                resets_at: value.get("resetsAt").and_then(Value::as_i64),
                duration_mins: value.get("windowDurationMins").and_then(Value::as_i64),
            },
        ));
    }
    // Prefer the window by its length (5 h / 7 days), then fall back to its position.
    let mut take = |minutes: i64, fallback: &str| -> Option<Window> {
        let index = windows
            .iter()
            .position(|(_, w)| w.duration_mins == Some(minutes))
            .or_else(|| windows.iter().position(|(source, _)| *source == fallback))?;
        Some(windows.remove(index).1)
    };
    let five = take(300, "primary");
    let week = take(10080, "secondary");

    let reset_data = result.get("rateLimitResetCredits");
    let banked_known = reset_data.map_or(false, Value::is_object);
    let mut banked: Vec<BankedReset> = reset_data
        .and_then(|r| r.get("credits"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.is_object())
                .filter(|item| {
                    let status = item.get("status").and_then(Value::as_str).unwrap_or("unknown");
                    let kind = item.get("resetType").and_then(Value::as_str).unwrap_or("unknown");
                    (status.eq_ignore_ascii_case("available") || status == "unknown")
                        && (kind.eq_ignore_ascii_case("codexRateLimits") || kind == "unknown")
                })
                .map(|item| BankedReset {
                    id: item.get("id").and_then(Value::as_str).unwrap_or("").to_owned(),
                    title: item.get("title").and_then(Value::as_str).unwrap_or("Codex reset").to_owned(),
                    granted_at: item.get("grantedAt").and_then(Value::as_i64),
                    expires_at: item.get("expiresAt").and_then(Value::as_i64),
                })
                .collect()
        })
        .unwrap_or_default();
    banked.sort_by_key(|b| (b.expires_at.is_none(), b.expires_at, b.granted_at));

    Reading { email: None, plan_type: None, five, week, banked, banked_known }
}

// ---- signing in -------------------------------------------------------------------

// Starts `codex login --device-auth` for this account folder. Codex prints a web
// address and a one-time code; the person enters the code in their own browser.
// The process keeps running until they finish, then writes auth.json itself.
pub fn start_login(home: &Path) -> Result<LoginPrompt, String> {
    let exe = locate_codex().ok_or_else(|| {
        "no_codex|Install the Codex CLI to connect accounts. It does not need to stay open.".to_string()
    })?;
    std::fs::create_dir_all(home).map_err(|e| format!("error|Could not create the account folder: {e}"))?;

    if let Ok(mut running) = LOGIN_CHILD.lock() {
        if let Some(mut old) = running.take() {
            let _ = old.kill();
            let _ = old.wait();
        }
    }

    let mut child = command(&exe, &["login", "--device-auth"], Some(home))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("error|Codex sign-in could not be started: {e}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Ok(mut running) = LOGIN_CHILD.lock() {
        *running = Some(child);
    }

    let (tx, rx) = mpsc::channel::<String>();
    for stream in [stdout.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), stderr.map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)]
        .into_iter()
        .flatten()
    {
        let tx = tx.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
    }
    drop(tx);

    let deadline = Instant::now() + LOGIN_PROMPT_TIMEOUT;
    let (mut url, mut code) = (None::<String>, None::<String>);
    while url.is_none() || code.is_none() {
        let wait = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(wait) {
            Ok(line) => {
                let clean = strip_ansi(&line);
                for token in clean.split_whitespace() {
                    let token = token.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != ':' && c != '/' && c != '.' && c != '-' && c != '_');
                    if url.is_none() && token.starts_with("https://") {
                        url = Some(token.to_owned());
                    } else if code.is_none() && looks_like_device_code(token) {
                        code = Some(token.to_ascii_uppercase());
                    }
                }
            }
            Err(_) => {
                cancel_login();
                return Err("error|Codex did not show a sign-in code in time.".into());
            }
        }
    }
    Ok(LoginPrompt { url: url.unwrap(), code: code.unwrap() })
}

// Signs this account folder out (`codex logout`).
pub fn logout(home: &Path) -> Result<(), String> {
    if !home.exists() {
        return Ok(());
    }
    let exe = locate_codex().ok_or_else(|| "no_codex|Codex CLI was not found.".to_string())?;
    let mut child = command(&exe, &["logout"], Some(home))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("error|Could not sign out: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            _ => {
                let _ = child.kill();
                return Err("timeout|Sign-out timed out.".into());
            }
        }
    }
    // `codex logout` removes the saved sign-in; make sure nothing usable is left behind.
    let _ = std::fs::remove_file(home.join("auth.json"));
    Ok(())
}

pub fn cancel_login() {
    if let Ok(mut running) = LOGIN_CHILD.lock() {
        if let Some(mut child) = running.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// True once the pending sign-in process has finished, successfully or not.
pub fn login_finished() -> bool {
    let Ok(mut running) = LOGIN_CHILD.lock() else { return true };
    match running.as_mut() {
        None => true,
        Some(child) => match child.try_wait() {
            Ok(Some(_)) | Err(_) => {
                *running = None;
                true
            }
            Ok(None) => false,
        },
    }
}

fn looks_like_device_code(token: &str) -> bool {
    let parts: Vec<&str> = token.split('-').collect();
    parts.len() == 2
        && parts.iter().all(|p| (4..=8).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphanumeric()))
        && token.chars().any(|c| c.is_ascii_digit() || c.is_ascii_uppercase())
}

fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

// Only addresses at OpenAI / ChatGPT may be opened from Codex's output.
pub fn is_trusted_login_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.split(':').next().unwrap_or("");
    ["openai.com", "chatgpt.com"]
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}
