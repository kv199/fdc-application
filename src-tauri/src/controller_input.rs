//! Game-controller button binding for the Driver Analysis recording toggle.
//!
//! A dedicated thread owns a message-only window that receives Windows Raw
//! Input from HID joysticks, gamepads, and multi-axis controllers in the
//! background. Only released-to-pressed button transitions are reported, so
//! buttons that stay held (for example an engaged shifter gear) never trigger.

use std::collections::BTreeSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

pub const CONTROLLER_CAPTURED_EVENT: &str = "driver_analysis_controller_captured";
const MAX_BUTTON: u16 = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ControllerBinding {
    pub vendor_id: u16,
    pub product_id: u16,
    pub button: u16,
}

impl ControllerBinding {
    pub fn format(&self) -> String {
        format!(
            "Controller:{:04X}:{:04X}:{}",
            self.vendor_id, self.product_id, self.button
        )
    }
}

pub fn parse_controller_binding(input: &str) -> Option<ControllerBinding> {
    let parts: Vec<&str> = input.trim().split(':').collect();
    let [prefix, vendor, product, button] = parts.as_slice() else {
        return None;
    };
    if !prefix.eq_ignore_ascii_case("controller") {
        return None;
    }
    let hex_id = |value: &str| {
        (value.len() == 4 && value.chars().all(|character| character.is_ascii_hexdigit()))
            .then(|| u16::from_str_radix(value, 16).ok())
            .flatten()
    };
    let vendor_id = hex_id(vendor)?;
    let product_id = hex_id(product)?;
    if button.is_empty()
        || button.starts_with('0')
        || !button.chars().all(|character| character.is_ascii_digit())
    {
        return None;
    }
    let button = button.parse::<u16>().ok()?;
    if !(1..=MAX_BUTTON).contains(&button) {
        return None;
    }
    Some(ControllerBinding {
        vendor_id,
        product_id,
        button,
    })
}

/// Button usages (HID usage page 0x09) that one input report ID carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ButtonRange {
    pub report_id: u8,
    pub min: u16,
    pub max: u16,
}

/// Tracks pressed buttons for one device and yields press edges.
#[derive(Debug, Default)]
pub struct ButtonTracker {
    ranges: Vec<ButtonRange>,
    pressed: BTreeSet<u16>,
    seen_reports: BTreeSet<u8>,
}

impl ButtonTracker {
    pub fn new(ranges: Vec<ButtonRange>) -> Self {
        Self {
            ranges,
            ..Self::default()
        }
    }

    pub fn uses_report_ids(&self) -> bool {
        self.ranges.iter().any(|range| range.report_id != 0)
    }

    fn owns(&self, report_id: u8, usage: u16) -> bool {
        let uses_report_ids = self.uses_report_ids();
        self.ranges.is_empty()
            || self.ranges.iter().any(|range| {
                (!uses_report_ids || range.report_id == report_id)
                    && (range.min..=range.max).contains(&usage)
            })
    }

    /// Applies the pressed button usages decoded from one input report and
    /// returns the buttons that changed from released to pressed. The first
    /// report of each report ID only establishes the baseline.
    pub fn apply_report(&mut self, report_id: u8, pressed_now: &[u16]) -> Vec<u16> {
        let first_report = self.seen_reports.insert(report_id);
        let current: BTreeSet<u16> = pressed_now.iter().copied().collect();
        let edges = if first_report {
            Vec::new()
        } else {
            current.difference(&self.pressed).copied().collect()
        };
        let owned: Vec<u16> = self
            .pressed
            .iter()
            .copied()
            .filter(|usage| self.owns(report_id, *usage))
            .collect();
        for usage in owned {
            self.pressed.remove(&usage);
        }
        self.pressed.extend(current);
        edges
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeAction {
    Capture,
    Trigger,
    Ignore,
}

pub fn edge_action(
    capturing: bool,
    binding: Option<ControllerBinding>,
    pressed: ControllerBinding,
) -> EdgeAction {
    if capturing {
        EdgeAction::Capture
    } else if binding == Some(pressed) {
        EdgeAction::Trigger
    } else {
        EdgeAction::Ignore
    }
}

struct SharedState {
    binding: Option<ControllerBinding>,
    capturing: bool,
    app: Option<AppHandle>,
}

static SHARED: Mutex<SharedState> = Mutex::new(SharedState {
    binding: None,
    capturing: false,
    app: None,
});
static LISTENER_READY: AtomicBool = AtomicBool::new(false);

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CapturedPayload {
    binding: String,
    device_name: String,
}

fn with_shared<T>(update: impl FnOnce(&mut SharedState) -> T) -> Result<T, String> {
    let mut shared = SHARED
        .lock()
        .map_err(|_| "controller input state is unavailable".to_string())?;
    Ok(update(&mut shared))
}

pub fn set_active_binding(binding: Option<ControllerBinding>) -> Result<(), String> {
    with_shared(|shared| shared.binding = binding)
}

/// Handles one press edge from the listener thread.
fn handle_press(pressed: ControllerBinding, device_name: &str) {
    let Ok((action, app)) = with_shared(|shared| {
        let action = edge_action(shared.capturing, shared.binding, pressed);
        if action == EdgeAction::Capture {
            shared.capturing = false;
        }
        (action, shared.app.clone())
    }) else {
        return;
    };
    let Some(app) = app else {
        return;
    };
    match action {
        EdgeAction::Capture => {
            let _ = app.emit(
                CONTROLLER_CAPTURED_EVENT,
                CapturedPayload {
                    binding: pressed.format(),
                    device_name: device_name.to_string(),
                },
            );
        }
        EdgeAction::Trigger => {
            let _ = app.emit(crate::DRIVER_ANALYSIS_HOTKEY_EVENT, ());
        }
        EdgeAction::Ignore => {}
    }
}

#[tauri::command]
pub fn start_controller_capture() -> Result<(), String> {
    if !LISTENER_READY.load(Ordering::Acquire) {
        return Err("controller input is unavailable".to_string());
    }
    with_shared(|shared| shared.capturing = true)
}

#[tauri::command]
pub fn stop_controller_capture() -> Result<(), String> {
    with_shared(|shared| shared.capturing = false)
}

pub fn setup_controller_input(app: AppHandle) {
    if with_shared(|shared| shared.app = Some(app)).is_err() {
        return;
    }
    #[cfg(windows)]
    {
        let spawned = std::thread::Builder::new()
            .name("fdc-controller-input".to_string())
            .spawn(|| {
                if let Err(error) = platform::run_listener() {
                    eprintln!("controller input is unavailable: {error}");
                }
            });
        if let Err(error) = spawned {
            eprintln!("unable to start controller input: {error}");
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::{ButtonRange, ButtonTracker, ControllerBinding, LISTENER_READY, MAX_BUTTON};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::mem::{offset_of, size_of};
    use std::sync::atomic::Ordering;

    use windows::Win32::Devices::HumanInterfaceDevice::{
        HIDP_BUTTON_CAPS, HIDP_CAPS, HIDP_STATUS_SUCCESS, HidD_GetProductString,
        HidP_GetButtonCaps, HidP_GetCaps, HidP_GetUsages, HidP_Input, HidP_MaxUsageListLength,
        PHIDP_PREPARSED_DATA,
    };
    use windows::Win32::Foundation::{
        CloseHandle, HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM,
    };
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::{
        GetRawInputData, GetRawInputDeviceInfoW, HRAWINPUT, RAWHID, RAWINPUT, RAWINPUTDEVICE,
        RAWINPUTHEADER, RID_DEVICE_INFO, RID_INPUT, RIDEV_DEVNOTIFY, RIDEV_INPUTSINK,
        RIDI_DEVICEINFO, RIDI_DEVICENAME, RIDI_PREPARSEDDATA, RIM_TYPEHID, RegisterRawInputDevices,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GIDC_REMOVAL, GetMessageW, HWND_MESSAGE,
        MSG, RegisterClassW, WINDOW_EX_STYLE, WINDOW_STYLE, WM_INPUT, WM_INPUT_DEVICE_CHANGE,
        WNDCLASSW,
    };
    use windows::core::{PCWSTR, w};

    const BUTTON_USAGE_PAGE: u16 = 0x09;
    const GENERIC_DESKTOP_USAGE_PAGE: u16 = 0x01;
    const CONTROLLER_USAGES: [u16; 3] = [0x04, 0x05, 0x08];

    struct Device {
        vendor_id: u16,
        product_id: u16,
        name: String,
        // u64 storage keeps the opaque preparsed data suitably aligned.
        preparsed: Vec<u64>,
        max_usages: u32,
        tracker: ButtonTracker,
    }

    impl Device {
        fn preparsed(&self) -> PHIDP_PREPARSED_DATA {
            PHIDP_PREPARSED_DATA(self.preparsed.as_ptr() as isize)
        }
    }

    thread_local! {
        static DEVICES: RefCell<HashMap<isize, Option<Device>>> = RefCell::new(HashMap::new());
    }

    pub fn run_listener() -> Result<(), String> {
        unsafe {
            let module = GetModuleHandleW(None).map_err(|error| error.to_string())?;
            let instance = HINSTANCE(module.0);
            let class_name = w!("FDCControllerInput");
            let class = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: instance,
                lpszClassName: class_name,
                ..Default::default()
            };
            if RegisterClassW(&class) == 0 {
                return Err("unable to register the controller input window class".to_string());
            }
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                class_name,
                class_name,
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                Some(instance),
                None,
            )
            .map_err(|error| error.to_string())?;
            let devices = CONTROLLER_USAGES.map(|usage| RAWINPUTDEVICE {
                usUsagePage: GENERIC_DESKTOP_USAGE_PAGE,
                usUsage: usage,
                dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
                hwndTarget: hwnd,
            });
            RegisterRawInputDevices(&devices, size_of::<RAWINPUTDEVICE>() as u32)
                .map_err(|error| error.to_string())?;
            LISTENER_READY.store(true, Ordering::Release);

            let mut message = MSG::default();
            while GetMessageW(&mut message, None, 0, 0).0 > 0 {
                DispatchMessageW(&message);
            }
            LISTENER_READY.store(false, Ordering::Release);
            Ok(())
        }
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_INPUT => {
                read_raw_input(HRAWINPUT(lparam.0 as _));
                unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
            }
            WM_INPUT_DEVICE_CHANGE => {
                if wparam.0 == GIDC_REMOVAL as usize {
                    DEVICES.with(|devices| devices.borrow_mut().remove(&lparam.0));
                }
                LRESULT(0)
            }
            _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
        }
    }

    fn read_raw_input(handle: HRAWINPUT) {
        let header_size = size_of::<RAWINPUTHEADER>() as u32;
        let mut size = 0u32;
        if unsafe { GetRawInputData(handle, RID_INPUT, None, &mut size, header_size) } != 0
            || (size as usize) < size_of::<RAWINPUT>()
        {
            return;
        }
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let copied = unsafe {
            GetRawInputData(
                handle,
                RID_INPUT,
                Some(buffer.as_mut_ptr().cast()),
                &mut size,
                header_size,
            )
        };
        if copied == u32::MAX || copied > size {
            return;
        }
        let bytes =
            unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), copied as usize) };
        let input = unsafe { &*buffer.as_ptr().cast::<RAWINPUT>() };
        if input.header.dwType != RIM_TYPEHID.0 {
            return;
        }
        let (report_size, report_count) = unsafe {
            (
                input.data.hid.dwSizeHid as usize,
                input.data.hid.dwCount as usize,
            )
        };
        let start = offset_of!(RAWINPUT, data) + offset_of!(RAWHID, bRawData);
        let Some(end) = report_size
            .checked_mul(report_count)
            .and_then(|length| length.checked_add(start))
        else {
            return;
        };
        if report_size == 0 || end > bytes.len() {
            return;
        }
        let device_key = input.header.hDevice.0 as isize;
        let device_handle = input.header.hDevice;
        let mut presses = Vec::new();
        let mut device_name = String::new();
        DEVICES.with(|devices| {
            let mut devices = devices.borrow_mut();
            let device = devices
                .entry(device_key)
                .or_insert_with(|| open_device(device_handle));
            let Some(device) = device.as_mut() else {
                return;
            };
            if device.max_usages == 0 {
                return;
            }
            for report in bytes[start..end].chunks_exact(report_size) {
                for button in decode_report(device, report) {
                    if button <= MAX_BUTTON {
                        presses.push(ControllerBinding {
                            vendor_id: device.vendor_id,
                            product_id: device.product_id,
                            button,
                        });
                    }
                }
            }
            device_name.clone_from(&device.name);
        });
        for pressed in presses {
            super::handle_press(pressed, &device_name);
        }
    }

    fn decode_report(device: &mut Device, report: &[u8]) -> Vec<u16> {
        let mut report = report.to_vec();
        let mut usages = vec![0u16; device.max_usages as usize];
        let mut length = device.max_usages;
        let status = unsafe {
            HidP_GetUsages(
                HidP_Input,
                BUTTON_USAGE_PAGE,
                None,
                usages.as_mut_ptr(),
                &mut length,
                device.preparsed(),
                &mut report,
            )
        };
        if status != HIDP_STATUS_SUCCESS {
            return Vec::new();
        }
        usages.truncate(length as usize);
        let report_id = if device.tracker.uses_report_ids() {
            report[0]
        } else {
            0
        };
        device.tracker.apply_report(report_id, &usages)
    }

    fn open_device(handle: HANDLE) -> Option<Device> {
        let mut info = RID_DEVICE_INFO {
            cbSize: size_of::<RID_DEVICE_INFO>() as u32,
            ..Default::default()
        };
        let mut info_size = info.cbSize;
        let result = unsafe {
            GetRawInputDeviceInfoW(
                Some(handle),
                RIDI_DEVICEINFO,
                Some((&mut info as *mut RID_DEVICE_INFO).cast()),
                &mut info_size,
            )
        };
        if result == 0 || result == u32::MAX || info.dwType != RIM_TYPEHID {
            return None;
        }
        let hid = unsafe { info.Anonymous.hid };

        let mut preparsed_size = 0u32;
        unsafe {
            GetRawInputDeviceInfoW(Some(handle), RIDI_PREPARSEDDATA, None, &mut preparsed_size)
        };
        if preparsed_size == 0 {
            return None;
        }
        let mut preparsed = vec![0u64; (preparsed_size as usize).div_ceil(8)];
        let result = unsafe {
            GetRawInputDeviceInfoW(
                Some(handle),
                RIDI_PREPARSEDDATA,
                Some(preparsed.as_mut_ptr().cast()),
                &mut preparsed_size,
            )
        };
        if result == 0 || result == u32::MAX {
            return None;
        }
        let preparsed_data = PHIDP_PREPARSED_DATA(preparsed.as_ptr() as isize);
        let max_usages =
            unsafe { HidP_MaxUsageListLength(HidP_Input, Some(BUTTON_USAGE_PAGE), preparsed_data) };

        Some(Device {
            vendor_id: hid.dwVendorId as u16,
            product_id: hid.dwProductId as u16,
            name: product_name(handle),
            tracker: ButtonTracker::new(button_ranges(preparsed_data)),
            preparsed,
            max_usages,
        })
    }

    fn button_ranges(preparsed: PHIDP_PREPARSED_DATA) -> Vec<ButtonRange> {
        let mut caps = HIDP_CAPS::default();
        if unsafe { HidP_GetCaps(preparsed, &mut caps) } != HIDP_STATUS_SUCCESS {
            return Vec::new();
        }
        let mut length = caps.NumberInputButtonCaps;
        if length == 0 {
            return Vec::new();
        }
        let mut button_caps = vec![HIDP_BUTTON_CAPS::default(); length as usize];
        let status = unsafe {
            HidP_GetButtonCaps(HidP_Input, button_caps.as_mut_ptr(), &mut length, preparsed)
        };
        if status != HIDP_STATUS_SUCCESS {
            return Vec::new();
        }
        button_caps.truncate(length as usize);
        button_caps
            .iter()
            .filter(|cap| cap.UsagePage == BUTTON_USAGE_PAGE)
            .map(|cap| {
                let (min, max) = unsafe {
                    if cap.IsRange {
                        (cap.Anonymous.Range.UsageMin, cap.Anonymous.Range.UsageMax)
                    } else {
                        (cap.Anonymous.NotRange.Usage, cap.Anonymous.NotRange.Usage)
                    }
                };
                ButtonRange {
                    report_id: cap.ReportID,
                    min,
                    max,
                }
            })
            .collect()
    }

    fn product_name(handle: HANDLE) -> String {
        let mut length = 0u32;
        unsafe { GetRawInputDeviceInfoW(Some(handle), RIDI_DEVICENAME, None, &mut length) };
        if length == 0 {
            return String::new();
        }
        let mut path = vec![0u16; length as usize + 1];
        let result = unsafe {
            GetRawInputDeviceInfoW(
                Some(handle),
                RIDI_DEVICENAME,
                Some(path.as_mut_ptr().cast()),
                &mut length,
            )
        };
        if result == 0 || result == u32::MAX {
            return String::new();
        }
        let Ok(file) = (unsafe {
            CreateFileW(
                PCWSTR(path.as_ptr()),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                FILE_FLAGS_AND_ATTRIBUTES(0),
                None,
            )
        }) else {
            return String::new();
        };
        let mut name = [0u16; 127];
        let found = unsafe {
            HidD_GetProductString(file, name.as_mut_ptr().cast(), size_of_val(&name) as u32)
        };
        let _ = unsafe { CloseHandle(file) };
        if !found {
            return String::new();
        }
        let end = name
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(name.len());
        String::from_utf16_lossy(&name[..end]).trim().to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOZA: ControllerBinding = ControllerBinding {
        vendor_id: 0x346E,
        product_id: 0x0006,
        button: 116,
    };

    #[test]
    fn controller_bindings_parse_to_canonical_form() {
        assert_eq!(
            parse_controller_binding("Controller:346E:0006:116"),
            Some(MOZA)
        );
        assert_eq!(
            parse_controller_binding(" controller:346e:0006:116 ").map(|binding| binding.format()),
            Some("Controller:346E:0006:116".to_string())
        );
        assert_eq!(
            parse_controller_binding("Controller:0346:0006:1").map(|binding| binding.format()),
            Some("Controller:0346:0006:1".to_string())
        );
        assert!(parse_controller_binding("Controller:346E:0006:1024").is_some());
    }

    #[test]
    fn controller_bindings_reject_invalid_input() {
        for value in [
            "Controller:346E:0006:0",
            "Controller:346E:0006:1025",
            "Controller:346E:0006:0116",
            "Controller:346E:0006:+116",
            "Controller:346G:0006:116",
            "Controller:346:0006:116",
            "Controller:346E:0006",
            "Controller:346E:0006:116:1",
            "Controller:346E: 006:116",
            "Keyboard:346E:0006:116",
            "Ctrl+Shift+F9",
        ] {
            assert_eq!(parse_controller_binding(value), None, "{value}");
        }
    }

    #[test]
    fn held_buttons_do_not_produce_edges() {
        let mut tracker = ButtonTracker::new(vec![ButtonRange {
            report_id: 0,
            min: 1,
            max: 128,
        }]);
        assert!(tracker.apply_report(0, &[3]).is_empty());
        assert!(tracker.apply_report(0, &[3]).is_empty());
        assert_eq!(tracker.apply_report(0, &[3, 116]), vec![116]);
        assert!(tracker.apply_report(0, &[3, 116]).is_empty());
        assert!(tracker.apply_report(0, &[3]).is_empty());
        assert_eq!(tracker.apply_report(0, &[3, 116]), vec![116]);
    }

    #[test]
    fn buttons_split_across_report_ids_keep_independent_state() {
        let mut tracker = ButtonTracker::new(vec![
            ButtonRange {
                report_id: 1,
                min: 1,
                max: 64,
            },
            ButtonRange {
                report_id: 2,
                min: 65,
                max: 128,
            },
        ]);
        assert!(tracker.apply_report(1, &[3]).is_empty());
        assert!(tracker.apply_report(2, &[]).is_empty());
        assert!(tracker.apply_report(1, &[3]).is_empty());
        assert_eq!(tracker.apply_report(2, &[116]), vec![116]);
        assert!(tracker.apply_report(1, &[3]).is_empty());
        assert!(tracker.apply_report(2, &[116]).is_empty());
    }

    #[test]
    fn edges_capture_trigger_or_ignore() {
        let other = ControllerBinding { button: 5, ..MOZA };
        assert_eq!(edge_action(true, Some(MOZA), other), EdgeAction::Capture);
        assert_eq!(edge_action(true, Some(MOZA), MOZA), EdgeAction::Capture);
        assert_eq!(edge_action(false, Some(MOZA), MOZA), EdgeAction::Trigger);
        assert_eq!(edge_action(false, Some(MOZA), other), EdgeAction::Ignore);
        assert_eq!(edge_action(false, None, MOZA), EdgeAction::Ignore);
    }
}
