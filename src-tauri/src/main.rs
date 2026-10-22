#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    AppHandle, Manager, Runtime, WebviewWindowBuilder, WindowEvent, menu::MenuBuilder,
    tray::TrayIconBuilder,
};
use tauri_plugin_global_shortcut::ShortcutState;

mod controller_input;
mod db;
mod driver_analysis;
mod driver_analysis_export;
mod events;
mod garage;
mod hotkeys;
mod hud_commands;
mod shift_lab;
mod shift_lab_export;
mod shift_light;
mod telemetry;
#[cfg(test)]
mod test_support;
mod windows;

use db::*;
use driver_analysis::*;
use events::*;
use garage::*;
use hotkeys::*;
use hud_commands::*;
use shift_light::*;
use telemetry::*;
use windows::*;

pub(crate) fn eval_main<R: Runtime>(app: &AppHandle<R>, script: &str) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("main HUD window is not available".to_string());
    };

    window.eval(script).map_err(|error| error.to_string())
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
            delete_driver_analysis_recording,
            discard_driver_analysis_session,
            discard_driver_analysis_recording,
            export_driver_analysis_recording,
            shift_lab_export::export_shift_lab_drives,
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
