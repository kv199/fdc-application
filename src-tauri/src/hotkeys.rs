//! Global shortcut bindings for Driver Analysis and the HUD edit mode: normalization,
//! keyboard and controller binding checks, and the commands that save them.

use std::sync::Mutex;

use crate::*;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

pub(crate) const DRIVER_ANALYSIS_HOTKEY_EVENT: &str = "driver_analysis_hotkey";

pub(crate) struct DriverAnalysisHotkeyState {
    current: Mutex<String>,
}

impl Default for DriverAnalysisHotkeyState {
    fn default() -> Self {
        Self {
            current: Mutex::new(String::new()),
        }
    }
}

pub(crate) struct HudEditHotkeyState {
    current: Mutex<String>,
}

impl Default for HudEditHotkeyState {
    fn default() -> Self {
        Self {
            current: Mutex::new(String::new()),
        }
    }
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

pub(crate) fn handle_global_shortcut<R: Runtime>(
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
pub(crate) fn set_driver_analysis_hotkey(
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
pub(crate) fn clear_driver_analysis_hotkey(
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

pub(crate) fn trigger_hud_edit_hotkey<R: Runtime>(app: &AppHandle<R>) {
    let _ = eval_main(app, "window.HudLayout?.toggleEditSession?.()");
}

#[tauri::command]
pub(crate) fn set_hud_edit_hotkey(
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
