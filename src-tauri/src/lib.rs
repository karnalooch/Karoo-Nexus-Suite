mod activity;

use activity::{analyze_fit_file, sync_activities};

use tauri::{Emitter, Manager};
use std::process::Command;
use tauri_plugin_shell::ShellExt;
use futures_util::StreamExt;
use std::io::{Read, Write};
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct DownloadProgress {
    pub current: u64,
    pub total: u64,
    pub percentage: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RemoteProfile {
    pub id: String,
    pub name: String,
    pub db_path: String,
    pub body: Option<String>, // Hex encoded body
}

#[derive(Deserialize)]
struct HubCatalogEntry {
    id: String,
    owner: String,
    repo: String,
}

const HUB_DATA_JSON: &str = include_str!("../../src/data/hub-data.json");

fn valid_github_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn approved_hub_repo(app_id: &str) -> Result<(String, String), String> {
    let catalog: Vec<HubCatalogEntry> = serde_json::from_str(HUB_DATA_JSON)
        .map_err(|_| "Software Hub catalog is invalid".to_string())?;
    let entry = catalog
        .into_iter()
        .find(|entry| entry.id == app_id)
        .ok_or_else(|| "Software Hub app is not approved".to_string())?;

    if !valid_github_segment(&entry.owner) || !valid_github_segment(&entry.repo) {
        return Err("Software Hub repository identifier is invalid".to_string());
    }

    Ok((entry.owner, entry.repo))
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

const DOWNLOAD_HOST_SUFFIXES: &[&str] = &[
    "hammerhead.io",
    "amazonaws.com",
    "github.com",
    "githubusercontent.com",
    "githubassets.com",
    "cloudfront.net",
];

fn host_matches_suffix(host: &str, suffix: &str) -> bool {
    host == suffix || host.ends_with(&format!(".{suffix}"))
}

fn validate_https_url(raw: &str, allowed_suffixes: &[&str]) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "Invalid download URL".to_string())?;

    if url.scheme() != "https" {
        return Err("Only HTTPS URLs are allowed".to_string());
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("Credentials in download URLs are not allowed".to_string());
    }

    if url.port().is_some_and(|port| port != 443) {
        return Err("Only the standard HTTPS port is allowed".to_string());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "Download URL is missing a host".to_string())?
        .to_ascii_lowercase();

    if !allowed_suffixes
        .iter()
        .any(|suffix| host_matches_suffix(&host, suffix))
    {
        return Err(format!("Download host is not trusted: {host}"));
    }

    Ok(url)
}

fn validate_ota_metadata_url(raw: &str) -> Result<reqwest::Url, String> {
    validate_https_url(raw, &["api.hammerhead.io"])
}

fn validate_download_url(raw: &str) -> Result<reqwest::Url, String> {
    validate_https_url(raw, DOWNLOAD_HOST_SUFFIXES)
}

const OTA_LOG_HOST_SUFFIXES: &[&str] = &[
    "hammerhead.io",
    "amazonaws.com",
    "cloudfront.net",
];

fn extract_ota_urls(logcat: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut urls = Vec::new();

    for line in logcat.lines() {
        let line_lower = line.to_ascii_lowercase();
        let mut rest = line;

        while let Some(start) = rest.find("https://") {
            let candidate = &rest[start..];
            let end = candidate
                .find(|ch: char| {
                    ch.is_whitespace()
                        || matches!(ch, '"' | '\'' | '<' | '>' | ')' | ']' | '}')
                })
                .unwrap_or(candidate.len());

            let raw = candidate[..end].trim_end_matches([',', ';', '.']);
            if let Ok(url) = validate_https_url(raw, OTA_LOG_HOST_SUFFIXES) {
                let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
                let path = url.path().to_ascii_lowercase();
                let context_is_ota = line_lower.contains("ota")
                    || line_lower.contains("update")
                    || line_lower.contains("hammerhead");
                let url_looks_like_payload = path.ends_with(".zip")
                    || path.contains("/ota/")
                    || path.contains("/update");

                if (host_matches_suffix(&host, "hammerhead.io")
                    || context_is_ota
                    || url_looks_like_payload)
                    && seen.insert(url.as_str().to_string())
                {
                    urls.push(url.as_str().to_string());
                }
            }

            if end >= candidate.len() {
                break;
            }
            rest = &candidate[end..];
        }
    }

    urls
}

fn validate_download_filename(file_name: &str) -> Result<(), String> {
    let trimmed = file_name.trim();

    if trimmed.is_empty()
        || trimmed.len() > 180
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
    {
        return Err("Invalid download filename".to_string());
    }

    let extension = std::path::Path::new(trimmed)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Download filename must have an extension".to_string())?;

    if extension != "zip" && extension != "apk" {
        return Err("Only .zip and .apk downloads are allowed".to_string());
    }

    Ok(())
}

fn validate_apk_filename(file_name: &str) -> Result<(), String> {
    validate_download_filename(file_name)?;
    let extension = std::path::Path::new(file_name.trim())
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "APK filename must have an extension".to_string())?;

    if extension != "apk" {
        return Err("Only .apk package files are allowed".to_string());
    }

    Ok(())
}

fn validate_apk_file(path: &std::path::Path) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|_| "APK file does not exist".to_string())?;
    if !metadata.is_file() {
        return Err("APK path must point to a regular file".to_string());
    }
    if metadata.len() == 0 || metadata.len() > 512 * 1024 * 1024 {
        return Err("APK file size is outside the allowed range".to_string());
    }

    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "APK filename is not valid UTF-8".to_string())?;
    validate_apk_filename(file_name)?;

    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut magic = [0_u8; 4];
    file.read_exact(&mut magic)
        .map_err(|_| "APK file is too short".to_string())?;
    if !matches!(magic, [b'P', b'K', 3, 4] | [b'P', b'K', 5, 6] | [b'P', b'K', 7, 8]) {
        return Err("APK file is not a ZIP container".to_string());
    }

    Ok(())
}

fn managed_app_dir(app: &tauri::AppHandle, child: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(child);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::canonicalize(&dir).map_err(|e| e.to_string())
}

fn validate_managed_apk_path(
    app: &tauri::AppHandle,
    raw_path: &str,
) -> Result<std::path::PathBuf, String> {
    let root = managed_app_dir(app, "downloads")?;
    let candidate = std::fs::canonicalize(raw_path)
        .map_err(|_| "Package must exist in the managed download cache".to_string())?;

    if !candidate.starts_with(&root) {
        return Err("Package is outside the managed download cache".to_string());
    }

    validate_apk_file(&candidate)?;
    Ok(candidate)
}

fn validate_remote_apk_path(raw_path: &str) -> Result<String, String> {
    let path = raw_path.trim();
    const ALLOWED_ROOTS: &[&str] = &[
        "/data/app/",
        "/system/app/",
        "/system/priv-app/",
        "/system_ext/app/",
        "/system_ext/priv-app/",
        "/product/app/",
        "/product/priv-app/",
        "/vendor/app/",
        "/vendor/priv-app/",
        "/odm/app/",
        "/odm/priv-app/",
    ];

    if path.is_empty()
        || path.len() > 1024
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || !path.ends_with(".apk")
        || !ALLOWED_ROOTS.iter().any(|root| path.starts_with(root))
    {
        return Err("Remote path is not an approved Android APK path".to_string());
    }

    if path
        .split('/')
        .skip(1)
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("Remote APK path contains unsafe path segments".to_string());
    }

    Ok(path.to_string())
}

fn redacted_url_for_log(url: &reqwest::Url) -> String {
    let mut redacted = url.clone();
    redacted.set_query(None);
    redacted.set_fragment(None);
    redacted.to_string()
}

fn download_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= 5 {
            return attempt.error("too many redirects");
        }

        if validate_download_url(attempt.url().as_str()).is_err() {
            return attempt.error("redirect target is outside the trusted download hosts");
        }

        attempt.follow()
    })
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
async fn capture_ota_logcat(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    log_interaction(app.clone(), "Scanning logcat for OTA update links".to_string()).await;

    let args = ["logcat", "-d"];
    log_adb(&app, &args);
    let output = app
        .shell()
        .command(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "ADB logcat capture failed".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let links = extract_ota_urls(&stdout);

    if links.is_empty() {
        log_to_nexus(
            &app,
            "SYSTEM :: No approved OTA links detected in current logcat dump".to_string(),
        );
    } else {
        log_to_nexus(
            &app,
            format!("SYSTEM :: Detected {} approved OTA link(s)", links.len()),
        );
    }

    Ok(links)
}

#[tauri::command]
async fn fetch_ota_metadata(url: String) -> Result<serde_json::Value, String> {
    let url = validate_ota_metadata_url(&url)?;
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", "Karoo-Nexus-Tactical")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status() == 204 {
        return Err("No update available (204 No Content)".to_string());
    }

    if !response.status().is_success() {
        return Err(format!("OTA metadata request failed: {}", response.status()));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_github_release_apk(app_id: String) -> Result<String, String> {
    let (owner, repo) = approved_hub_repo(&app_id)?;
    let url = format!("https://api.github.com/repos/{owner}/{repo}/releases/latest");
    let client = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .header("User-Agent", "Karoo-Nexus-Hub")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("GitHub API error: {}", response.status()));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let assets = json["assets"]
        .as_array()
        .ok_or_else(|| "No assets found in latest release".to_string())?;

    for asset in assets {
        let name = asset["name"].as_str().unwrap_or("");
        if !name.to_ascii_lowercase().ends_with(".apk") {
            continue;
        }

        let download_url = asset["browser_download_url"]
            .as_str()
            .ok_or_else(|| "APK asset has no download URL".to_string())?;
        let parsed = validate_download_url(download_url)?;

        if parsed.host_str() != Some("github.com") {
            return Err("GitHub APK asset URL has an unexpected host".to_string());
        }

        return Ok(parsed.to_string());
    }

    Err("No APK found in the latest release assets".to_string())
}

#[tauri::command]
async fn download_firmware(
    app: tauri::AppHandle,
    url: String,
    file_name: String,
) -> Result<String, String> {
    let url = validate_download_url(&url)?;
    validate_download_filename(&file_name)?;

    let safe_url = redacted_url_for_log(&url);
    log_interaction(
        app.clone(),
        format!("Initiating Tactical Download from {safe_url}"),
    )
    .await;
    log_to_nexus(&app, format!("DEBUG :: Requesting URL: {safe_url}"));

    let client = reqwest::Client::builder()
        .user_agent("Hammerhead/1.0")
        .https_only(true)
        .redirect(download_redirect_policy())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    log_to_nexus(&app, format!("DEBUG :: Server Status: {status}"));

    if !status.is_success() {
        return Err(format!("Download failed with status {status}"));
    }

    let total_size = response.content_length().unwrap_or(0);
    let download_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("downloads");

    std::fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    let local_path = download_dir.join(file_name.trim());
    let mut file = std::fs::File::create(&local_path).map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        if total_size > 0 {
            let percentage = (downloaded as f64 / total_size as f64) * 100.0;
            let _ = app.emit(
                "firmware-download-progress",
                DownloadProgress {
                    current: downloaded,
                    total: total_size,
                    percentage,
                },
            );
        }
    }

    let abs_path = std::fs::canonicalize(&local_path)
        .unwrap_or(local_path)
        .to_string_lossy()
        .to_string();
    log_to_nexus(
        &app,
        format!("SYSTEM :: Download Complete :: {abs_path}"),
    );
    Ok(abs_path)
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let parent = std::path::Path::new(&path).parent().unwrap_or(std::path::Path::new(&path));
    let abs_path = std::fs::canonicalize(parent).unwrap_or(std::path::PathBuf::from(parent));
    
    std::process::Command::new("explorer")
        .arg(abs_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn check_adb_connection(app: tauri::AppHandle) -> Result<String, String> {
    let args = ["devices"];
    let output = app.shell()
        .command(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
async fn get_karoo_info(app: tauri::AppHandle) -> Result<String, String> {
    let args = ["shell", "getprop", "ro.build.display.id"];
    let output = app.shell()
        .command(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
async fn stage_local_apk(app: tauri::AppHandle, source_path: String) -> Result<String, String> {
    let source = std::fs::canonicalize(&source_path)
        .map_err(|_| "Selected APK does not exist".to_string())?;
    validate_apk_file(&source)?;

    let downloads_dir = managed_app_dir(&app, "downloads")?;
    let staged_name = format!("manual-{}.apk", uuid::Uuid::new_v4());
    let destination = downloads_dir.join(staged_name);
    std::fs::copy(&source, &destination).map_err(|e| e.to_string())?;
    validate_apk_file(&destination)?;

    let staged = std::fs::canonicalize(&destination).map_err(|e| e.to_string())?;
    log_to_nexus(
        &app,
        format!(
            "SYSTEM :: Local APK staged :: {}",
            staged
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("manual.apk")
        ),
    );
    Ok(staged.to_string_lossy().to_string())
}

#[tauri::command]
async fn install_package(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let package_path = validate_managed_apk_path(&app, &path)?;
    let package_name = package_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("package.apk")
        .to_string();
    let package_path_string = package_path.to_string_lossy().to_string();

    log_interaction(
        app.clone(),
        format!("Initiating managed sideload for {package_name}"),
    )
    .await;
    let args = ["install", "-r", package_path_string.as_str()];
    log_adb(&app, &args[..]);

    let output = app.shell()
        .command(adb_path())
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
    let output = app.shell()
        .command(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.lines().map(|s| s.to_string()).collect())
}

#[tauri::command]
async fn pull_file(
    app: tauri::AppHandle,
    remote_path: String,
    file_name: String,
) -> Result<String, String> {
    let remote_path = validate_remote_apk_path(&remote_path)?;
    validate_apk_filename(&file_name)?;

    let extraction_dir = managed_app_dir(&app, "extractions")?;
    let local_path = extraction_dir.join(file_name.trim());

    if let Ok(metadata) = std::fs::symlink_metadata(&local_path) {
        if metadata.file_type().is_symlink() || metadata.is_file() {
            std::fs::remove_file(&local_path).map_err(|e| e.to_string())?;
        } else {
            return Err("Extraction destination is not a regular file".to_string());
        }
    }

    let local_path_string = local_path.to_string_lossy().to_string();
    let args = ["pull", remote_path.as_str(), local_path_string.as_str()];
    log_adb(&app, &args[..]);
    let output = app.shell()
        .command(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let pulled_path = std::fs::canonicalize(&local_path)
        .map_err(|_| "ADB reported success but the extracted file is missing".to_string())?;
    if !pulled_path.starts_with(&extraction_dir) {
        let _ = std::fs::remove_file(&pulled_path);
        return Err("ADB extraction escaped the managed directory".to_string());
    }
    validate_apk_file(&pulled_path)?;

    Ok(pulled_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn launch_intent(app: tauri::AppHandle, component: String) -> Result<String, String> {
    log_interaction(app.clone(), format!("Launching Android Component: {}", component)).await;
    let args = ["shell", "am", "start", "-n", &component];
    let output = app.shell()
        .command(adb_path())
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
async fn root_karoo_1(app: tauri::AppHandle) -> Result<String, String> {
    log_interaction(app.clone(), "Attempting to root Karoo 1 using mtk-su exploit".to_string()).await;
    let mtk_su_local = "scratch/mtk-su";
    if !std::path::Path::new(mtk_su_local).exists() {
        return Err("mtk-su binary not found in scratch folder.".to_string());
    }

    let adb = adb_path();
    let _ = Command::new(&adb).args(["push", mtk_su_local, "/data/local/tmp/mtk-su"]).output();
    let _ = Command::new(&adb).args(["shell", "chmod", "755", "/data/local/tmp/mtk-su"]).output();

    let output = Command::new(&adb).args(["shell", "/data/local/tmp/mtk-su", "-c", "id"]).output().map_err(|e| e.to_string())?;
    let result = String::from_utf8_lossy(&output.stdout);
    if result.contains("uid=0") {
        Ok("Karoo 1 successfully rooted!".to_string())
    } else {
        Err(format!("Root exploit failed: {}", result))
    }
}

#[tauri::command]
async fn pull_profiles(app: tauri::AppHandle) -> Result<String, String> {
    log_interaction(app.clone(), "Initiating Karoo 1 Profile Extraction (Root Mode)".to_string()).await;
    let mtk_su = "/data/local/tmp/mtk-su";
    let adb = adb_path();

    let _ = std::fs::create_dir_all("scratch/databases");
    let find_cmd = "find /data/data/io.hammerhead.datasyncservice/files -name db.sqlite3";
    let output = Command::new(&adb).args(["shell", mtk_su, "-c", find_cmd]).output().map_err(|e| e.to_string())?;
    let db_list = String::from_utf8_lossy(&output.stdout);

    for line in db_list.lines() {
        let db_path = line.trim();
        if db_path.is_empty() { continue; }
        let db_name = db_path.replace(['/', ':'], "_");
        let staging_path = format!("/sdcard/{}", db_name);
        
        let _ = Command::new(&adb).args(["shell", mtk_su, "-c", &format!("cp {} {}; chmod 666 {}", db_path, staging_path, staging_path)]).output();
        let _ = Command::new(&adb).args(["pull", &staging_path, &format!("scratch/databases/{}", db_name)]).output();
        let _ = Command::new(&adb).args(["shell", "rm", &staging_path]).output();
    }
    Ok("Profiles pulled to scratch/databases/.".to_string())
}

#[tauri::command]
async fn get_remote_profiles(app: tauri::AppHandle) -> Result<Vec<RemoteProfile>, String> {
    let mtk_su = "/data/local/tmp/mtk-su";
    let adb = adb_path();
    
    log_to_nexus(&app, "SYSTEM :: Scanning for Ride Profiles...".to_string());

    let list_out = app.shell().command(&adb).args(["shell", mtk_su, "-c", "find /data/data/io.hammerhead.datasyncservice/files -name db.sqlite3"]).output().await.map_err(|e| e.to_string())?;
    let list_str = String::from_utf8_lossy(&list_out.stdout);
    let lines: Vec<&str> = list_str.lines().filter(|l| !l.is_empty()).collect();
    let total_dbs = lines.len();

    if total_dbs == 0 {
        return Err("No profiles found. Is the device connected and rooted?".to_string());
    }

    let mut profiles_map: std::collections::HashMap<String, (u64, RemoteProfile)> = std::collections::HashMap::new();
    let temp_dir = std::path::PathBuf::from("scratch/temp_dbs");
    let _ = std::fs::create_dir_all(&temp_dir);

    for (index, db_device_path) in lines.iter().enumerate() {
        let percentage = ((index + 1) as f64 / total_dbs as f64) * 100.0;
        let _ = app.emit("discovery-progress", DownloadProgress {
            current: (index + 1) as u64,
            total: total_dbs as u64,
            percentage,
        });

        let local_db_name = format!("temp_{}.sqlite3", uuid::Uuid::new_v4());
        let local_db_path = temp_dir.join(&local_db_name);
        let staging_path = format!("/sdcard/{}", local_db_name);

        let _ = app.shell().command(&adb).args(["shell", mtk_su, "-c", &format!("cp {} {}; chmod 666 {}", db_device_path, staging_path, staging_path)]).output().await;
        let _ = app.shell().command(&adb).args(["pull", &staging_path, local_db_path.to_str().unwrap()]).output().await;
        let _ = app.shell().command(&adb).args(["shell", "rm", &staging_path]).output().await;

        if let Ok(conn) = rusqlite::Connection::open(&local_db_path) {
            let mut tables = Vec::new();
            if let Ok(mut stmt) = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kv_%'") {
                if let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) {
                    for t in rows.flatten() { tables.push(t); }
                }
            }

            for table in tables {
                let query = format!("SELECT key, body FROM {} WHERE key LIKE '%ride_profile%'", table);
                if let Ok(mut stmt) = conn.prepare(&query) {
                    if let Ok(rows) = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))) {
                        for res in rows.flatten() {
                            let (key, body) = res;
                            let parts: Vec<&str> = key.split('.').collect();
                            let slug = parts.last().unwrap_or(&"Unknown").to_string();
                            let de_dupe_key = if parts.len() > 1 { parts[1..].join(".") } else { key.clone() };
                            
                            let mut display_name = slug.clone();
                            if let Some(bv4_pos) = body.windows(3).position(|w| w == b"Bv4") {
                                let start = bv4_pos + 3;
                                if start < body.len() {
                                    let mut s = String::new();
                                    let mut found_start = false;
                                    for &b in &body[start..] {
                                        // Printable ASCII only
                                        if (32..=126).contains(&b) {
                                            // Heuristic: Stop if we hit common binary markers or too many uppercase chars in a row
                                            if !found_start && !((b as char).is_alphanumeric()) { continue; }
                                            s.push(b as char);
                                            found_start = true;
                                        } else if found_start { break; }
                                    }
                                    
                                    if s.len() > 1 {
                                        // Heuristic: The first byte is almost always a length/tag byte (e.g., 'J', 'M', 'K')
                                        let cleaned_raw = s[1..].to_string();
                                        // Heuristic: Clean up trailing "CMapp", "GWorkout", etc.
                                        let cleaned = cleaned_raw.replace("CMapp", "").replace("GWorkoutp", "").replace("p", "");
                                        display_name = cleaned.trim().to_string();
                                    }
                                }
                            }

                            let db_id = db_device_path.split('_').filter_map(|s| s.split('.').next()).find_map(|s| s.parse::<u64>().ok()).unwrap_or(0);
                            
                            let profile = RemoteProfile {
                                id: key.clone(),
                                name: display_name,
                                db_path: db_device_path.to_string(),
                                body: Some(hex::encode(body)),
                            };

                            if let Some((existing_id, _)) = profiles_map.get(&de_dupe_key) {
                                if db_id >= *existing_id {
                                    profiles_map.insert(de_dupe_key, (db_id, profile));
                                }
                            } else {
                                profiles_map.insert(de_dupe_key, (db_id, profile));
                            }
                        }
                    }
                }
            }
        }
    }

    let final_profiles: Vec<RemoteProfile> = profiles_map.into_values().map(|(_, p)| p).collect();
    log_to_nexus(&app, format!("SYSTEM :: Detected {} unique profiles", final_profiles.len()));
    Ok(final_profiles)
}

#[tauri::command]
async fn rename_profile_on_device(
    app: tauri::AppHandle,
    db_path: String,
    old_name: String,
    new_name: String,
) -> Result<String, String> {
    let mtk_su = "/data/local/tmp/mtk-su";
    let adb = adb_path();
    
    let local_db_name = format!("patch_{}.sqlite3", uuid::Uuid::new_v4());
    let temp_dir = std::path::PathBuf::from("scratch/temp_dbs");
    let _ = std::fs::create_dir_all(&temp_dir);
    let local_path = temp_dir.join(&local_db_name);
    let sd_path = format!("/sdcard/{}", local_db_name);

    log_to_nexus(&app, format!("SURGERY :: Renaming '{}' -> '{}' in {}", old_name, new_name, db_path));

    let _ = Command::new(&adb).args(["shell", "am", "force-stop", "io.hammerhead.datasyncservice"]).output();
    let _ = Command::new(&adb).args(["shell", mtk_su, "-c", &format!("cp {} {}; chmod 777 {}", db_path, sd_path, sd_path)]).output();
    let _ = Command::new(&adb).args(["pull", &sd_path, local_path.to_str().unwrap()]).output();

    let mut data = std::fs::read(&local_path).map_err(|e| e.to_string())?;
    let old_bytes = old_name.as_bytes();
    let mut new_bytes = new_name.as_bytes().to_vec();

    if new_bytes.len() < old_bytes.len() {
        new_bytes.extend(vec![b' '; old_bytes.len() - new_bytes.len()]);
    } else if new_bytes.len() > old_bytes.len() {
        new_bytes.truncate(old_bytes.len());
    }

    let mut found = false;
    for i in 0..data.len().saturating_sub(old_bytes.len()) {
        if &data[i..i + old_bytes.len()] == old_bytes {
            data[i..i + old_bytes.len()].copy_from_slice(&new_bytes);
            found = true;
            break;
        }
    }

    if !found {
        let _ = Command::new(&adb).args(["shell", "am", "startservice", "io.hammerhead.datasyncservice/.DataSyncService"]).output();
        return Err(format!("Could not find '{}' in database", old_name));
    }

    std::fs::write(&local_path, data).map_err(|e| e.to_string())?;
    let _ = Command::new(&adb).args(["push", local_path.to_str().unwrap(), &sd_path]).output();
    let inject_cmd = format!("cp {} {}; chmod 660 {}; chown 1000:1000 {}; rm {}", sd_path, db_path, db_path, db_path, sd_path);
    let _ = Command::new(&adb).args(["shell", mtk_su, "-c", &inject_cmd]).output();
    let _ = Command::new(&adb).args(["shell", "am", "startservice", "io.hammerhead.datasyncservice/.DataSyncService"]).output();

    log_to_nexus(&app, "SURGERY :: Success.".to_string());
    Ok(format!("Renamed to '{}'", new_name))
}

#[tauri::command]
async fn inject_profile_config(_app: tauri::AppHandle, payload: String) -> Result<String, String> {
    Ok(format!("Payload staged: {}", payload))
}

#[cfg(test)]
mod security_tests {
    use super::*;

    #[test]
    fn ota_logcat_extracts_only_approved_https_urls() {
        let log = r#"
I/Updater: OTA url=https://api.hammerhead.io/v1/device/update?deviceid=abc
I/Updater: payload https://bucket.s3.us-east-1.amazonaws.com/ota/update.zip?sig=secret,
I/Noise: http://api.hammerhead.io/insecure
I/Noise: https://api.hammerhead.io.evil.example/update.zip
I/Noise: https://example.com/update.zip
"#;

        let urls = extract_ota_urls(log);
        assert_eq!(urls.len(), 2);
        assert!(urls.iter().any(|url| url.starts_with(
            "https://api.hammerhead.io/v1/device/update?deviceid=abc"
        )));
        assert!(urls.iter().any(|url| url.contains(
            "s3.us-east-1.amazonaws.com/ota/update.zip?sig=secret"
        )));
    }

    #[test]
    fn ota_logcat_deduplicates_urls_and_ignores_unrelated_cloud_urls() {
        let log = r#"
I/Updater: https://downloads.hammerhead.io/ota/update.zip
I/Updater: https://downloads.hammerhead.io/ota/update.zip
I/Noise: https://assets.cloudfront.net/image.png
"#;

        let urls = extract_ota_urls(log);
        assert_eq!(
            urls,
            vec!["https://downloads.hammerhead.io/ota/update.zip".to_string()]
        );
    }

    #[test]
    fn ota_metadata_url_is_pinned_to_hammerhead_api() {
        assert!(validate_ota_metadata_url(
            "https://api.hammerhead.io/v1/device/update?deviceid=test"
        )
        .is_ok());
        assert!(validate_ota_metadata_url("http://api.hammerhead.io/v1/device/update").is_err());
        assert!(validate_ota_metadata_url("https://api.hammerhead.io.evil.example/v1").is_err());
        assert!(validate_ota_metadata_url("https://127.0.0.1/v1").is_err());
    }

    #[test]
    fn download_url_accepts_expected_public_providers_only() {
        for url in [
            "https://github.com/example/project/releases/download/v1/app.apk",
            "https://objects.githubusercontent.com/path/app.apk",
            "https://bucket.s3.us-east-1.amazonaws.com/update.zip",
            "https://cdn.example.cloudfront.net/update.zip",
            "https://downloads.hammerhead.io/update.zip",
        ] {
            assert!(validate_download_url(url).is_ok(), "{url}");
        }

        for url in [
            "http://github.com/example/project/app.apk",
            "https://localhost/update.zip",
            "https://127.0.0.1/update.zip",
            "https://github.com.evil.example/app.apk",
            "https://example.com/update.zip",
            "https://github.com:8443/example/app.apk",
        ] {
            assert!(validate_download_url(url).is_err(), "{url}");
        }
    }

    #[test]
    fn download_filename_cannot_escape_app_data_directory() {
        for file_name in ["firmware.zip", "karoo-kactions_latest.apk", "update 1.2.zip"] {
            assert!(validate_download_filename(file_name).is_ok(), "{file_name}");
        }

        for file_name in [
            "../firmware.zip",
            "nested/firmware.zip",
            "nested\\firmware.zip",
            "C:\\temp\\firmware.zip",
            "package.json",
            "",
        ] {
            assert!(validate_download_filename(file_name).is_err(), "{file_name}");
        }
    }

    #[test]
    fn apk_filename_is_strictly_leaf_apk() {
        for file_name in ["package.apk", "Karoo App 1.2.apk"] {
            assert!(validate_apk_filename(file_name).is_ok(), "{file_name}");
        }

        for file_name in [
            "../package.apk",
            "nested/package.apk",
            "C:\\temp\\package.apk",
            "firmware.zip",
            "package.apks",
            "",
        ] {
            assert!(validate_apk_filename(file_name).is_err(), "{file_name}");
        }
    }

    #[test]
    fn adb_pull_remote_path_is_limited_to_installed_apk_partitions() {
        for path in [
            "/data/app/~~hash/io.example.app-hash/base.apk",
            "/system/priv-app/Settings/Settings.apk",
            "/product/app/Example/Example.apk",
        ] {
            assert!(validate_remote_apk_path(path).is_ok(), "{path}");
        }

        for path in [
            "/sdcard/Download/private.apk",
            "/data/local/tmp/tool.apk",
            "/data/app/../data/local/tmp/tool.apk",
            "/data/app/not-an-apk.db",
            "/data/app/evil.apk\nnext",
            "",
        ] {
            assert!(validate_remote_apk_path(path).is_err(), "{path}");
        }
    }

    #[test]
    fn logged_url_drops_query_and_fragment() {
        let url = reqwest::Url::parse(
            "https://bucket.s3.amazonaws.com/update.zip?X-Amz-Signature=secret#fragment",
        )
        .unwrap();
        assert_eq!(
            redacted_url_for_log(&url),
            "https://bucket.s3.amazonaws.com/update.zip"
        );
    }

    #[test]
    fn software_hub_repositories_are_backend_approved() {
        assert_eq!(
            approved_hub_repo("ki2").unwrap(),
            ("valterc".to_string(), "ki2".to_string())
        );
        assert!(approved_hub_repo("not-in-catalog").is_err());
    }

    #[test]
    fn software_hub_catalog_has_unique_safe_repository_identifiers() {
        let catalog: Vec<HubCatalogEntry> = serde_json::from_str(HUB_DATA_JSON).unwrap();
        let mut ids = std::collections::HashSet::new();

        assert!(!catalog.is_empty());

        for entry in catalog {
            assert!(ids.insert(entry.id));
            assert!(valid_github_segment(&entry.owner));
            assert!(valid_github_segment(&entry.repo));
        }
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
            stage_local_apk,
            install_package,
            log_interaction,
            capture_ota_logcat,
            fetch_ota_metadata,
            get_github_release_apk,
            download_firmware,
            open_folder,
            list_packages,
            pull_file,
            launch_intent,
            root_karoo_1,
            pull_profiles,
            get_remote_profiles,
            rename_profile_on_device,
            inject_profile_config,
            sync_activities,
            analyze_fit_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
