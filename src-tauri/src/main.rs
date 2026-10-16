#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf, sync::Mutex};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime, State,
    WebviewWindow, WebviewWindowBuilder, Window, WindowEvent, menu::MenuBuilder,
    tray::TrayIconBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_opener::OpenerExt;

mod controller_input;
mod db;
mod driver_analysis;
mod driver_analysis_export;
mod events;
mod garage;
mod shift_light;
mod telemetry;
#[cfg(test)]
mod test_support;

use db::*;
use driver_analysis::*;
use events::*;
use garage::*;
use shift_light::*;
use telemetry::*;

const SETTINGS_WINDOW_STATE_FILE: &str = "settings-window-size.json";
const HUD_DISPLAY_STATE_FILE: &str = "hud-display.json";
const HUD_RENDERING_STATE_FILE: &str = "hud-rendering.json";
// Browser arguments replace wry's defaults, so CPU rendering repeats them.
const CPU_RENDERING_BROWSER_ARGS: &str =
    "--disable-gpu --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
#[cfg(test)]
const SETTINGS_DEFAULT_WIDTH: u32 = 820;
#[cfg(test)]
const SETTINGS_DEFAULT_HEIGHT: u32 = 620;
const SETTINGS_MIN_WIDTH: u32 = 460;
const SETTINGS_MIN_HEIGHT: u32 = 560;
const SETTINGS_MAX_WIDTH: u32 = 8192;
const SETTINGS_MAX_HEIGHT: u32 = 8192;
const DRIVER_ANALYSIS_HOTKEY_EVENT: &str = "driver_analysis_hotkey";
const HUD_STAGE_EVENT: &str = "hud_stage";

struct DriverAnalysisHotkeyState {
    current: Mutex<String>,
}

impl Default for DriverAnalysisHotkeyState {
    fn default() -> Self {
        Self {
            current: Mutex::new(String::new()),
        }
    }
}

struct HudEditHotkeyState {
    current: Mutex<String>,
}

impl Default for HudEditHotkeyState {
    fn default() -> Self {
        Self {
            current: Mutex::new(String::new()),
        }
    }
}

fn set_window_interaction<R: Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
) -> tauri::Result<()> {
    if enabled {
        // Keep Settings above the full-screen overlay while the user drags a target.
        // The non-focusable window can still receive pointer events when click-through
        // is disabled, but it cannot steal focus from Settings.
        window.set_focusable(false)?;
        window.set_ignore_cursor_events(false)?;
    } else {
        window.set_ignore_cursor_events(true)?;
        window.set_focusable(false)?;
    }

    Ok(())
}

#[derive(Clone, Copy, Deserialize, Serialize)]
struct SettingsWindowState {
    width: u32,
    height: u32,
    #[serde(default)]
    x: Option<i32>,
    #[serde(default)]
    y: Option<i32>,
}

fn settings_window_state_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(SETTINGS_WINDOW_STATE_FILE))
}

fn is_valid_settings_window_state(state: SettingsWindowState) -> bool {
    (SETTINGS_MIN_WIDTH..=SETTINGS_MAX_WIDTH).contains(&state.width)
        && (SETTINGS_MIN_HEIGHT..=SETTINGS_MAX_HEIGHT).contains(&state.height)
}

fn is_position_on_monitor(
    position: PhysicalPosition<i32>,
    monitor_position: PhysicalPosition<i32>,
    monitor_size: PhysicalSize<u32>,
) -> bool {
    let x = i64::from(position.x);
    let y = i64::from(position.y);
    let left = i64::from(monitor_position.x);
    let top = i64::from(monitor_position.y);
    let right = left + i64::from(monitor_size.width);
    let bottom = top + i64::from(monitor_size.height);

    x >= left && x < right && y >= top && y < bottom
}

fn restore_settings_window_state<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> tauri::Result<()> {
    let path = settings_window_state_path(app)?;
    let Ok(contents) = fs::read_to_string(path) else {
        return Ok(());
    };
    let Ok(state) = serde_json::from_str::<SettingsWindowState>(&contents) else {
        return Ok(());
    };
    if !is_valid_settings_window_state(state) {
        return Ok(());
    }

    window.set_size(LogicalSize::new(state.width, state.height))?;

    let (Some(x), Some(y)) = (state.x, state.y) else {
        return Ok(());
    };
    let position = PhysicalPosition::new(x, y);
    let position_is_available = app
        .available_monitors()?
        .iter()
        .any(|monitor| is_position_on_monitor(position, *monitor.position(), *monitor.size()));
    if position_is_available {
        window.set_position(position)?;
    }
    Ok(())
}

fn settings_window_state<R: Runtime>(window: &Window<R>) -> tauri::Result<SettingsWindowState> {
    let size = window.inner_size()?;
    let position = window.outer_position()?;
    let scale_factor = window
        .scale_factor()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(1.0);

    Ok(SettingsWindowState {
        width: ((size.width as f64 / scale_factor).round()) as u32,
        height: ((size.height as f64 / scale_factor).round()) as u32,
        x: Some(position.x),
        y: Some(position.y),
    })
}

fn persist_settings_window_state<R: Runtime>(
    app: &AppHandle<R>,
    state: SettingsWindowState,
) -> tauri::Result<()> {
    if !is_valid_settings_window_state(state) {
        return Ok(());
    }

    let path = settings_window_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_vec(&state).map_err(std::io::Error::other)?;
    fs::write(path, contents)?;
    Ok(())
}

#[derive(Default)]
struct HudDisplayRuntimeState {
    current: Mutex<Option<String>>,
}

/// The visible HUD rectangle in physical pixels, relative to the top-left corner
/// of the HUD's monitor. The page converts its CSS pixels with its own
/// devicePixelRatio, which also follows the Windows text size.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
struct HudWindowBounds {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

#[derive(Default)]
struct HudWindowShapeState {
    /// `None` covers the whole monitor.
    bounds: Mutex<Option<HudWindowBounds>>,
    editing: Mutex<bool>,
}

/// The monitor size and the window offset on it, in physical pixels; the page
/// maps them to CSS pixels with its own devicePixelRatio.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HudStage {
    stage_width: f64,
    stage_height: f64,
    offset_x: f64,
    offset_y: f64,
}

#[derive(Clone, Deserialize, Serialize)]
struct HudDisplayState {
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct HudDisplayOption {
    name: String,
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    primary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HudDisplayList {
    displays: Vec<HudDisplayOption>,
    selected: Option<String>,
    saved_missing: bool,
}

fn hud_display_number(name: &str) -> Option<u32> {
    let digits_start = name.trim_end_matches(|c: char| c.is_ascii_digit()).len();
    name[digits_start..].parse().ok()
}

fn hud_display_label(number: u32, width: u32, height: u32, primary: bool) -> String {
    let label = format!("Display {number} · {width} × {height}");
    if primary {
        format!("{label} · Primary")
    } else {
        label
    }
}

fn find_saved_hud_display(saved: &HudDisplayState, displays: &[HudDisplayOption]) -> Option<usize> {
    displays
        .iter()
        .position(|display| display.name == saved.name)
        .or_else(|| {
            displays.iter().position(|display| {
                display.x == saved.x
                    && display.y == saved.y
                    && display.width == saved.width
                    && display.height == saved.height
            })
        })
}

fn choose_hud_display(
    saved: Option<&HudDisplayState>,
    displays: &[HudDisplayOption],
) -> Option<usize> {
    saved
        .and_then(|saved| find_saved_hud_display(saved, displays))
        .or_else(|| displays.iter().position(|display| display.primary))
        .or_else(|| (!displays.is_empty()).then_some(0))
}

fn hud_display_options<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Vec<HudDisplayOption>> {
    let primary = app.primary_monitor()?;
    Ok(app
        .available_monitors()?
        .iter()
        .enumerate()
        .map(|(index, monitor)| {
            let position = *monitor.position();
            let size = *monitor.size();
            let name = monitor
                .name()
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("Display {}", index + 1));
            let is_primary = primary
                .as_ref()
                .is_some_and(|primary| *primary.position() == position && *primary.size() == size);
            let number = hud_display_number(&name).unwrap_or(index as u32 + 1);
            HudDisplayOption {
                label: hud_display_label(number, size.width, size.height, is_primary),
                name,
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
                primary: is_primary,
            }
        })
        .collect())
}

fn hud_display_state_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(HUD_DISPLAY_STATE_FILE))
}

fn load_hud_display_state<R: Runtime>(app: &AppHandle<R>) -> Option<HudDisplayState> {
    let contents = fs::read_to_string(hud_display_state_path(app).ok()?).ok()?;
    serde_json::from_str(&contents).ok()
}

fn persist_hud_display<R: Runtime>(
    app: &AppHandle<R>,
    display: &HudDisplayOption,
) -> tauri::Result<()> {
    let state = HudDisplayState {
        name: display.name.clone(),
        x: display.x,
        y: display.y,
        width: display.width,
        height: display.height,
    };
    let path = hud_display_state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_vec(&state).map_err(std::io::Error::other)?;
    fs::write(path, contents)?;
    Ok(())
}

/// Where both FDC webviews draw. WebView2 fixes this when it starts, so a
/// change applies from the next launch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum HudRenderer {
    #[default]
    Gpu,
    Cpu,
}

#[derive(Deserialize, Serialize)]
struct HudRenderingState {
    renderer: HudRenderer,
}

/// The renderer this launch started with.
struct ActiveHudRenderer(HudRenderer);

#[derive(Serialize)]
struct HudRenderingStatus {
    active: HudRenderer,
    saved: HudRenderer,
}

fn hud_rendering_state_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(HUD_RENDERING_STATE_FILE))
}

fn parse_hud_renderer(contents: &str) -> HudRenderer {
    serde_json::from_str::<HudRenderingState>(contents)
        .map(|state| state.renderer)
        .unwrap_or_default()
}

fn load_hud_renderer<R: Runtime>(app: &AppHandle<R>) -> HudRenderer {
    hud_rendering_state_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|contents| parse_hud_renderer(&contents))
        .unwrap_or_default()
}

fn hud_rendering_browser_args(renderer: HudRenderer) -> Option<&'static str> {
    match renderer {
        HudRenderer::Gpu => None,
        HudRenderer::Cpu => Some(CPU_RENDERING_BROWSER_ARGS),
    }
}

#[tauri::command]
fn get_hud_rendering(app: AppHandle, active: State<'_, ActiveHudRenderer>) -> HudRenderingStatus {
    HudRenderingStatus {
        active: active.0,
        saved: load_hud_renderer(&app),
    }
}

#[tauri::command]
fn set_hud_rendering(
    app: AppHandle,
    active: State<'_, ActiveHudRenderer>,
    renderer: HudRenderer,
) -> Result<HudRenderingStatus, String> {
    let path = hud_rendering_state_path(&app)
        .map_err(|error| format!("unable to locate HUD rendering setting: {error}"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("unable to save HUD rendering setting: {error}"))?;
    }
    let contents = serde_json::to_vec(&HudRenderingState { renderer })
        .map_err(|error| format!("unable to save HUD rendering setting: {error}"))?;
    fs::write(path, contents)
        .map_err(|error| format!("unable to save HUD rendering setting: {error}"))?;
    Ok(HudRenderingStatus {
        active: active.0,
        saved: renderer,
    })
}

/// Maps one span onto a monitor axis of `extent` physical pixels. Rounds
/// outward so the window never cuts into a visible block, and keeps at least
/// one pixel inside the monitor.
fn hud_window_span(start: f64, end: f64, extent: u32) -> (i64, i64) {
    let extent = i64::from(extent);
    let start = (start.floor() as i64).clamp(0, (extent - 1).max(0));
    let end = (end.ceil() as i64).clamp(start + 1, extent.max(start + 1));
    (start, end)
}

/// The physical rectangle the HUD window occupies on `display`. Editing, or no
/// stored bounds, covers the whole monitor.
fn hud_window_rect(
    display: &HudDisplayOption,
    bounds: Option<HudWindowBounds>,
    editing: bool,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let bounds = match bounds {
        Some(bounds) if !editing => bounds,
        _ => {
            return (
                PhysicalPosition::new(display.x, display.y),
                PhysicalSize::new(display.width, display.height),
            );
        }
    };
    let (left, right) = hud_window_span(bounds.left, bounds.left + bounds.width, display.width);
    let (top, bottom) = hud_window_span(bounds.top, bounds.top + bounds.height, display.height);
    (
        PhysicalPosition::new(display.x + left as i32, display.y + top as i32),
        PhysicalSize::new((right - left) as u32, (bottom - top) as u32),
    )
}

/// Moves and resizes the HUD window to the stored shape on `display`, returning
/// whether the window geometry changed.
fn apply_hud_window_shape<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    display: &HudDisplayOption,
) -> tauri::Result<bool> {
    let shape = app.state::<HudWindowShapeState>();
    let bounds = *shape
        .bounds
        .lock()
        .expect("HUD window shape state poisoned");
    let editing = *shape
        .editing
        .lock()
        .expect("HUD window shape state poisoned");
    let (position, size) = hud_window_rect(display, bounds, editing);
    fit_hud_window(window, position, size)
}

/// Returns whether anything changed. Position is set before size so the corner
/// is already on the target monitor when Windows rescales for its DPI.
fn fit_hud_window<R: Runtime>(
    window: &WebviewWindow<R>,
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> tauri::Result<bool> {
    let mut changed = false;
    // Move first so the top-left corner is already on the target monitor when
    // Windows rescales the window for that monitor's DPI.
    if window.outer_position()? != position {
        window.set_position(position)?;
        changed = true;
    }
    if window.inner_size()? != size {
        window.set_size(size)?;
        changed = true;
    }
    Ok(changed)
}

fn hud_stage_for(display: &HudDisplayOption, window_position: PhysicalPosition<i32>) -> HudStage {
    HudStage {
        stage_width: f64::from(display.width),
        stage_height: f64::from(display.height),
        offset_x: (i64::from(window_position.x) - i64::from(display.x)) as f64,
        offset_y: (i64::from(window_position.y) - i64::from(display.y)) as f64,
    }
}

/// The HUD monitor FDC last placed the window on, if it is still connected.
fn current_hud_display<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Option<HudDisplayOption>> {
    let Some(name) = app
        .state::<HudDisplayRuntimeState>()
        .current
        .lock()
        .expect("HUD display state poisoned")
        .clone()
    else {
        return Ok(None);
    };
    Ok(hud_display_options(app)?
        .into_iter()
        .find(|display| display.name == name))
}

fn current_hud_stage<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Option<HudStage>> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(None);
    };
    let Some(display) = current_hud_display(app)? else {
        return Ok(None);
    };
    Ok(Some(hud_stage_for(&display, window.outer_position()?)))
}

/// Sends the HUD geometry to the main window only.
fn emit_hud_stage<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(stage) = current_hud_stage(app)? {
        app.emit_to("main", HUD_STAGE_EVENT, stage)?;
    }
    Ok(())
}

fn place_hud_window<R: Runtime>(
    app: &AppHandle<R>,
    display: &HudDisplayOption,
) -> tauri::Result<()> {
    *app.state::<HudDisplayRuntimeState>()
        .current
        .lock()
        .expect("HUD display state poisoned") = Some(display.name.clone());
    // The page recomputes its bounds for the new monitor.
    *app.state::<HudWindowShapeState>()
        .bounds
        .lock()
        .expect("HUD window shape state poisoned") = None;
    if let Some(window) = app.get_webview_window("main") {
        apply_hud_window_shape(app, &window, display)?;
    }
    emit_hud_stage(app)
}

/// Keeps the HUD on the monitor its top-left corner is on after Windows moves
/// or rescales it, for example with Win+Shift+Arrow. On the same monitor it
/// re-applies the stored shape, which ends the event cycle caused by FDC's own
/// geometry changes.
fn follow_hud_window_monitor<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    let position = window.outer_position()?;
    let displays = hud_display_options(app)?;
    let Some(display) = displays.iter().find(|display| {
        is_position_on_monitor(
            position,
            PhysicalPosition::new(display.x, display.y),
            PhysicalSize::new(display.width, display.height),
        )
    }) else {
        return Ok(());
    };

    let state = app.state::<HudDisplayRuntimeState>();
    let monitor_changed = {
        let mut current = state.current.lock().expect("HUD display state poisoned");
        // The HUD has not been placed yet during startup.
        let Some(name) = current.as_ref() else {
            return Ok(());
        };
        let changed = *name != display.name;
        if changed {
            *current = Some(display.name.clone());
        }
        changed
    };

    if monitor_changed {
        *app.state::<HudWindowShapeState>()
            .bounds
            .lock()
            .expect("HUD window shape state poisoned") = None;
        apply_hud_window_shape(app, &window, display)?;
        persist_hud_display(app, display)?;
        if let Some(settings) = app.get_webview_window("settings") {
            let _ = settings.eval("window.SettingsController?.refreshHudDisplay?.()");
        }
        emit_hud_stage(app)?;
    } else if apply_hud_window_shape(app, &window, display)? {
        emit_hud_stage(app)?;
    }
    Ok(())
}

fn show_settings<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("settings") else {
        return Ok(());
    };

    window.show()?;
    window.set_focus()?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.eval("window.HudOverlay?.syncRouteStatus?.()");
    }
    Ok(())
}

fn settings_window_context_label(context: &str) -> Option<&'static str> {
    match context {
        "hud" => Some("HUD"),
        "driver-analysis" => Some("DRIVER ANALYSIS"),
        "garage" => Some("GARAGE"),
        "events" => Some("EVENTS"),
        "shift-light" => Some("SHIFT LIGHT"),
        "settings" => Some("SETTINGS"),
        _ => None,
    }
}

fn settings_window_title(context: &str) -> String {
    format!("FDC · {context} · v{}", get_app_version())
}

enum HotkeyBinding {
    Keyboard(String),
    Controller(controller_input::ControllerBinding),
}

fn normalize_hotkey(value: &str) -> Result<String, String> {
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut main_key = None;

    for token in value
        .split('+')
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => ctrl = true,
            "alt" => alt = true,
            "shift" => shift = true,
            "win" | "windows" | "meta" | "super" => {
                return Err("Windows-key shortcuts are not allowed".to_string());
            }
            _ if main_key.is_none() => {
                let upper = token.to_ascii_uppercase();
                let supported = (upper.len() == 1
                    && upper
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric()))
                    || upper
                        .strip_prefix('F')
                        .and_then(|number| number.parse::<u8>().ok())
                        .is_some_and(|number| (1..=12).contains(&number))
                    || matches!(
                        upper.as_str(),
                        "SPACE"
                            | "ENTER"
                            | "ESCAPE"
                            | "TAB"
                            | "ARROWUP"
                            | "ARROWDOWN"
                            | "ARROWLEFT"
                            | "ARROWRIGHT"
                    );
                if !supported {
                    return Err("Unsupported hotkey".to_string());
                }
                main_key = Some(match upper.as_str() {
                    "SPACE" => "Space".to_string(),
                    "ENTER" => "Enter".to_string(),
                    "ESCAPE" => "Escape".to_string(),
                    "TAB" => "Tab".to_string(),
                    "ARROWUP" => "ArrowUp".to_string(),
                    "ARROWDOWN" => "ArrowDown".to_string(),
                    "ARROWLEFT" => "ArrowLeft".to_string(),
                    "ARROWRIGHT" => "ArrowRight".to_string(),
                    _ => upper,
                });
            }
            _ => return Err("Use one non-modifier key in the hotkey".to_string()),
        }
    }

    if !ctrl && !alt && !shift {
        return Err("Use Ctrl, Alt or Shift with the hotkey".to_string());
    }
    let Some(main_key) = main_key else {
        return Err("Choose a non-modifier key for the hotkey".to_string());
    };
    let mut tokens = Vec::new();
    if ctrl {
        tokens.push("Ctrl".to_string());
    }
    if alt {
        tokens.push("Alt".to_string());
    }
    if shift {
        tokens.push("Shift".to_string());
    }
    tokens.push(main_key);
    let normalized = tokens.join("+");
    if matches!(
        normalized.as_str(),
        "Alt+F4" | "Alt+Tab" | "Ctrl+Escape" | "Ctrl+Shift+Escape"
    ) {
        return Err("That shortcut is reserved by Windows".to_string());
    }
    Ok(normalized)
}

fn classify_hotkey_binding(value: &str) -> Result<HotkeyBinding, String> {
    // Try to parse as controller binding first
    if let Some(binding) = controller_input::parse_controller_binding(value) {
        return Ok(HotkeyBinding::Controller(binding));
    }

    // Otherwise try as keyboard
    let normalized = normalize_hotkey(value)?;
    Ok(HotkeyBinding::Keyboard(normalized))
}

fn ensure_distinct_hotkey(candidate: &str, other: &str, other_label: &str) -> Result<(), String> {
    if !other.is_empty() && other == candidate {
        return Err(format!("That hotkey is already used by {other_label}"));
    }
    Ok(())
}

fn keyboard_hotkey_matches(stored: &str, pressed: &tauri_plugin_global_shortcut::Shortcut) -> bool {
    if stored.is_empty() {
        return false;
    }
    let Ok(HotkeyBinding::Keyboard(keyboard)) = classify_hotkey_binding(stored) else {
        return false;
    };
    keyboard
        .parse::<tauri_plugin_global_shortcut::Shortcut>()
        .is_ok_and(|parsed| parsed.id() == pressed.id())
}

fn read_hotkey_state(state: &Mutex<String>) -> String {
    match state.lock() {
        Ok(guard) => guard.clone(),
        Err(_) => String::new(),
    }
}

fn handle_global_shortcut<R: Runtime>(
    app: &AppHandle<R>,
    pressed_shortcut: &tauri_plugin_global_shortcut::Shortcut,
) {
    // HUD edit is checked first, so it keeps precedence if both stored hotkeys ever match.
    let hud_edit_state = read_hotkey_state(&app.state::<HudEditHotkeyState>().current);
    if keyboard_hotkey_matches(&hud_edit_state, pressed_shortcut) {
        trigger_hud_edit_hotkey(app);
        return;
    }

    let driver_analysis_state =
        read_hotkey_state(&app.state::<DriverAnalysisHotkeyState>().current);
    if keyboard_hotkey_matches(&driver_analysis_state, pressed_shortcut) {
        let _ = app.emit(DRIVER_ANALYSIS_HOTKEY_EVENT, ());
    }
}

// Shared by the Driver Analysis and HUD edit commands; `label` names the hotkey being
// changed and `other_label` names the other one, as they appear in user-facing errors.
fn set_hotkey_binding<R: Runtime>(
    app: &AppHandle<R>,
    action: controller_input::HotkeyAction,
    label: &str,
    state: &Mutex<String>,
    other_state: &Mutex<String>,
    other_label: &str,
    hotkey: &str,
) -> Result<String, String> {
    let new_binding = classify_hotkey_binding(hotkey)?;

    let new_string = match &new_binding {
        HotkeyBinding::Keyboard(k) => k.clone(),
        HotkeyBinding::Controller(c) => c.format(),
    };

    let other_value = other_state
        .lock()
        .map_err(|_| format!("{other_label} hotkey state is unavailable"))?
        .clone();
    ensure_distinct_hotkey(&new_string, &other_value, other_label)?;

    let mut current = state
        .lock()
        .map_err(|_| format!("{label} hotkey state is unavailable"))?;

    if *current == new_string {
        return Ok(new_string);
    }

    let previous = current.clone();
    let previous_binding = classify_hotkey_binding(&previous).ok();

    // Unregister previous keyboard binding if it was keyboard
    if let Some(HotkeyBinding::Keyboard(prev_kbd)) = &previous_binding {
        app.global_shortcut()
            .unregister(prev_kbd.as_str())
            .map_err(|error| format!("unable to release the previous {label} hotkey: {error}"))?;
    }

    match &new_binding {
        HotkeyBinding::Keyboard(new_kbd) => {
            // Register new keyboard binding
            if let Err(error) = app.global_shortcut().register(new_kbd.as_str()) {
                // Rollback to previous
                if let Some(HotkeyBinding::Keyboard(prev_kbd)) = &previous_binding {
                    let _ = app.global_shortcut().register(prev_kbd.as_str());
                }
                return Err(format!(
                    "unable to register {new_kbd}; choose another hotkey: {error}"
                ));
            }
            controller_input::set_active_binding(action, None)?;
        }
        HotkeyBinding::Controller(new_ctrl) => {
            controller_input::set_active_binding(action, Some(*new_ctrl))?;
        }
    }

    *current = new_string.clone();
    Ok(new_string)
}

fn clear_hotkey_binding<R: Runtime>(
    app: &AppHandle<R>,
    action: controller_input::HotkeyAction,
    label: &str,
    state: &Mutex<String>,
) -> Result<(), String> {
    let mut current = state
        .lock()
        .map_err(|_| format!("{label} hotkey state is unavailable"))?;

    if current.is_empty() {
        return Ok(());
    }

    if let Ok(HotkeyBinding::Keyboard(keyboard)) = classify_hotkey_binding(&current) {
        app.global_shortcut()
            .unregister(keyboard.as_str())
            .map_err(|error| format!("unable to release the {label} hotkey: {error}"))?;
    }

    controller_input::set_active_binding(action, None)?;
    *current = String::new();
    Ok(())
}

#[tauri::command]
fn set_driver_analysis_hotkey(
    app: AppHandle,
    state: State<DriverAnalysisHotkeyState>,
    hud_edit: State<HudEditHotkeyState>,
    hotkey: String,
) -> Result<String, String> {
    set_hotkey_binding(
        &app,
        controller_input::HotkeyAction::DriverAnalysis,
        "Driver Analysis",
        &state.current,
        &hud_edit.current,
        "HUD edit",
        &hotkey,
    )
}

#[tauri::command]
fn clear_driver_analysis_hotkey(
    app: AppHandle,
    state: State<DriverAnalysisHotkeyState>,
) -> Result<(), String> {
    clear_hotkey_binding(
        &app,
        controller_input::HotkeyAction::DriverAnalysis,
        "Driver Analysis",
        &state.current,
    )
}

pub(crate) fn eval_main<R: Runtime>(app: &AppHandle<R>, script: &str) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main HUD window is not available".to_string());
    };

    window.eval(script).map_err(|error| error.to_string())
}

pub(crate) fn trigger_hud_edit_hotkey<R: Runtime>(app: &AppHandle<R>) {
    let _ = eval_main(app, "window.HudLayout?.toggleEditSession?.()");
}

#[tauri::command]
fn set_hud_edit_hotkey(
    app: AppHandle,
    state: State<HudEditHotkeyState>,
    driver_analysis: State<DriverAnalysisHotkeyState>,
    hotkey: String,
) -> Result<String, String> {
    set_hotkey_binding(
        &app,
        controller_input::HotkeyAction::HudEdit,
        "HUD edit",
        &state.current,
        &driver_analysis.current,
        "Driver Analysis",
        &hotkey,
    )
}

#[tauri::command]
fn clear_hud_edit_hotkey(app: AppHandle, state: State<HudEditHotkeyState>) -> Result<(), String> {
    clear_hotkey_binding(
        &app,
        controller_input::HotkeyAction::HudEdit,
        "HUD edit",
        &state.current,
    )
}

#[tauri::command]
fn set_window_edit_mode(app: AppHandle, enabled: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    set_window_interaction(&window, enabled)?;
    *app.state::<HudWindowShapeState>()
        .editing
        .lock()
        .expect("HUD window shape state poisoned") = enabled;
    if let Some(display) = current_hud_display(&app)? {
        apply_hud_window_shape(&app, &window, &display)?;
    }
    emit_hud_stage(&app)
}

const LAYOUT_TARGET_NAMES: [&str; 9] = [
    "delta", "hud", "shiftBar", "tires", "pedals", "steering", "gear", "engine", "history",
];

fn is_valid_layout_target(target: &str) -> bool {
    LAYOUT_TARGET_NAMES.contains(&target)
}

#[tauri::command]
fn notify_layout_state(app: AppHandle, target: String, editing: bool) -> Result<(), String> {
    if !is_valid_layout_target(&target) {
        return Err("unknown layout target".to_string());
    }

    let value = if editing { "true" } else { "false" };
    let script = format!(
        "window.SettingsController?.setLayoutEditingState?.('{}', {})",
        target, value
    );

    if let Some(settings) = app.get_webview_window("settings") {
        settings.eval(&script).map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn layout_action(app: AppHandle, action: String, target: String) -> Result<(), String> {
    // Actions that ignore target and handle global layout state
    let script = match action.as_str() {
        "start" => "window.HudLayout?.startEditSession?.()",
        "reset_all" => "window.HudLayout?.resetAllPositions?.()",
        _ => {
            // Actions that require target validation
            if !is_valid_layout_target(&target) {
                return Err("unknown layout target".to_string());
            }

            match action.as_str() {
                "edit" => match target.as_str() {
                    "delta" => "window.HudLayout?.enterEditMode?.('delta')",
                    "hud" => "window.HudLayout?.enterEditMode?.('hud')",
                    "shiftBar" => "window.HudLayout?.enterEditMode?.('shiftBar')",
                    "tires" => "window.HudLayout?.enterEditMode?.('tires')",
                    "pedals" => "window.HudLayout?.enterEditMode?.('pedals')",
                    "steering" => "window.HudLayout?.enterEditMode?.('steering')",
                    "gear" => "window.HudLayout?.enterEditMode?.('gear')",
                    "engine" => "window.HudLayout?.enterEditMode?.('engine')",
                    "history" => "window.HudLayout?.enterEditMode?.('history')",
                    _ => unreachable!(),
                },
                "save" => "window.HudLayout?.savePosition?.()",
                "cancel" => "window.HudLayout?.cancelEditMode?.()",
                "reset" => match target.as_str() {
                    "delta" => "window.HudLayout?.resetPosition?.('delta')",
                    "hud" => "window.HudLayout?.resetPosition?.('hud')",
                    "shiftBar" => "window.HudLayout?.resetPosition?.('shiftBar')",
                    "tires" => "window.HudLayout?.resetPosition?.('tires')",
                    "pedals" => "window.HudLayout?.resetPosition?.('pedals')",
                    "steering" => "window.HudLayout?.resetPosition?.('steering')",
                    "gear" => "window.HudLayout?.resetPosition?.('gear')",
                    "engine" => "window.HudLayout?.resetPosition?.('engine')",
                    "history" => "window.HudLayout?.resetPosition?.('history')",
                    _ => unreachable!(),
                },
                _ => return Err("unknown layout action".to_string()),
            }
        }
    };

    eval_main(&app, script)
}

#[tauri::command]
fn set_layout_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let safe_mode = match mode.as_str() {
        "grouped" | "freeform" => mode,
        _ => return Err("unknown HUD layout mode".to_string()),
    };
    eval_main(
        &app,
        &format!("window.HudLayout?.setMode?.('{}')", safe_mode),
    )
}

const HUD_COMPONENT_NAMES: [&str; 6] = ["tires", "pedals", "steering", "gear", "engine", "history"];
const OVERLAY_COMPONENT_NAMES: [&str; 3] = ["delta", "hud", "shiftBar"];

// Only these HUD widgets can be shown or hidden through set_hud_visibility.
fn is_hud_component(name: &str) -> bool {
    HUD_COMPONENT_NAMES.contains(&name)
}

// Only these overlay switches can be set through set_overlay_visibility.
fn is_overlay_component(name: &str) -> bool {
    OVERLAY_COMPONENT_NAMES.contains(&name)
}

#[tauri::command]
fn set_hud_visibility(app: AppHandle, component: String, visible: bool) -> Result<(), String> {
    if !is_hud_component(&component) {
        return Err("unknown HUD component".to_string());
    }
    let value = if visible { "true" } else { "false" };
    let script = format!(
        "window.HudPreferences?.setVisibility?.('{}', {})",
        component, value
    );
    eval_main(&app, &script)
}

#[tauri::command]
fn set_overlay_visibility(app: AppHandle, component: String, visible: bool) -> Result<(), String> {
    if !is_overlay_component(&component) {
        return Err("unknown overlay component".to_string());
    }
    let value = if visible { "true" } else { "false" };
    let script = format!(
        "window.HudPreferences?.setOverlayVisibility?.('{}', {})",
        component, value
    );
    eval_main(&app, &script)
}

#[tauri::command]
fn set_display_preferences(
    app: AppHandle,
    speed_unit: String,
    redline_brightness: u8,
    shift_light_brightness: u8,
    fdc_shift_light_enabled: bool,
    show_hud_with_telemetry: bool,
    hud_opacity: u8,
) -> Result<(), String> {
    let safe_speed_unit = match speed_unit.as_str() {
        "kmh" | "mph" => speed_unit,
        _ => return Err("unknown speed unit".to_string()),
    };
    if redline_brightness > 100 {
        return Err("Redline brightness must be between 0 and 100".to_string());
    }
    if shift_light_brightness > 100 {
        return Err("FDC Shift Light brightness must be between 0 and 100".to_string());
    }
    if !(1..=100).contains(&hud_opacity) {
        return Err("HUD opacity must be between 1 and 100".to_string());
    }

    let script = format!(
        "window.HudOverlay?.setDisplayPreferences?.({{ speedUnit: '{}', redlineBrightness: {}, shiftLightBrightness: {}, fdcShiftLightEnabled: {}, showHudWithTelemetry: {}, hudOpacity: {} }})",
        safe_speed_unit,
        redline_brightness,
        shift_light_brightness,
        fdc_shift_light_enabled,
        show_hud_with_telemetry,
        hud_opacity
    );
    eval_main(&app, &script)
}

#[tauri::command]
fn set_configuration_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
    let Some(window) = app.get_webview_window("settings") else {
        return Err("Configuration window is not available".to_string());
    };
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| format!("unable to update Configuration window priority: {error}"))
}

#[tauri::command]
fn set_settings_window_context(app: AppHandle, context: String) -> Result<(), String> {
    let Some(context_label) = settings_window_context_label(&context) else {
        return Err("unknown Configuration window context".to_string());
    };
    let Some(window) = app.get_webview_window("settings") else {
        return Err("Configuration window is not available".to_string());
    };
    let title = settings_window_title(context_label);
    window
        .set_title(&title)
        .map_err(|error| format!("unable to update Configuration window title: {error}"))
}

#[tauri::command]
fn sync_route_status(app: AppHandle) -> Result<(), String> {
    eval_main(&app, "window.HudOverlay?.syncRouteStatus?.()")
}

#[tauri::command]
fn sync_shift_light_status(app: AppHandle) -> Result<(), String> {
    eval_main(&app, "window.HudOverlay?.syncShiftLightStatus?.()")
}

const FDC_REPOSITORY_URL: &str = "https://github.com/kv199/fdc-application";

fn feedback_url(kind: &str, version: &str) -> Option<String> {
    match kind {
        "bug" => Some(format!(
            "{FDC_REPOSITORY_URL}/issues/new?template=bug_report.yml&version={version}"
        )),
        "idea" => Some(format!(
            "{FDC_REPOSITORY_URL}/discussions/new?category=ideas"
        )),
        "question" => Some(format!("{FDC_REPOSITORY_URL}/discussions/new?category=q-a")),
        _ => None,
    }
}

#[tauri::command]
fn open_feedback_link(app: AppHandle, kind: String) -> Result<(), String> {
    let url = feedback_url(&kind, env!("CARGO_PKG_VERSION"))
        .ok_or_else(|| format!("Unknown feedback link: {kind}"))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("unable to open the feedback page: {error}"))
}

#[tauri::command]
fn list_hud_displays(
    app: AppHandle,
    state: State<'_, HudDisplayRuntimeState>,
) -> Result<HudDisplayList, String> {
    let displays = hud_display_options(&app).map_err(|error| error.to_string())?;
    let saved_missing = load_hud_display_state(&app)
        .is_some_and(|saved| find_saved_hud_display(&saved, &displays).is_none());
    let selected = state
        .current
        .lock()
        .expect("HUD display state poisoned")
        .clone();
    Ok(HudDisplayList {
        displays,
        selected,
        saved_missing,
    })
}

#[tauri::command]
fn set_hud_display(app: AppHandle, name: String) -> Result<(), String> {
    let displays = hud_display_options(&app).map_err(|error| error.to_string())?;
    let display = displays
        .iter()
        .find(|display| display.name == name)
        .ok_or_else(|| "This monitor is no longer connected".to_string())?;
    place_hud_window(&app, display).map_err(|error| error.to_string())?;
    persist_hud_display(&app, display)
        .map_err(|error| format!("unable to save the HUD monitor: {error}"))
}

fn validate_hud_window_bounds(bounds: HudWindowBounds) -> Result<HudWindowBounds, String> {
    let values = [bounds.left, bounds.top, bounds.width, bounds.height];
    if !values.iter().all(|value| value.is_finite()) {
        return Err("HUD window bounds must be finite numbers".to_string());
    }
    if bounds.width <= 0.0 || bounds.height <= 0.0 {
        return Err("HUD window bounds must have a positive size".to_string());
    }
    Ok(bounds)
}

/// Stores the visible HUD rectangle, or `None` for the whole monitor, and
/// applies it unless the layout is being edited.
#[tauri::command]
fn set_hud_window_bounds(app: AppHandle, bounds: Option<HudWindowBounds>) -> Result<(), String> {
    let bounds = bounds.map(validate_hud_window_bounds).transpose()?;
    *app.state::<HudWindowShapeState>()
        .bounds
        .lock()
        .expect("HUD window shape state poisoned") = bounds;

    let editing = *app
        .state::<HudWindowShapeState>()
        .editing
        .lock()
        .expect("HUD window shape state poisoned");
    if !editing
        && let Some(window) = app.get_webview_window("main")
        && let Some(display) = current_hud_display(&app).map_err(|error| error.to_string())?
    {
        apply_hud_window_shape(&app, &window, &display).map_err(|error| error.to_string())?;
    }
    emit_hud_stage(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_hud_stage(app: AppHandle) -> HudStage {
    current_hud_stage(&app).ok().flatten().unwrap_or_default()
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        handle_global_shortcut(app, shortcut);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(DirectSourceState::default())
        .manage(DriverAnalysisHotkeyState::default())
        .manage(HudEditHotkeyState::default())
        .manage(HudDisplayRuntimeState::default())
        .manage(HudWindowShapeState::default())
        .invoke_handler(tauri::generate_handler![
            set_window_edit_mode,
            notify_layout_state,
            layout_action,
            set_layout_mode,
            set_hud_visibility,
            set_overlay_visibility,
            set_display_preferences,
            set_configuration_always_on_top,
            set_settings_window_context,
            set_driver_analysis_hotkey,
            clear_driver_analysis_hotkey,
            set_hud_edit_hotkey,
            clear_hud_edit_hotkey,
            controller_input::start_controller_capture,
            controller_input::stop_controller_capture,
            create_driver_analysis_recording,
            create_driver_analysis_session,
            append_driver_analysis_samples,
            finalize_driver_analysis_session,
            load_driver_analysis_samples,
            load_driver_analysis_checks,
            reanalyze_driver_analysis_session,
            save_driver_analysis_stats,
            load_driver_analysis_sessions,
            delete_driver_analysis_session,
            delete_driver_analysis_recording,
            discard_driver_analysis_session,
            discard_driver_analysis_recording,
            export_driver_analysis_recording,
            sync_route_status,
            sync_shift_light_status,
            get_app_version,
            open_feedback_link,
            start_direct_source,
            stop_direct_source,
            retry_direct_source,
            resolve_shift_light_config,
            load_shift_light_calibration,
            save_shift_light_calibration,
            clear_shift_light_config,
            reset_shift_light,
            create_event,
            load_events,
            load_event,
            rename_event,
            delete_event,
            record_event_run,
            append_event_run_lap,
            update_event_run_result,
            load_event_runs,
            load_event_run,
            load_event_absolute_best,
            load_event_theoretical_best,
            record_garage_vehicle,
            load_garage_snapshot,
            load_garage,
            rename_garage_car,
            list_hud_displays,
            set_hud_display,
            set_hud_window_bounds,
            get_hud_stage,
            get_hud_rendering,
            set_hud_rendering,
            quit_app
        ])
        .on_window_event(|window, event| match window.label() {
            "settings" => {
                if matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_)) {
                    let app = window.app_handle();
                    let result = settings_window_state(window)
                        .and_then(|state| persist_settings_window_state(&app, state));
                    if let Err(error) = result {
                        eprintln!("unable to persist Configuration window state: {error}");
                    }
                    return;
                }

                // Configuration asks before quitting; its QUIT answer calls quit_app.
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Some(settings) = window.app_handle().get_webview_window("settings") {
                        let _ = settings.eval("window.SettingsController?.requestQuit?.()");
                    }
                }
            }
            "main" => {
                if matches!(
                    event,
                    WindowEvent::Moved(_)
                        | WindowEvent::Resized(_)
                        | WindowEvent::ScaleFactorChanged { .. }
                ) && let Err(error) = follow_hud_window_monitor(window.app_handle())
                {
                    eprintln!("unable to fit the HUD to its monitor: {error}");
                }
            }
            _ => {}
        })
        .setup(|app| {
            // Both webviews share one WebView2 environment, so they must start
            // with the same browser arguments.
            let renderer = load_hud_renderer(app.handle());
            app.manage(ActiveHudRenderer(renderer));
            for config in app.config().app.windows.clone() {
                let mut builder = WebviewWindowBuilder::from_config(app.handle(), &config)?;
                if let Some(args) = hud_rendering_browser_args(renderer) {
                    builder = builder.additional_browser_args(args);
                }
                builder.build()?;
            }

            let window = app
                .get_webview_window("main")
                .expect("main overlay window must exist");
            let settings = app
                .get_webview_window("settings")
                .expect("settings window must exist");

            restore_settings_window_state(app.handle(), &settings)?;
            if let Err(error) = open_shift_light_db(app.handle())
                .and_then(|connection| recover_driver_analysis_sessions_in_connection(&connection))
            {
                eprintln!("unable to recover Driver Analysis sessions: {error}");
            }

            let displays = hud_display_options(app.handle())?;
            let saved_display = load_hud_display_state(app.handle());
            if let Some(index) = choose_hud_display(saved_display.as_ref(), &displays) {
                place_hud_window(app.handle(), &displays[index])?;
            }

            let menu = MenuBuilder::new(app)
                .text("settings", "Configuration")
                .separator()
                .text("quit", "Quit")
                .build()?;

            let mut tray = TrayIconBuilder::with_id("hud-tray")
                .menu(&menu)
                .tooltip("FDC")
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                        return;
                    }

                    if event.id().as_ref() == "settings" {
                        let _ = show_settings(app);
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }

            tray.build(app)?;
            set_window_interaction(&window, false)?;
            window.show()?;

            show_settings(app.handle())?;

            controller_input::setup_controller_input(app.handle().clone());

            let _ = settings;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run FDC");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_default_configuration_window_state_and_rejects_unsafe_sizes() {
        let default = SettingsWindowState {
            width: SETTINGS_DEFAULT_WIDTH,
            height: SETTINGS_DEFAULT_HEIGHT,
            x: None,
            y: None,
        };
        assert!(is_valid_settings_window_state(default));
        assert!(!is_valid_settings_window_state(SettingsWindowState {
            width: SETTINGS_MIN_WIDTH - 1,
            height: SETTINGS_DEFAULT_HEIGHT,
            x: None,
            y: None,
        }));
        assert!(!is_valid_settings_window_state(SettingsWindowState {
            width: SETTINGS_DEFAULT_WIDTH,
            height: SETTINGS_MAX_HEIGHT + 1,
            x: None,
            y: None,
        }));
    }

    #[test]
    fn hud_rendering_defaults_to_gpu_and_cpu_disables_gpu_with_wry_defaults() {
        assert_eq!(
            parse_hud_renderer(r#"{"renderer":"cpu"}"#),
            HudRenderer::Cpu
        );
        assert_eq!(
            parse_hud_renderer(r#"{"renderer":"gpu"}"#),
            HudRenderer::Gpu
        );
        assert_eq!(
            parse_hud_renderer(r#"{"renderer":"vulkan"}"#),
            HudRenderer::Gpu
        );
        assert_eq!(parse_hud_renderer("not json"), HudRenderer::Gpu);
        assert_eq!(
            serde_json::to_string(&HudRenderingState {
                renderer: HudRenderer::Cpu
            })
            .unwrap(),
            r#"{"renderer":"cpu"}"#
        );

        assert_eq!(hud_rendering_browser_args(HudRenderer::Gpu), None);
        let args = hud_rendering_browser_args(HudRenderer::Cpu).unwrap();
        assert!(args.split(' ').any(|arg| arg == "--disable-gpu"));
        assert!(args.contains("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"));
    }

    #[test]
    fn exposes_the_compiled_cargo_package_version() {
        assert_eq!(get_app_version(), env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn every_configuration_context_has_a_window_title_label() {
        let labels = [
            ("hud", "HUD"),
            ("driver-analysis", "DRIVER ANALYSIS"),
            ("garage", "GARAGE"),
            ("events", "EVENTS"),
            ("shift-light", "SHIFT LIGHT"),
            ("settings", "SETTINGS"),
        ];
        for (context, label) in labels {
            assert_eq!(settings_window_context_label(context), Some(label));
        }
        for context in ["", "HUD", "telemetry", "driver_analysis"] {
            assert_eq!(
                settings_window_context_label(context),
                None,
                "context {context:?}"
            );
        }
    }

    #[test]
    fn settings_window_title_names_the_section_and_build_version_without_game_branding() {
        assert_eq!(
            settings_window_title("HUD"),
            format!("FDC · HUD · v{}", env!("CARGO_PKG_VERSION"))
        );
        for context in [
            "hud",
            "driver-analysis",
            "garage",
            "events",
            "shift-light",
            "settings",
        ] {
            let title = settings_window_title(context);
            assert!(title.starts_with("FDC · "), "{title}");
            assert!(!title.contains("Forza"), "{title}");
        }
    }

    #[test]
    fn hud_component_whitelist_is_exactly_the_compact_widgets() {
        assert_eq!(
            HUD_COMPONENT_NAMES,
            ["tires", "pedals", "steering", "gear", "engine", "history"]
        );
        for name in HUD_COMPONENT_NAMES {
            assert!(is_hud_component(name), "missing HUD component: {name}");
        }
        for name in ["", "delta", "hud", "shiftBar", "Engine", "telemetry"] {
            assert!(
                !is_hud_component(name),
                "unexpected HUD component: {name:?}"
            );
        }
    }

    #[test]
    fn overlay_component_whitelist_is_exactly_the_three_switches() {
        assert_eq!(OVERLAY_COMPONENT_NAMES, ["delta", "hud", "shiftBar"]);
        for name in OVERLAY_COMPONENT_NAMES {
            assert!(
                is_overlay_component(name),
                "missing overlay component: {name}"
            );
        }
        for name in ["", "tires", "engine", "shiftbar"] {
            assert!(
                !is_overlay_component(name),
                "unexpected overlay component: {name:?}"
            );
        }
    }

    #[test]
    fn layout_target_whitelist_is_the_overlay_switches_plus_the_hud_widgets() {
        let expected = [
            "delta", "hud", "shiftBar", "tires", "pedals", "steering", "gear", "engine", "history",
        ];
        assert_eq!(LAYOUT_TARGET_NAMES, expected);
        for target in expected {
            assert!(
                is_valid_layout_target(target),
                "missing layout target: {target}"
            );
        }
        assert!(!is_valid_layout_target("telemetry"));
        assert!(!is_valid_layout_target(""));
    }

    #[test]
    fn feedback_urls_are_fixed_and_prefill_the_bug_version() {
        let version = "7.20.57";
        let bug_url = feedback_url("bug", version).unwrap();
        assert_eq!(
            bug_url,
            "https://github.com/kv199/fdc-application/issues/new?template=bug_report.yml&version=7.20.57"
        );

        let idea_url = feedback_url("idea", version).unwrap();
        assert_eq!(
            idea_url,
            "https://github.com/kv199/fdc-application/discussions/new?category=ideas"
        );

        let question_url = feedback_url("question", version).unwrap();
        assert_eq!(
            question_url,
            "https://github.com/kv199/fdc-application/discussions/new?category=q-a"
        );

        assert_eq!(feedback_url("https://example.com", "1.0.0"), None);
        assert_eq!(feedback_url("", "1.0.0"), None);
        assert_eq!(feedback_url("BUG", "1.0.0"), None);
    }

    #[test]
    fn driver_analysis_hotkeys_require_a_modifier_and_reject_windows_shortcuts() {
        assert_eq!(
            normalize_hotkey("Shift+Ctrl+f9"),
            Ok("Ctrl+Shift+F9".to_string())
        );
        assert!(normalize_hotkey("F9").is_err());
        assert!(normalize_hotkey("Win+R").is_err());
        assert!(normalize_hotkey("Alt+F4").is_err());
    }

    #[test]
    fn classify_hotkey_binding_recognizes_keyboard_and_controller() {
        // Keyboard binding
        match classify_hotkey_binding("Shift+Ctrl+f9") {
            Ok(HotkeyBinding::Keyboard(k)) => {
                assert_eq!(k, "Ctrl+Shift+F9");
            }
            _ => panic!("Expected keyboard binding"),
        }

        // Controller binding
        match classify_hotkey_binding("Controller:346E:0006:116") {
            Ok(HotkeyBinding::Controller(c)) => {
                assert_eq!(c.vendor_id, 0x346E);
                assert_eq!(c.product_id, 0x0006);
                assert_eq!(c.button, 116);
            }
            _ => panic!("Expected controller binding"),
        }

        // Controller binding case insensitive prefix
        match classify_hotkey_binding("controller:346e:0006:116") {
            Ok(HotkeyBinding::Controller(_)) => {}
            _ => panic!("Expected controller binding"),
        }
    }

    #[test]
    fn ensure_distinct_hotkey_rejects_duplicates_and_allows_different_values() {
        assert!(
            ensure_distinct_hotkey("Ctrl+Shift+F9", "Ctrl+Shift+F9", "Driver Analysis").is_err()
        );
        assert!(
            ensure_distinct_hotkey("Ctrl+Shift+F9", "Ctrl+Shift+F10", "Driver Analysis").is_ok()
        );
        assert!(ensure_distinct_hotkey("Ctrl+Shift+F9", "", "Driver Analysis").is_ok());
    }

    #[test]
    fn keyboard_hotkey_matches_only_the_stored_keyboard_binding() {
        let pressed = "Ctrl+Shift+F9"
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .unwrap();
        assert!(keyboard_hotkey_matches("Ctrl+Shift+F9", &pressed));
        assert!(!keyboard_hotkey_matches("Ctrl+Shift+F10", &pressed));
        assert!(!keyboard_hotkey_matches("", &pressed));
        assert!(!keyboard_hotkey_matches(
            "Controller:346E:0006:116",
            &pressed
        ));
    }

    #[test]
    fn configuration_window_titles_use_known_sections_and_the_compiled_version() {
        assert_eq!(settings_window_context_label("hud"), Some("HUD"));
        assert_eq!(
            settings_window_context_label("driver-analysis"),
            Some("DRIVER ANALYSIS")
        );
        assert_eq!(settings_window_context_label("garage"), Some("GARAGE"));
        assert_eq!(settings_window_context_label("events"), Some("EVENTS"));
        assert_eq!(
            settings_window_context_label("shift-light"),
            Some("SHIFT LIGHT")
        );
        assert_eq!(settings_window_context_label("settings"), Some("SETTINGS"));
        assert_eq!(settings_window_context_label("Forza Horizon 6"), None);
        assert_eq!(
            settings_window_title("GARAGE"),
            format!("FDC · GARAGE · v{}", get_app_version())
        );
    }

    #[test]
    fn serializes_configuration_window_state_for_persistence() {
        let state = SettingsWindowState {
            width: 1024,
            height: 768,
            x: Some(-1920),
            y: Some(48),
        };
        let restored =
            serde_json::from_str::<SettingsWindowState>(&serde_json::to_string(&state).unwrap())
                .unwrap();
        assert_eq!(restored.width, 1024);
        assert_eq!(restored.x, Some(-1920));
        assert_eq!(restored.y, Some(48));
    }

    #[test]
    fn accepts_legacy_configuration_window_size_without_position() {
        let state =
            serde_json::from_str::<SettingsWindowState>(r#"{"width":1024,"height":768}"#).unwrap();
        assert_eq!(state.x, None);
        assert_eq!(state.y, None);
    }

    #[test]
    fn restores_positions_only_when_their_top_left_is_on_a_monitor() {
        let monitor_position = PhysicalPosition::new(-1920, 0);
        let monitor_size = PhysicalSize::new(1920, 1080);
        assert!(is_position_on_monitor(
            PhysicalPosition::new(-1200, 400),
            monitor_position,
            monitor_size
        ));
        assert!(!is_position_on_monitor(
            PhysicalPosition::new(0, 400),
            monitor_position,
            monitor_size
        ));
    }

    fn hud_display(name: &str, x: i32, width: u32, height: u32, primary: bool) -> HudDisplayOption {
        HudDisplayOption {
            name: name.to_string(),
            label: String::new(),
            x,
            y: 0,
            width,
            height,
            primary,
        }
    }

    #[test]
    fn numbers_hud_displays_from_the_windows_monitor_name() {
        assert_eq!(hud_display_number(r"\\.\DISPLAY1"), Some(1));
        assert_eq!(hud_display_number(r"\\.\DISPLAY12"), Some(12));
        assert_eq!(hud_display_number("Generic Monitor"), None);
        assert_eq!(hud_display_number(""), None);
    }

    #[test]
    fn labels_hud_displays_with_resolution_and_primary_suffix() {
        assert_eq!(
            hud_display_label(1, 3840, 2160, true),
            "Display 1 · 3840 × 2160 · Primary"
        );
        assert_eq!(
            hud_display_label(2, 2560, 1440, false),
            "Display 2 · 2560 × 1440"
        );
    }

    #[test]
    fn chooses_the_saved_hud_display_by_name_then_position_then_primary() {
        let displays = [
            hud_display(r"\\.\DISPLAY1", 0, 3840, 2160, true),
            hud_display(r"\\.\DISPLAY2", 3840, 2560, 1440, false),
        ];
        let saved = |name: &str, x: i32, width: u32, height: u32| HudDisplayState {
            name: name.to_string(),
            x,
            y: 0,
            width,
            height,
        };

        let by_name = saved(r"\\.\DISPLAY2", 0, 1, 1);
        assert_eq!(choose_hud_display(Some(&by_name), &displays), Some(1));
        let by_position = saved(r"\\.\DISPLAY9", 3840, 2560, 1440);
        assert_eq!(choose_hud_display(Some(&by_position), &displays), Some(1));
        let missing = saved(r"\\.\DISPLAY9", 9999, 1920, 1080);
        assert_eq!(find_saved_hud_display(&missing, &displays), None);
        assert_eq!(choose_hud_display(Some(&missing), &displays), Some(0));
        assert_eq!(choose_hud_display(None, &displays), Some(0));
    }

    #[test]
    fn falls_back_to_the_first_hud_display_without_a_primary() {
        let displays = [
            hud_display(r"\\.\DISPLAY1", 0, 1920, 1080, false),
            hud_display(r"\\.\DISPLAY2", 1920, 2560, 1440, false),
        ];
        assert_eq!(choose_hud_display(None, &displays), Some(0));
        assert_eq!(choose_hud_display(None, &[]), None);
    }

    fn hud_monitor_at(x: i32, y: i32, width: u32, height: u32) -> HudDisplayOption {
        HudDisplayOption {
            name: format!("monitor at {x},{y}"),
            label: String::new(),
            x,
            y,
            width,
            height,
            primary: false,
        }
    }

    fn hud_bounds(left: f64, top: f64, width: f64, height: f64) -> HudWindowBounds {
        HudWindowBounds {
            left,
            top,
            width,
            height,
        }
    }

    #[test]
    fn covers_the_whole_monitor_while_editing_or_without_bounds() {
        let monitor = hud_monitor_at(0, 0, 2560, 1440);
        let whole = (PhysicalPosition::new(0, 0), PhysicalSize::new(2560, 1440));
        let bounds = Some(hud_bounds(100.0, 50.0, 300.0, 200.0));

        assert_eq!(hud_window_rect(&monitor, None, false), whole);
        assert_eq!(hud_window_rect(&monitor, bounds, true), whole);
    }

    #[test]
    fn shrinks_the_hud_window_to_its_bounds() {
        let monitor = hud_monitor_at(0, 0, 2560, 1440);
        let bounds = Some(hud_bounds(100.0, 50.0, 300.0, 200.0));

        assert_eq!(
            hud_window_rect(&monitor, bounds, false),
            (PhysicalPosition::new(100, 50), PhysicalSize::new(300, 200))
        );
    }

    #[test]
    fn rounds_fractional_hud_bounds_outward() {
        let monitor = hud_monitor_at(0, 0, 2560, 1440);
        // 15.3 floors to 15 and 15.3 + 150.3 = 165.6 ceils to 166; a 0.75 high
        // span keeps one pixel.
        let bounds = Some(hud_bounds(15.3, 0.0, 150.3, 0.75));

        assert_eq!(
            hud_window_rect(&monitor, bounds, false),
            (PhysicalPosition::new(15, 0), PhysicalSize::new(151, 1))
        );
    }

    #[test]
    fn clamps_hud_bounds_inside_the_monitor() {
        let monitor = hud_monitor_at(0, 0, 2560, 1440);
        let partly_outside = Some(hud_bounds(-50.0, 1400.0, 200.0, 100.0));
        assert_eq!(
            hud_window_rect(&monitor, partly_outside, false),
            (PhysicalPosition::new(0, 1400), PhysicalSize::new(150, 40))
        );

        // Bounds entirely right of the monitor keep a 1x1 window on its edge.
        let outside = Some(hud_bounds(3000.0, 10.0, 100.0, 100.0));
        assert_eq!(
            hud_window_rect(&monitor, outside, false),
            (PhysicalPosition::new(2559, 10), PhysicalSize::new(1, 100))
        );
    }

    #[test]
    fn places_hud_bounds_on_monitors_with_offset_positions() {
        let right_monitor = hud_monitor_at(2560, 0, 1920, 1080);
        let left_monitor = hud_monitor_at(-1920, 0, 1920, 1080);
        let bounds = Some(hud_bounds(100.0, 50.0, 300.0, 200.0));

        assert_eq!(
            hud_window_rect(&right_monitor, bounds, false),
            (PhysicalPosition::new(2660, 50), PhysicalSize::new(300, 200))
        );
        assert_eq!(
            hud_window_rect(&left_monitor, bounds, false),
            (
                PhysicalPosition::new(-1820, 50),
                PhysicalSize::new(300, 200)
            )
        );
        assert_eq!(
            hud_window_rect(
                &right_monitor,
                Some(hud_bounds(15.3, 0.0, 150.3, 0.75)),
                false
            ),
            (PhysicalPosition::new(2575, 0), PhysicalSize::new(151, 1))
        );
    }

    #[test]
    fn reports_the_hud_stage_in_physical_pixels() {
        let monitor = hud_monitor_at(2560, 0, 2560, 1440);
        let stage = hud_stage_for(&monitor, PhysicalPosition::new(3000, 300));

        assert_eq!(
            stage,
            HudStage {
                stage_width: 2560.0,
                stage_height: 1440.0,
                offset_x: 440.0,
                offset_y: 300.0,
            }
        );
    }

    #[test]
    fn rejects_hud_bounds_that_are_not_finite_or_empty() {
        assert!(validate_hud_window_bounds(hud_bounds(0.0, 0.0, f64::NAN, 10.0)).is_err());
        assert!(validate_hud_window_bounds(hud_bounds(f64::INFINITY, 0.0, 10.0, 10.0)).is_err());
        assert!(validate_hud_window_bounds(hud_bounds(0.0, 0.0, 0.0, 10.0)).is_err());
        assert!(validate_hud_window_bounds(hud_bounds(-5.0, -5.0, 10.0, 10.0)).is_ok());
    }

    #[test]
    fn deserializes_the_hud_bounds_contract() {
        let bounds: Option<HudWindowBounds> =
            serde_json::from_str(r#"{"left":1,"top":2,"width":3,"height":4}"#).unwrap();
        assert_eq!(bounds, Some(hud_bounds(1.0, 2.0, 3.0, 4.0)));
        let whole: Option<HudWindowBounds> = serde_json::from_str("null").unwrap();
        assert_eq!(whole, None);
    }
}
