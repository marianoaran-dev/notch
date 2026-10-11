// Tasks storage.
//
// The new app keeps its own file (tasks.json in its data folder). The old WPF app's file
// (%APPDATA%\V-Notch\tasks.json) is only ever read, once, to copy the tasks across; it is
// never modified.

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const MAX_TASKS: usize = 2000;
const MAX_TEXT: usize = 1000;
const MAX_FILE: usize = 512 * 1024;

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("tasks.json"))
        .map_err(|e| format!("error|{e}"))
}

fn read_json(path: &PathBuf) -> Option<Value> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() as usize > MAX_FILE {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

// Keeps only well-formed tasks: { id, text, done, flag }.
fn clean(list: &[Value]) -> Vec<Value> {
    list.iter()
        .filter_map(|item| {
            let text = item.get("text")?.as_str()?.trim();
            if text.is_empty() {
                return None;
            }
            let text: String = text.chars().take(MAX_TEXT).collect();
            let id = match item.get("id") {
                Some(Value::String(s)) => s.chars().take(64).collect::<String>(),
                Some(Value::Number(n)) => n.to_string(),
                _ => String::new(),
            };
            let done = item.get("done").and_then(Value::as_bool).unwrap_or(false);
            let flag = item.get("flag").and_then(Value::as_bool).unwrap_or(false) && !done;
            Some(json!({ "id": id, "text": text, "done": done, "flag": flag }))
        })
        .take(MAX_TASKS)
        .collect()
}

// { exists: bool, tasks: [...] }
#[tauri::command]
pub fn tasks_load(app: AppHandle) -> Result<Value, String> {
    let path = store_path(&app)?;
    if !path.exists() {
        return Ok(json!({ "exists": false, "tasks": [] }));
    }
    let value = read_json(&path).ok_or("error|The tasks file could not be read.")?;
    let list = value.get("tasks").and_then(Value::as_array).cloned().unwrap_or_default();
    Ok(json!({ "exists": true, "tasks": clean(&list) }))
}

#[tauri::command]
pub fn tasks_save(app: AppHandle, tasks: Vec<Value>) -> Result<(), String> {
    let cleaned = clean(&tasks);
    let text = serde_json::to_string_pretty(&json!({ "version": 1, "tasks": cleaned }))
        .map_err(|e| format!("error|{e}"))?;
    if text.len() > MAX_FILE {
        return Err("error|Too many tasks to save.".into());
    }
    let path = store_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("error|{e}"))?;
    }
    // Keep one backup of the previous version, then swap the new file in.
    if path.exists() {
        let _ = std::fs::copy(&path, path.with_extension("json.bak"));
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text).map_err(|e| format!("error|{e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("error|{e}"))?;
    Ok(())
}

// Reads the old app's tasks (read-only) and converts them. Active tasks keep their order,
// completed ones follow. Nothing is written here; the page decides what to keep.
#[tauri::command]
pub fn tasks_import_old() -> Result<Vec<Value>, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "error|No app data folder.".to_string())?;
    let path = PathBuf::from(appdata).join("V-Notch").join("tasks.json");
    if !path.exists() {
        return Err("none|There is no tasks file from the old app.".into());
    }
    let value = read_json(&path).ok_or("error|The old tasks file could not be read.")?;
    let items = value.as_array().ok_or("error|The old tasks file has an unexpected format.")?;
    let converted: Vec<Value> = items
        .iter()
        .map(|item| {
            json!({
                "id": item.get("Id").and_then(Value::as_str).unwrap_or(""),
                "text": item.get("Text").and_then(Value::as_str).unwrap_or(""),
                "done": item.get("IsCompleted").and_then(Value::as_bool).unwrap_or(false),
                "flag": item.get("IsImportant").and_then(Value::as_bool).unwrap_or(false),
            })
        })
        .collect();
    let mut cleaned = clean(&converted);
    // Active tasks first, in their saved order; completed after.
    cleaned.sort_by_key(|t| t.get("done").and_then(Value::as_bool).unwrap_or(false));
    Ok(cleaned)
}
