use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use crate::{adb_path, log_adb};


#[tauri::command]
pub async fn sync_activities(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let backup_dir = app_dir.join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let args = ["pull", "/sdcard/Documents/Hammerhead/Activities/", backup_dir.to_str().unwrap()];
    log_adb(&app, &args);

    let output = app.shell()
        .command(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(format!("Synced to: {:?}", backup_dir))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
