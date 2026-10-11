// Monitor control over DDC/CI, ported from the old app's DdcMonitorService.
//
// Each physical monitor is asked for its brightness (VCP code 0x10) and contrast (0x12)
// through the Windows Monitor Configuration API, and written back the same way. Writes are
// serialised and spaced out (monitors drop commands sent too quickly) and retried once.
// Power off is the same system message the old app sends ("Display Off" / "Sleep").

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::BOOL;
use windows::Win32::Devices::Display::{
    DestroyPhysicalMonitors, GetNumberOfPhysicalMonitorsFromHMONITOR,
    GetPhysicalMonitorsFromHMONITOR, GetVCPFeatureAndVCPFeatureReply, SetVCPFeature,
    PHYSICAL_MONITOR,
};
use windows::Win32::Foundation::{LPARAM, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SYSCOMMAND,
};

const BRIGHTNESS: u8 = 0x10;
const CONTRAST: u8 = 0x12;
const SC_MONITORPOWER: usize = 0xF170;
const MIN_WRITE_SPACING: Duration = Duration::from_millis(35);
const RETRY_DELAY: Duration = Duration::from_millis(45);
const MONITORINFOF_PRIMARY: u32 = 1;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Feature {
    pub supported: bool,
    pub percent: f64,
    pub max: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub device: String,
    pub primary: bool,
    pub brightness: Feature,
    pub contrast: Feature,
}

struct Logical {
    handle: HMONITOR,
    device: String,
    primary: bool,
}

// Maximum VCP values captured when the list was read, so a write needs no extra read.
static MAXIMA: Mutex<Option<HashMap<(String, u8), u32>>> = Mutex::new(None);
// Serialises writes and remembers when the last one finished.
static WRITE_GATE: Mutex<Option<Instant>> = Mutex::new(None);

fn wide_to_string(buffer: &[u16]) -> String {
    let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..end]).trim().to_string()
}

unsafe extern "system" fn collect(handle: HMONITOR, _dc: HDC, _rect: *mut RECT, data: LPARAM) -> BOOL {
    let list = &mut *(data.0 as *mut Vec<Logical>);
    let mut info = MONITORINFOEXW::default();
    info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
    if GetMonitorInfoW(handle, &mut info as *mut MONITORINFOEXW as *mut MONITORINFO).as_bool() {
        let device = wide_to_string(&info.szDevice);
        if !device.is_empty() {
            list.push(Logical {
                handle,
                device,
                primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
            });
        }
    }
    true.into()
}

fn logical_displays() -> Vec<Logical> {
    let mut list: Vec<Logical> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(collect), LPARAM(&mut list as *mut Vec<Logical> as isize));
    }
    list.sort_by(|a, b| a.device.to_lowercase().cmp(&b.device.to_lowercase()));
    list
}

// The physical monitors behind one logical display. Destroyed when dropped.
struct Lease(Vec<PHYSICAL_MONITOR>);
impl Drop for Lease {
    fn drop(&mut self) {
        if !self.0.is_empty() {
            unsafe {
                let _ = DestroyPhysicalMonitors(&self.0);
            }
        }
    }
}

fn acquire(handle: HMONITOR) -> Option<Lease> {
    unsafe {
        let mut count = 0u32;
        GetNumberOfPhysicalMonitorsFromHMONITOR(handle, &mut count).ok()?;
        if count == 0 {
            return None;
        }
        let mut monitors = vec![PHYSICAL_MONITOR::default(); count as usize];
        GetPhysicalMonitorsFromHMONITOR(handle, &mut monitors).ok()?;
        Some(Lease(monitors))
    }
}

fn read_feature(monitor: &PHYSICAL_MONITOR, code: u8) -> (Feature, u32) {
    let (mut current, mut maximum) = (0u32, 0u32);
    let ok = unsafe { GetVCPFeatureAndVCPFeatureReply(monitor.hPhysicalMonitor, code, None, &mut current, Some(&mut maximum)) };
    if ok == 0 || maximum == 0 {
        return (Feature { supported: false, percent: 0.0, max: 0 }, 0);
    }
    let percent = (current as f64 * 100.0 / maximum as f64).clamp(0.0, 100.0);
    (Feature { supported: true, percent, max: maximum }, maximum)
}

pub fn list() -> Vec<MonitorInfo> {
    let mut result = Vec::new();
    let mut maxima: HashMap<(String, u8), u32> = HashMap::new();
    for logical in logical_displays() {
        let Some(lease) = acquire(logical.handle) else { continue };
        for (index, physical) in lease.0.iter().enumerate() {
            let id = format!("{}:{}", logical.device, index);
            // The structure is packed, so copy the text out before borrowing it.
            let raw_description = physical.szPhysicalMonitorDescription;
            let description = wide_to_string(&raw_description);
            let (brightness, b_max) = read_feature(physical, BRIGHTNESS);
            let (contrast, c_max) = read_feature(physical, CONTRAST);
            if b_max > 0 {
                maxima.insert((id.clone(), BRIGHTNESS), b_max);
            }
            if c_max > 0 {
                maxima.insert((id.clone(), CONTRAST), c_max);
            }
            result.push(MonitorInfo {
                id,
                name: if description.is_empty() { "Physical monitor".into() } else { description },
                device: logical.device.clone(),
                primary: logical.primary,
                brightness,
                contrast,
            });
        }
    }
    if let Ok(mut store) = MAXIMA.lock() {
        *store = Some(maxima);
    }
    result
}

fn write_once(id: &str, code: u8, percent: f64) -> Result<(), String> {
    let (device, index) = id
        .rsplit_once(':')
        .and_then(|(d, i)| i.parse::<usize>().ok().map(|i| (d.to_string(), i)))
        .ok_or("error|Bad monitor id.")?;
    let logical = logical_displays()
        .into_iter()
        .find(|l| l.device.eq_ignore_ascii_case(&device))
        .ok_or("error|That display is no longer available.")?;
    let lease = acquire(logical.handle).ok_or("error|The physical monitor is no longer available.")?;
    let physical = lease.0.get(index).ok_or("error|The physical monitor is no longer available.")?;

    let known = MAXIMA
        .lock()
        .ok()
        .and_then(|m| m.as_ref().and_then(|m| m.get(&(id.to_string(), code)).copied()));
    let maximum = match known {
        Some(m) if m > 0 => m,
        _ => read_feature(physical, code).1,
    };
    if maximum == 0 {
        return Err(format!("error|VCP 0x{code:02X} is not supported by this monitor."));
    }
    let native = (percent.clamp(0.0, 100.0) / 100.0 * maximum as f64).round() as u32;
    let ok = unsafe { SetVCPFeature(physical.hPhysicalMonitor, code, native) };
    if ok == 0 {
        return Err(format!("write|VCP 0x{code:02X} write failed."));
    }
    Ok(())
}

pub fn set(id: &str, control: &str, percent: f64) -> Result<(), String> {
    let code = match control {
        "brightness" => BRIGHTNESS,
        "contrast" => CONTRAST,
        _ => return Err("error|Unknown control.".into()),
    };
    if !percent.is_finite() {
        return Err("error|Bad value.".into());
    }
    let mut gate = WRITE_GATE.lock().map_err(|_| "error|Monitor control is busy.".to_string())?;
    if let Some(last) = *gate {
        let wait = MIN_WRITE_SPACING.saturating_sub(last.elapsed());
        if !wait.is_zero() {
            std::thread::sleep(wait);
        }
    }
    let mut result = write_once(id, code, percent);
    if matches!(&result, Err(e) if e.starts_with("write|")) {
        std::thread::sleep(RETRY_DELAY);
        result = write_once(id, code, percent);
    }
    *gate = Some(Instant::now());
    result.map_err(|e| e.split_once('|').map(|(_, t)| format!("error|{t}")).unwrap_or(e))
}

// Turns every display off (it wakes on the next mouse move or key press). This is the same
// system message the old app's "Display Off" and "Sleep monitors" buttons send.
pub fn power_off() -> bool {
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SYSCOMMAND,
            WPARAM(SC_MONITORPOWER),
            LPARAM(2),
            SMTO_ABORTIFHUNG,
            500,
            None,
        )
        .0 != 0
    }
}
