//! Commands that drive the HUD page and the Configuration window, plus app-level commands:
//! layout editing, component visibility, display preferences, feedback links, and app version.

use crate::*;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub(crate) fn set_window_edit_mode(app: AppHandle, enabled: bool) -> tauri::Result<()> {
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
pub(crate) fn notify_layout_state(
    app: AppHandle,
    target: String,
    editing: bool,
) -> Result<(), String> {
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
pub(crate) fn layout_action(app: AppHandle, action: String, target: String) -> Result<(), String> {
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
pub(crate) fn set_layout_mode(app: AppHandle, mode: String) -> Result<(), String> {
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
pub(crate) fn set_hud_visibility(
    app: AppHandle,
    component: String,
    visible: bool,
) -> Result<(), String> {
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
pub(crate) fn set_overlay_visibility(
    app: AppHandle,
    component: String,
    visible: bool,
) -> Result<(), String> {
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
pub(crate) fn set_display_preferences(
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
pub(crate) fn set_configuration_always_on_top(
    app: AppHandle,
    always_on_top: bool,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window("settings") else {
        return Err("Configuration window is not available".to_string());
    };
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| format!("unable to update Configuration window priority: {error}"))
}

#[tauri::command]
pub(crate) fn set_settings_window_context(app: AppHandle, context: String) -> Result<(), String> {
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
pub(crate) fn sync_route_status(app: AppHandle) -> Result<(), String> {
    eval_main(&app, "window.HudOverlay?.syncRouteStatus?.()")
}

#[tauri::command]
pub(crate) fn sync_shift_light_status(app: AppHandle) -> Result<(), String> {
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
pub(crate) fn open_feedback_link(app: AppHandle, kind: String) -> Result<(), String> {
    let url = feedback_url(&kind, env!("CARGO_PKG_VERSION"))
        .ok_or_else(|| format!("Unknown feedback link: {kind}"))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("unable to open the feedback page: {error}"))
}

#[tauri::command]
pub(crate) fn list_hud_displays(
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
pub(crate) fn set_hud_display(app: AppHandle, name: String) -> Result<(), String> {
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
pub(crate) fn set_hud_window_bounds(
    app: AppHandle,
    bounds: Option<HudWindowBounds>,
) -> Result<(), String> {
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
pub(crate) fn get_hud_stage(app: AppHandle) -> HudStage {
    current_hud_stage(&app).ok().flatten().unwrap_or_default()
}

#[tauri::command]
pub(crate) fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub(crate) fn get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn exposes_the_compiled_cargo_package_version() {
        assert_eq!(get_app_version(), env!("CARGO_PKG_VERSION"));
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
    fn rejects_hud_bounds_that_are_not_finite_or_empty() {
        assert!(validate_hud_window_bounds(hud_bounds(0.0, 0.0, f64::NAN, 10.0)).is_err());
        assert!(validate_hud_window_bounds(hud_bounds(f64::INFINITY, 0.0, 10.0, 10.0)).is_err());
        assert!(validate_hud_window_bounds(hud_bounds(0.0, 0.0, 0.0, 10.0)).is_err());
        assert!(validate_hud_window_bounds(hud_bounds(-5.0, -5.0, 10.0, 10.0)).is_ok());
    }
}
