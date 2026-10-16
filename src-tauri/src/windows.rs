//! Configuration and HUD windows: Configuration window state, HUD display and rendering
//! settings, HUD window placement and stage geometry, and Configuration window titles.

use std::{fs, path::PathBuf, sync::Mutex};

use crate::*;
use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, Runtime, State,
    WebviewWindow, Window,
};

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
const HUD_STAGE_EVENT: &str = "hud_stage";

pub(crate) fn set_window_interaction<R: Runtime>(
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
pub(crate) struct SettingsWindowState {
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

pub(crate) fn restore_settings_window_state<R: Runtime>(
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

pub(crate) fn settings_window_state<R: Runtime>(
    window: &Window<R>,
) -> tauri::Result<SettingsWindowState> {
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

pub(crate) fn persist_settings_window_state<R: Runtime>(
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
pub(crate) struct HudDisplayRuntimeState {
    pub(crate) current: Mutex<Option<String>>,
}

/// The visible HUD rectangle in physical pixels, relative to the top-left corner
/// of the HUD's monitor. The page converts its CSS pixels with its own
/// devicePixelRatio, which also follows the Windows text size.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub(crate) struct HudWindowBounds {
    pub(crate) left: f64,
    pub(crate) top: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Default)]
pub(crate) struct HudWindowShapeState {
    /// `None` covers the whole monitor.
    pub(crate) bounds: Mutex<Option<HudWindowBounds>>,
    pub(crate) editing: Mutex<bool>,
}

/// The monitor size and the window offset on it, in physical pixels; the page
/// maps them to CSS pixels with its own devicePixelRatio.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HudStage {
    stage_width: f64,
    stage_height: f64,
    offset_x: f64,
    offset_y: f64,
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct HudDisplayState {
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HudDisplayOption {
    pub(crate) name: String,
    label: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    primary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HudDisplayList {
    pub(crate) displays: Vec<HudDisplayOption>,
    pub(crate) selected: Option<String>,
    pub(crate) saved_missing: bool,
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

pub(crate) fn find_saved_hud_display(
    saved: &HudDisplayState,
    displays: &[HudDisplayOption],
) -> Option<usize> {
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

pub(crate) fn choose_hud_display(
    saved: Option<&HudDisplayState>,
    displays: &[HudDisplayOption],
) -> Option<usize> {
    saved
        .and_then(|saved| find_saved_hud_display(saved, displays))
        .or_else(|| displays.iter().position(|display| display.primary))
        .or_else(|| (!displays.is_empty()).then_some(0))
}

pub(crate) fn hud_display_options<R: Runtime>(
    app: &AppHandle<R>,
) -> tauri::Result<Vec<HudDisplayOption>> {
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

pub(crate) fn load_hud_display_state<R: Runtime>(app: &AppHandle<R>) -> Option<HudDisplayState> {
    let contents = fs::read_to_string(hud_display_state_path(app).ok()?).ok()?;
    serde_json::from_str(&contents).ok()
}

pub(crate) fn persist_hud_display<R: Runtime>(
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
pub(crate) enum HudRenderer {
    #[default]
    Gpu,
    Cpu,
}

#[derive(Deserialize, Serialize)]
struct HudRenderingState {
    renderer: HudRenderer,
}

/// The renderer this launch started with.
pub(crate) struct ActiveHudRenderer(pub(crate) HudRenderer);

#[derive(Serialize)]
pub(crate) struct HudRenderingStatus {
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

pub(crate) fn load_hud_renderer<R: Runtime>(app: &AppHandle<R>) -> HudRenderer {
    hud_rendering_state_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .map(|contents| parse_hud_renderer(&contents))
        .unwrap_or_default()
}

pub(crate) fn hud_rendering_browser_args(renderer: HudRenderer) -> Option<&'static str> {
    match renderer {
        HudRenderer::Gpu => None,
        HudRenderer::Cpu => Some(CPU_RENDERING_BROWSER_ARGS),
    }
}

#[tauri::command]
pub(crate) fn get_hud_rendering(
    app: AppHandle,
    active: State<'_, ActiveHudRenderer>,
) -> HudRenderingStatus {
    HudRenderingStatus {
        active: active.0,
        saved: load_hud_renderer(&app),
    }
}

#[tauri::command]
pub(crate) fn set_hud_rendering(
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
pub(crate) fn apply_hud_window_shape<R: Runtime>(
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
pub(crate) fn current_hud_display<R: Runtime>(
    app: &AppHandle<R>,
) -> tauri::Result<Option<HudDisplayOption>> {
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

pub(crate) fn current_hud_stage<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Option<HudStage>> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(None);
    };
    let Some(display) = current_hud_display(app)? else {
        return Ok(None);
    };
    Ok(Some(hud_stage_for(&display, window.outer_position()?)))
}

/// Sends the HUD geometry to the main window only.
pub(crate) fn emit_hud_stage<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(stage) = current_hud_stage(app)? {
        app.emit_to("main", HUD_STAGE_EVENT, stage)?;
    }
    Ok(())
}

pub(crate) fn place_hud_window<R: Runtime>(
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
pub(crate) fn follow_hud_window_monitor<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
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

pub(crate) fn show_settings<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
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

pub(crate) fn settings_window_context_label(context: &str) -> Option<&'static str> {
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

pub(crate) fn settings_window_title(context: &str) -> String {
    format!("FDC · {context} · v{}", get_app_version())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

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
    fn deserializes_the_hud_bounds_contract() {
        let bounds: Option<HudWindowBounds> =
            serde_json::from_str(r#"{"left":1,"top":2,"width":3,"height":4}"#).unwrap();
        assert_eq!(bounds, Some(hud_bounds(1.0, 2.0, 3.0, 4.0)));
        let whole: Option<HudWindowBounds> = serde_json::from_str("null").unwrap();
        assert_eq!(whole, None);
    }
}
