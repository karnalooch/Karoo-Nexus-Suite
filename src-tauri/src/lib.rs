mod activity;

use tauri::Emitter;
use tauri_plugin_shell::ShellExt;
use futures_util::StreamExt;
use std::io::Write;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub current: u64,
    pub total: u64,
    pub percentage: f64,
}

/// Resolves the ADB executable path.
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

/// Helper to log messages to the frontend
pub(crate) fn log_to_nexus(app: &tauri::AppHandle, msg: String) {
    let _ = app.emit("nexus-log", msg);
}

/// Helper to log ADB commands to the frontend
pub(crate) fn log_adb(app: &tauri::AppHandle, args: &[&str]) {
    let cmd = format!("EXEC :: adb {}", args.join(" "));
    log_to_nexus(app, cmd);
}

#[tauri::command]
async fn log_interaction(app: tauri::AppHandle, action: String) {
    log_to_nexus(&app, format!("USER :: {}", action));
}

#[tauri::command]
async fn fetch_ota_metadata(url: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client.get(url)
        .header("User-Agent", "Karoo-Nexus-Tactical")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status() == 204 {
        return Err("No update available (204 No Content)".to_string());
    }

    let json = response.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    Ok(json)
}

#[tauri::command]
async fn download_firmware(app: tauri::AppHandle, url: String, local_path: String) -> Result<String, String> {
    log_interaction(app.clone(), format!("Initiating Tactical Download from {}", url)).await;
    log_to_nexus(&app, format!("DEBUG :: Requesting URL: {}", url));
    
    let client = reqwest::Client::builder()
        .user_agent("Hammerhead/1.0")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client.get(url.clone())
        .send()
        .await
        .map_err(|e| {
            let _ = app.emit("firmware-download-error", e.to_string());
            e.to_string()
        })?;

    let status = response.status();
    log_to_nexus(&app, format!("DEBUG :: Server Status: {}", status));

    if !status.is_success() {
        let err_text = response.text().await.unwrap_or_else(|_| "Could not read error body".to_string());
        log_to_nexus(&app, format!("DEBUG :: Server Error Body: {}", err_text));
        let err_msg = format!("Download failed with status {}: {}", status, err_text);
        let _ = app.emit("firmware-download-error", err_msg.clone());
        return Err(err_msg);
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(&local_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let percentage = (downloaded as f64 / total_size as f64) * 100.0;
            let _ = app.emit("firmware-download-progress", DownloadProgress {
                current: downloaded,
                total: total_size,
                percentage,
            });
        }
    }

    log_to_nexus(&app, format!("SYSTEM :: Download Complete :: {}", local_path));
    Ok(format!("Successfully downloaded to {}", local_path))
}

#[tauri::command]
async fn check_adb_connection(app: tauri::AppHandle) -> Result<String, String> {
    let args = ["devices"];
    log_adb(&app, &args);
    
    let output = app.shell()
        .command(&adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn get_karoo_info(app: tauri::AppHandle) -> Result<String, String> {
    let args = ["shell", "getprop", "ro.build.display.id"];
    log_adb(&app, &args);

    let output = app.shell()
        .command(&adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
async fn install_package(app: tauri::AppHandle, path: String) -> Result<String, String> {
    log_interaction(app.clone(), format!("Initiating Sideload for {}", path)).await;
    let args = ["install", "-r", &path];
    log_adb(&app, &args[..]);

    let output = app.shell()
        .command(&adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let res = String::from_utf8_lossy(&output.stdout).to_string();
        log_to_nexus(&app, format!("SYSTEM :: Sideload Success :: {}", res));
        Ok(res)
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        log_to_nexus(&app, format!("SYSTEM :: Sideload Failed :: {}", err));
        Err(err)
    }
}

#[tauri::command]
async fn list_packages(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let args = ["shell", "pm", "list", "packages", "-f"];
    log_adb(&app, &args);

    let output = app.shell()
        .command(&adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().map(|s| s.to_string()).collect())
}

#[tauri::command]
async fn pull_file(app: tauri::AppHandle, remote_path: String, local_path: String) -> Result<String, String> {
    let args = ["pull", &remote_path, &local_path];
    log_adb(&app, &args);

    let output = app.shell()
        .command(&adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(format!("Pulled {} to {}", remote_path, local_path))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
async fn capture_ota_logcat(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    log_interaction(app.clone(), "Scanning logcat for OTA update links".to_string()).await;
    
    // Check for "http" or "https" strings in a dumped logcat
    let args = ["logcat", "-d"];
    log_adb(&app, &args);

    let output = app.shell()
        .command(&adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut links = Vec::new();
    
    for line in stdout.lines() {
        if (line.contains("http://") || line.contains("https://")) && 
           (line.to_lowercase().contains("hammerhead") || line.to_lowercase().contains("ota") || line.to_lowercase().contains("amazon")) {
            links.push(line.trim().to_string());
        }
    }

    if links.is_empty() {
        log_to_nexus(&app, "SYSTEM :: No OTA links detected in current logcat dump".to_string());
    } else {
        log_to_nexus(&app, format!("SYSTEM :: Detected {} potential OTA links", links.len()));
    }

    Ok(links)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            check_adb_connection,
            get_karoo_info,
            install_package,
            log_interaction,
            list_packages,
            pull_file,
            capture_ota_logcat,
            fetch_ota_metadata,
            download_firmware,
            activity::sync_activities,
            activity::analyze_fit_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

