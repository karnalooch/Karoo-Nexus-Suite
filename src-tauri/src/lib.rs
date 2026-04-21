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
async fn get_github_release_apk(owner: String, repo: String) -> Result<String, String> {
    let url = format!("https://api.github.com/repos/{}/{}/releases/latest", owner, repo);
    let client = reqwest::Client::new();
    let response = client.get(url)
        .header("User-Agent", "Karoo-Nexus-Hub")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("GitHub API error: {}", response.status()));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    
    let assets = json["assets"].as_array().ok_or("No assets found in latest release")?;
    
    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        if name.ends_with(".apk") {
            return Ok(asset["browser_download_url"].as_str().unwrap_or("").to_string());
        }
    }

    Err("No APK found in the latest release assets".to_string())
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
    
    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&local_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

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
    // Background polling is silent to avoid monitor clutter
    
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
async fn launch_intent(app: tauri::AppHandle, component: String) -> Result<String, String> {
    log_interaction(app.clone(), format!("Launching Android Component: {}", component)).await;
    let args = ["shell", "am", "start", "-n", &component];
    log_adb(&app, &args);

    let output = app.shell()
        .command(&adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        log_to_nexus(&app, format!("SYSTEM :: Intent Launch Failed :: {}", err));
        Err(err)
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

#[tauri::command]
async fn inject_custom_map(app: tauri::AppHandle, local_path: String) -> Result<String, String> {
    log_interaction(app.clone(), format!("Injecting map package from {}", local_path)).await;
    
    let remote_path = "/sdcard/Download/custom_map_payload.zip";
    let args_push = ["push", &local_path, remote_path];
    log_adb(&app, &args_push);
    let output_push = app.shell().command(&adb_path()).args(args_push).output().await.map_err(|e| e.to_string())?;
    
    if !output_push.status.success() {
        return Err(format!("Failed to push map file: {}", String::from_utf8_lossy(&output_push.stderr)));
    }

    let sql_command = format!(
        "sqlite3 /data/data/io.hammerhead.offlineregionservice/databases/file_request_table \"INSERT INTO file_request_table (url, path) VALUES ('custom_inject', '{}');\"",
        remote_path
    );
    
    let args_sql = ["shell", "su", "-c", &sql_command];
    log_adb(&app, &args_sql);
    let output_sql = app.shell().command(&adb_path()).args(args_sql).output().await.map_err(|e| e.to_string())?;

    if output_sql.status.success() {
        Ok("Map successfully injected into file_request_table".to_string())
    } else {
        Err(format!("SQLite injection failed (Root required): {}", String::from_utf8_lossy(&output_sql.stderr)))
    }
}

#[tauri::command]
async fn sideload_custom_ota(app: tauri::AppHandle, local_path: String) -> Result<String, String> {
    log_interaction(app.clone(), format!("Sideloading OTA update from {}", local_path)).await;
    
    let remote_path = "/sdcard/update.zip";
    let args_push = ["push", &local_path, remote_path];
    log_adb(&app, &args_push);
    
    let output_push = app.shell().command(&adb_path()).args(args_push).output().await.map_err(|e| e.to_string())?;
    if !output_push.status.success() {
        return Err(format!("Failed to push OTA zip: {}", String::from_utf8_lossy(&output_push.stderr)));
    }

    let sql_command = format!("am broadcast -a com.mediatek.systemupdate.start_ota_update --es path {}", remote_path);
    let args_intent = ["shell", "su", "-c", &sql_command];
    
    log_adb(&app, &args_intent);
    let output_intent = app.shell().command(&adb_path()).args(args_intent).output().await.map_err(|e| e.to_string())?;

    if output_intent.status.success() {
        Ok("OTA package pushed and update broadcast sent. Check device screen.".to_string())
    } else {
        Err(format!("Failed to trigger OTA broadcast: {}", String::from_utf8_lossy(&output_intent.stderr)))
    }
}

#[tauri::command]
async fn disarm_root_detection(app: tauri::AppHandle) -> Result<String, String> {
    log_interaction(app.clone(), "Disarming Bugsnag root detection".to_string()).await;
    
    let disable_telemetry = ["shell", "su", "-c", "pm disable io.hammerhead.telemetry"];
    log_adb(&app, &disable_telemetry);
    let _ = app.shell().command(&adb_path()).args(disable_telemetry).output().await.map_err(|e| e.to_string())?;

    let rename_lib = ["shell", "su", "-c", "mv /system/lib/libbugsnag-root-detection.so /system/lib/libbugsnag-root-detection.so.bak || true"];
    log_adb(&app, &rename_lib);
    let rename_lib64 = ["shell", "su", "-c", "mv /system/lib64/libbugsnag-root-detection.so /system/lib64/libbugsnag-root-detection.so.bak || true"];
    log_adb(&app, &rename_lib64);
    
    let output_lib = app.shell().command(&adb_path()).args(rename_lib).output().await.map_err(|e| e.to_string())?;
    let _ = app.shell().command(&adb_path()).args(rename_lib64).output().await.map_err(|e| e.to_string())?;

    if output_lib.status.success() {
        Ok("Bugsnag detection neutralized successfully. Telemetry disabled.".to_string())
    } else {
        Err(format!("Failed to patch Bugsnag. Is root access granted? Error: {}", String::from_utf8_lossy(&output_lib.stderr)))
    }
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
            launch_intent,
            capture_ota_logcat,
            fetch_ota_metadata,
            get_github_release_apk,
            download_firmware,
            inject_custom_map,
            sideload_custom_ota,
            disarm_root_detection,
            activity::sync_activities,
            activity::analyze_fit_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

