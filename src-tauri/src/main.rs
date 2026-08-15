#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    AppHandle, Manager, PhysicalPosition, Runtime, WebviewWindow, menu::MenuBuilder,
    tray::TrayIconBuilder,
};

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

#[tauri::command]
fn set_window_edit_mode(app: AppHandle, enabled: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    set_window_interaction(&window, enabled)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_window_edit_mode])
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .expect("main overlay window must exist");

            if let Some(monitor) = window.primary_monitor()? {
                let monitor_position = monitor.position();
                let monitor_size = monitor.size();

                window.set_size(*monitor_size)?;
                window.set_position(PhysicalPosition::new(
                    monitor_position.x,
                    monitor_position.y,
                ))?;
            }

            let menu = MenuBuilder::new(app)
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

                    let Some(window) = app.get_webview_window("main") else {
                        return;
                    };

                    let script = match event.id().as_ref() {
                        "edit-coach" => "window.HudLayout?.enterEditMode?.()",
                        "reset-coach" => "window.HudLayout?.resetPosition?.()",
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Forza Horizon 6 HUD");
}
