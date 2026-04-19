mod activity;

use tauri_plugin_shell::ShellExt;
use tauri::Manager;

/// Resolves the ADB executable path.
/// First checks if `adb` is on PATH, otherwise falls back to the
/// known winget install location so the app works without a shell restart.
pub(crate) fn adb_path() -> String {
    // Try PATH first
    if which::which("adb").is_ok() {
        return "adb".to_string();
    }
    // Winget default install location (Windows)
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let p = format!(
            r"{}\Microsoft\WinGet\Packages\Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe\platform-tools\adb.exe",
            local
        );
        if std::path::Path::new(&p).exists() {
            return p;
        }
    }
    "adb".to_string() // final fallback
}

#[tauri::command]
async fn check_adb_connection(app: tauri::AppHandle) -> Result<String, String> {
    let output = app.shell()
        .command(&adb_path())
        .args(["devices"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn get_karoo_info(app: tauri::AppHandle) -> Result<String, String> {
    let output = app.shell()
        .command(&adb_path())
        .args(["shell", "getprop", "ro.build.display.id"])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
async fn install_package(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let output = app.shell()
        .command(&adb_path())
        .args(["install", "-r", &path])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            check_adb_connection,
            get_karoo_info,
            install_package,
            activity::sync_activities,
            activity::analyze_fit_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
