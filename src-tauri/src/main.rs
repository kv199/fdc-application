#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};

use tauri::{
    AppHandle, Manager, PhysicalPosition, Runtime, WebviewWindow, WindowEvent, menu::MenuBuilder,
    tray::TrayIconBuilder,
};

const SETTINGS_MARKER: &str = "settings-first-launch-complete";

fn set_window_interaction<R: Runtime>(
    window: &WebviewWindow<R>,
    enabled: bool,
) -> tauri::Result<()> {
    if enabled {
        window.set_focusable(true)?;
        window.set_ignore_cursor_events(false)?;
        window.set_focus()?;
    } else {
        window.set_ignore_cursor_events(true)?;
        window.set_focusable(false)?;
    }

    Ok(())
}

fn settings_marker_path<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(SETTINGS_MARKER))
}

fn show_settings<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("settings") else {
        return Ok(());
    };

    window.show()?;
    window.set_focus()?;
    Ok(())
}

fn eval_main<R: Runtime>(app: &AppHandle<R>, script: &str) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main HUD window is not available".to_string());
    };

    window.eval(script).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_window_edit_mode(app: AppHandle, enabled: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    set_window_interaction(&window, enabled)
}

#[tauri::command]
fn layout_action(app: AppHandle, action: String, target: String) -> Result<(), String> {
    if !["coach", "delta", "hud"].contains(&target.as_str()) {
        return Err("unknown layout target".to_string());
    }

    let script = match action.as_str() {
        "edit" => match target.as_str() {
            "coach" => "window.HudLayout?.enterEditMode?.('coach')",
            "delta" => "window.HudLayout?.enterEditMode?.('delta')",
            "hud" => "window.HudLayout?.enterEditMode?.('hud')",
            _ => unreachable!(),
        },
        "save" => "window.HudLayout?.savePosition?.()",
        "cancel" => "window.HudLayout?.cancelEditMode?.()",
        "reset" => match target.as_str() {
            "coach" => "window.HudLayout?.resetPosition?.('coach')",
            "delta" => "window.HudLayout?.resetPosition?.('delta')",
            "hud" => "window.HudLayout?.resetPosition?.('hud')",
            _ => unreachable!(),
        },
        _ => return Err("unknown layout action".to_string()),
    };

    eval_main(&app, script)
}

#[tauri::command]
fn set_hud_visibility(app: AppHandle, component: String, visible: bool) -> Result<(), String> {
    let safe_component = match component.as_str() {
        "tires" | "pedals" | "steering" | "gear" | "history" => component,
        _ => return Err("unknown HUD component".to_string()),
    };
    let value = if visible { "true" } else { "false" };
    let script = format!(
        "window.HudPreferences?.setVisibility?.('{}', {})",
        safe_component, value
    );
    eval_main(&app, &script)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_window_edit_mode,
            layout_action,
            set_hud_visibility
        ])
        .on_window_event(|window, event| {
            if window.label() != "settings" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle();
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.eval("window.HudLayout?.cancelEditMode?.()");
                }
                if let Some(settings) = app.get_webview_window("settings") {
                    let _ = settings.eval("window.SettingsController?.cancelEdit?.()");
                    let _ = settings.hide();
                }
            }
        })
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main overlay window must exist");
            let settings = app
                .get_webview_window("settings")
                .expect("settings window must exist");

            if let Some(monitor) = app.primary_monitor()? {
                let monitor_position = monitor.position();
                let monitor_size = monitor.size();

                window.set_size(*monitor_size)?;
                window.set_position(PhysicalPosition::new(
                    monitor_position.x,
                    monitor_position.y,
                ))?;
            }

            let menu = MenuBuilder::new(app)
                .text("settings", "Settings")
                .separator()
                .text("edit-coach", "Edit Coach position")
                .text("reset-coach", "Reset Coach position")
                .text("exit-edit", "Exit edit mode")
                .separator()
                .text("quit", "Quit")
                .build()?;

            let mut tray = TrayIconBuilder::with_id("hud-tray")
                .menu(&menu)
                .tooltip("Forza Horizon 6 HUD")
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                        return;
                    }

                    if event.id().as_ref() == "settings" {
                        let _ = show_settings(app);
                        return;
                    }

                    let Some(window) = app.get_webview_window("main") else {
                        return;
                    };

                    let script = match event.id().as_ref() {
                        "edit-coach" => "window.HudLayout?.enterEditMode?.('coach')",
                        "reset-coach" => "window.HudLayout?.resetPosition?.('coach')",
                        "exit-edit" => "window.HudLayout?.exitEditMode?.()",
                        _ => return,
                    };

                    let _ = window.eval(script);
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }

            tray.build(app)?;
            set_window_interaction(&window, false)?;
            window.show()?;

            let marker = settings_marker_path(app.handle())?;
            if !marker.exists() {
                show_settings(app.handle())?;
                if let Some(parent) = marker.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(marker, b"1")?;
            }

            let _ = settings;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Forza Horizon 6 HUD");
}
