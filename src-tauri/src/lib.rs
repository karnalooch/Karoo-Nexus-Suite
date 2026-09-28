mod activity;

use activity::sync_activities;

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

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct AdbConnectionState {
    pub status: String,
    pub serial: Option<String>,
    pub transport_count: usize,
    pub authorized_count: usize,
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

const MAX_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

fn validate_declared_download_size(size: Option<u64>) -> Result<(), String> {
    if let Some(size) = size {
        if size > MAX_DOWNLOAD_BYTES {
            return Err(format!(
                "Download exceeds the {} byte safety limit",
                MAX_DOWNLOAD_BYTES
            ));
        }
    }
    Ok(())
}

fn advance_downloaded_bytes(current: u64, chunk_len: usize) -> Result<u64, String> {
    let chunk_len =
        u64::try_from(chunk_len).map_err(|_| "Download chunk length overflow".to_string())?;
    let next = current
        .checked_add(chunk_len)
        .ok_or_else(|| "Downloaded byte count overflow".to_string())?;

    if next > MAX_DOWNLOAD_BYTES {
        return Err(format!(
            "Download exceeds the {} byte safety limit",
            MAX_DOWNLOAD_BYTES
        ));
    }

    Ok(next)
}

struct StagedDownloadGuard {
    path: std::path::PathBuf,
    active: bool,
}

impl StagedDownloadGuard {
    fn new(path: std::path::PathBuf) -> Self {
        Self { path, active: true }
    }

    fn disarm(&mut self) {
        self.active = false;
    }
}

impl Drop for StagedDownloadGuard {
    fn drop(&mut self) {
        if self.active {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

fn replace_staged_download(
    staging_path: &std::path::Path,
    final_path: &std::path::Path,
) -> Result<(), String> {
    let backup_path = final_path.with_file_name(format!(
        ".nexus-download-backup-{}",
        uuid::Uuid::new_v4()
    ));
    let had_existing = final_path.exists();

    if had_existing {
        std::fs::rename(final_path, &backup_path)
            .map_err(|e| format!("Could not preserve existing download: {e}"))?;
    }

    match std::fs::rename(staging_path, final_path) {
        Ok(()) => {
            if had_existing {
                let _ = std::fs::remove_file(&backup_path);
            }
            Ok(())
        }
        Err(error) => {
            if had_existing {
                if let Err(rollback_error) = std::fs::rename(&backup_path, final_path) {
                    return Err(format!(
                        "CRITICAL: completed download install failed ({error}) and previous file restore failed ({rollback_error})"
                    ));
                }
            }
            Err(format!("Could not install completed download: {error}"))
        }
    }
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

fn canonical_managed_file(
    root: &std::path::Path,
    raw_path: &str,
) -> Result<std::path::PathBuf, String> {
    let root = std::fs::canonicalize(root)
        .map_err(|_| "Managed directory is unavailable".to_string())?;
    let candidate = std::fs::canonicalize(raw_path)
        .map_err(|_| "Requested managed file does not exist".to_string())?;

    if !candidate.starts_with(&root) {
        return Err("Requested file is outside the managed directory".to_string());
    }

    let metadata = std::fs::metadata(&candidate).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Requested managed path is not a regular file".to_string());
    }

    Ok(candidate)
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

const APPROVED_ANDROID_COMPONENTS: &[&str] = &[
    "com.android.settings/.DevelopmentSettings",
    "com.mediatek.engineermode/.EngineerMode",
    "com.mediatek.systemupdate/.Main",
];

fn validate_android_component(raw: &str) -> Result<String, String> {
    if APPROVED_ANDROID_COMPONENTS.contains(&raw) {
        Ok(raw.to_string())
    } else {
        Err("Android component is not approved for launch".to_string())
    }
}

fn validate_root_payload(path: &std::path::Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "mtk-su binary not found in scratch folder".to_string())?;

    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("mtk-su payload must be a regular file".to_string());
    }
    if metadata.len() == 0 {
        return Err("mtk-su payload is empty".to_string());
    }

    Ok(())
}

fn checked_adb_step(
    step: &str,
    success: bool,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<String, String> {
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();

    if success {
        return Ok(stdout);
    }

    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "ADB command returned a non-zero status".to_string()
    };

    Err(format!("{step} failed: {detail}"))
}

fn root_identity_is_uid_zero(identity: &str) -> bool {
    identity
        .split_whitespace()
        .any(|token| token == "uid=0" || token.starts_with("uid=0("))
}

fn require_non_empty_adb_value(step: &str, value: String) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        Err(format!("{step} returned an empty value"))
    } else {
        Ok(value)
    }
}

fn parse_package_listing(raw: &str) -> Result<Vec<String>, String> {
    let packages: Vec<String> = raw
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with("package:"))
        .map(str::to_string)
        .collect();

    if packages.is_empty() {
        Err("ADB package listing returned no package entries".to_string())
    } else {
        Ok(packages)
    }
}

fn parse_adb_connection_state(raw: &str) -> Result<AdbConnectionState, String> {
    let mut transports: Vec<(String, String)> = Vec::new();

    for raw_line in raw.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line == "List of devices attached" {
            continue;
        }

        let mut parts = line.split_whitespace();
        let serial = parts
            .next()
            .ok_or_else(|| "ADB device discovery returned a malformed row".to_string())?;
        let state = parts
            .next()
            .ok_or_else(|| format!("ADB device discovery returned a malformed row: {line}"))?;

        transports.push((serial.to_string(), state.to_string()));
    }

    let authorized: Vec<&str> = transports
        .iter()
        .filter_map(|(serial, state)| (state == "device").then_some(serial.as_str()))
        .collect();

    let (status, serial) = if transports.len() == 1 && authorized.len() == 1 {
        ("Online", Some(authorized[0].to_string()))
    } else if transports.len() > 1 {
        ("Ambiguous", None)
    } else {
        ("Disconnected", None)
    };

    Ok(AdbConnectionState {
        status: status.to_string(),
        serial,
        transport_count: transports.len(),
        authorized_count: authorized.len(),
    })
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

const DATASYNC_DB_ROOT: &str = "/data/data/io.hammerhead.datasyncservice/files/";

fn validate_profile_db_path(raw_path: &str) -> Result<String, String> {
    let path = raw_path.trim();

    if path.is_empty()
        || path.len() > 1024
        || !path.starts_with(DATASYNC_DB_ROOT)
        || !path.ends_with("/db.sqlite3")
        || path.contains('\\')
        || path.chars().any(char::is_control)
        || !path
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '.' | '_' | '-'))
    {
        return Err("Profile database path is outside the approved DataSync tree".to_string());
    }

    if path
        .split('/')
        .skip(1)
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("Profile database path contains unsafe segments".to_string());
    }

    Ok(path.to_string())
}


fn run_adb_checked(adb: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(adb)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if stderr.is_empty() { stdout } else { stderr });
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn run_root_checked(adb: &str, command: &str) -> Result<String, String> {
    run_adb_checked(adb, &["shell", "/data/local/tmp/mtk-su", "-c", command])
}

fn parse_profile_db_paths(raw: &str) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();

    for line in raw.lines() {
        let path = line.trim();
        if path.is_empty() {
            continue;
        }
        paths.push(validate_profile_db_path(path)?);
    }

    if paths.is_empty() {
        return Err("No profiles found. Is the device connected and rooted?".to_string());
    }

    Ok(paths)
}

fn discover_profile_db_paths(adb: &str) -> Result<Vec<String>, String> {
    let output = run_root_checked(
        adb,
        "find /data/data/io.hammerhead.datasyncservice/files -type f -name db.sqlite3 -print",
    )?;
    parse_profile_db_paths(&output)
}

fn combine_profile_transfer_results(
    transfer: Result<(), String>,
    cleanup: Result<(), String>,
) -> Result<(), String> {
    match (transfer, cleanup) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(cleanup_error)) => {
            Err(format!("Profile staging cleanup failed: {cleanup_error}"))
        }
        (Err(error), Err(cleanup_error)) => Err(format!(
            "{error}; profile staging cleanup also failed: {cleanup_error}"
        )),
    }
}

fn stage_and_pull_profile_db(
    adb: &str,
    db_path: &str,
    local_path: &std::path::Path,
) -> Result<(), String> {
    let db_path = validate_profile_db_path(db_path)?;
    let staging_path = format!("/sdcard/nexus-profile-{}.sqlite3", uuid::Uuid::new_v4());

    let transfer = run_root_checked(
        adb,
        &format!("cp {db_path} {staging_path}; chmod 666 {staging_path}"),
    )
    .and_then(|_| {
        let local_path = local_path.to_string_lossy().to_string();
        run_adb_checked(adb, &["pull", staging_path.as_str(), local_path.as_str()])
    })
    .map(|_| ());

    let cleanup = run_root_checked(adb, &format!("rm -f {staging_path}")).map(|_| ());
    combine_profile_transfer_results(transfer, cleanup)
}


fn validate_profile_rename(old_name: &str, new_name: &str) -> Result<(), String> {
    for (label, value) in [("current", old_name), ("new", new_name)] {
        if value.trim().is_empty()
            || value.len() > 128
            || value.chars().any(char::is_control)
        {
            return Err(format!("The {label} profile name is invalid"));
        }
    }

    if new_name.len() > old_name.len() {
        return Err(
            "The new profile name is longer than the current encoded slot; choose a shorter name"
                .to_string(),
        );
    }

    Ok(())
}

fn sqlite_integrity_check(conn: &rusqlite::Connection) -> Result<(), String> {
    let result: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if result != "ok" {
        return Err(format!("SQLite integrity check failed: {result}"));
    }
    Ok(())
}

fn profile_blob_matches(
    conn: &rusqlite::Connection,
    needle: &[u8],
) -> Result<Vec<(String, i64, Vec<u8>)>, String> {
    let mut tables = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kv_%'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for table in rows {
            tables.push(table.map_err(|e| e.to_string())?);
        }
    }

    let mut matches = Vec::new();
    for table in tables {
        let quoted = table.replace('"', "\"\"");
        let query = format!(
            "SELECT rowid, body FROM \"{quoted}\" WHERE key LIKE '%ride_profile%'"
        );
        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            let (rowid, body) = row.map_err(|e| e.to_string())?;
            let occurrences = body.windows(needle.len()).filter(|window| *window == needle).count();
            for _ in 0..occurrences {
                matches.push((table.clone(), rowid, body.clone()));
            }
        }
    }

    Ok(matches)
}

fn patch_profile_database(
    local_path: &std::path::Path,
    old_name: &str,
    new_name: &str,
) -> Result<(), String> {
    validate_profile_rename(old_name, new_name)?;

    let mut conn = rusqlite::Connection::open(local_path).map_err(|e| e.to_string())?;
    sqlite_integrity_check(&conn)?;

    let old_bytes = old_name.as_bytes();
    let matches = profile_blob_matches(&conn, old_bytes)?;
    if matches.is_empty() {
        return Err(format!("Could not find '{old_name}' in a ride profile record"));
    }
    if matches.len() != 1 {
        return Err(format!(
            "Refusing ambiguous rename: found {} matching profile payloads",
            matches.len()
        ));
    }

    let (table, rowid, mut body) = matches.into_iter().next().unwrap();
    let position = body
        .windows(old_bytes.len())
        .position(|window| window == old_bytes)
        .ok_or_else(|| "Profile payload changed while preparing the update".to_string())?;

    let mut replacement = new_name.as_bytes().to_vec();
    replacement.resize(old_bytes.len(), b' ');
    body[position..position + old_bytes.len()].copy_from_slice(&replacement);

    let quoted = table.replace('"', "\"\"");
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            &format!("UPDATE \"{quoted}\" SET body = ?1 WHERE rowid = ?2"),
            rusqlite::params![body, rowid],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;
    sqlite_integrity_check(&conn)
}

fn profile_database_contains_name(
    local_path: &std::path::Path,
    name: &str,
) -> Result<bool, String> {
    let conn = rusqlite::Connection::open(local_path).map_err(|e| e.to_string())?;
    sqlite_integrity_check(&conn)?;
    Ok(!profile_blob_matches(&conn, name.as_bytes())?.is_empty())
}

fn root_file_exists(adb: &str, path: &str) -> Result<bool, String> {
    let output = run_root_checked(
        adb,
        &format!("if [ -f {path} ]; then echo yes; else echo no; fi"),
    )?;
    Ok(output.trim() == "yes")
}

fn parse_device_file_metadata(raw: &str) -> Result<(String, String, String), String> {
    let parts: Vec<&str> = raw.trim().split(':').collect();
    if parts.len() != 3 || parts.iter().any(|part| part.is_empty() || !part.chars().all(|ch| ch.is_ascii_digit())) {
        return Err("Could not determine database ownership/mode".to_string());
    }
    Ok((
        parts[0].to_string(),
        parts[1].to_string(),
        parts[2].to_string(),
    ))
}

fn profile_rollback_failure_message(
    operation: &str,
    primary_error: &str,
    rollback_result: Result<String, String>,
) -> String {
    match rollback_result {
        Ok(_) => format!("{operation} failed; original database restored: {primary_error}"),
        Err(rollback_error) => format!(
            "CRITICAL: {operation} failed and rollback also failed: {primary_error}; rollback: {rollback_error}"
        ),
    }
}

struct DataSyncServiceGuard {
    adb: String,
}

impl Drop for DataSyncServiceGuard {
    fn drop(&mut self) {
        let _ = Command::new(&self.adb)
            .args([
                "shell",
                "am",
                "startservice",
                "io.hammerhead.datasyncservice/.DataSyncService",
            ])
            .output();
    }
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

    let total_size = response.content_length();
    validate_declared_download_size(total_size)?;

    let download_dir = managed_app_dir(&app, "downloads")?;
    let local_path = download_dir.join(file_name.trim());

    if let Ok(metadata) = std::fs::symlink_metadata(&local_path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Download destination is not a regular file".to_string());
        }
    }

    let staging_path = download_dir.join(format!(
        ".nexus-download-{}.part",
        uuid::Uuid::new_v4()
    ));
    let mut staging_guard = StagedDownloadGuard::new(staging_path.clone());
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging_path)
        .map_err(|e| e.to_string())?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Download stream failed: {e}"))?;
        downloaded = advance_downloaded_bytes(downloaded, chunk.len())?;
        file.write_all(&chunk)
            .map_err(|e| format!("Download write failed: {e}"))?;

        if let Some(total_size) = total_size.filter(|size| *size > 0) {
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

    file.flush()
        .map_err(|e| format!("Download flush failed: {e}"))?;
    drop(file);

    if downloaded == 0 {
        return Err("Download produced an empty file".to_string());
    }
    if let Some(expected) = total_size {
        if downloaded != expected {
            return Err(format!(
                "Download length mismatch: expected {expected} bytes, received {downloaded}"
            ));
        }
    }

    replace_staged_download(&staging_path, &local_path)?;
    staging_guard.disarm();

    let abs_path = std::fs::canonicalize(&local_path)
        .map_err(|_| "Completed download is missing after installation".to_string())?
        .to_string_lossy()
        .to_string();
    log_to_nexus(
        &app,
        format!("SYSTEM :: Download Complete :: {abs_path}"),
    );
    Ok(abs_path)
}

#[tauri::command]
fn open_folder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let downloads_dir = managed_app_dir(&app, "downloads")?;
    let managed_file = canonical_managed_file(&downloads_dir, &path)?;
    let parent = managed_file
        .parent()
        .ok_or_else(|| "Managed download has no parent directory".to_string())?;

    std::process::Command::new("explorer")
        .arg(parent)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn check_adb_connection(app: tauri::AppHandle) -> Result<AdbConnectionState, String> {
    let args = ["devices"];
    log_adb(&app, &args);
    let output = app
        .shell()
        .command(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| format!("ADB device discovery could not start: {e}"))?;

    let stdout = checked_adb_step(
        "ADB device discovery",
        output.status.success(),
        &output.stdout,
        &output.stderr,
    )?;
    parse_adb_connection_state(&stdout)
}

#[tauri::command]
async fn get_karoo_info(app: tauri::AppHandle) -> Result<String, String> {
    let args = ["shell", "getprop", "ro.build.display.id"];
    log_adb(&app, &args);
    let output = app
        .shell()
        .command(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| format!("Karoo build query could not start: {e}"))?;

    let value = checked_adb_step(
        "Karoo build query",
        output.status.success(),
        &output.stdout,
        &output.stderr,
    )?;
    require_non_empty_adb_value("Karoo build query", value)
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
    log_adb(&app, &args);
    let output = app
        .shell()
        .command(adb_path())
        .args(args)
        .output()
        .await
        .map_err(|e| format!("ADB package listing could not start: {e}"))?;

    let stdout = checked_adb_step(
        "ADB package listing",
        output.status.success(),
        &output.stdout,
        &output.stderr,
    )?;
    parse_package_listing(&stdout)
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
    let component = validate_android_component(&component)?;
    log_interaction(app.clone(), format!("Launching Android Component: {}", component)).await;
    let args = ["shell", "am", "start", "-n", component.as_str()];
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
    log_interaction(
        app.clone(),
        "Attempting to root Karoo 1 using mtk-su exploit".to_string(),
    )
    .await;

    let mtk_su_local = std::path::Path::new("scratch/mtk-su");
    validate_root_payload(mtk_su_local)?;
    let mtk_su_local = mtk_su_local.to_string_lossy().to_string();

    let adb = adb_path();

    let push_args = [
        "push",
        mtk_su_local.as_str(),
        "/data/local/tmp/mtk-su",
    ];
    log_adb(&app, &push_args);
    let push = app
        .shell()
        .command(&adb)
        .args(push_args)
        .output()
        .await
        .map_err(|e| format!("mtk-su upload could not start: {e}"))?;
    checked_adb_step(
        "mtk-su upload",
        push.status.success(),
        &push.stdout,
        &push.stderr,
    )?;

    let chmod_args = ["shell", "chmod", "755", "/data/local/tmp/mtk-su"];
    log_adb(&app, &chmod_args);
    let chmod = app
        .shell()
        .command(&adb)
        .args(chmod_args)
        .output()
        .await
        .map_err(|e| format!("mtk-su chmod could not start: {e}"))?;
    checked_adb_step(
        "mtk-su chmod",
        chmod.status.success(),
        &chmod.stdout,
        &chmod.stderr,
    )?;

    let identity_args = ["shell", "/data/local/tmp/mtk-su", "-c", "id"];
    log_adb(&app, &identity_args);
    let identity = app
        .shell()
        .command(&adb)
        .args(identity_args)
        .output()
        .await
        .map_err(|e| format!("root identity check could not start: {e}"))?;
    let identity = checked_adb_step(
        "root identity check",
        identity.status.success(),
        &identity.stdout,
        &identity.stderr,
    )?;

    if root_identity_is_uid_zero(&identity) {
        Ok("Karoo 1 successfully rooted!".to_string())
    } else {
        Err(format!(
            "Root identity check completed without uid=0: {identity}"
        ))
    }
}

#[tauri::command]
async fn pull_profiles(app: tauri::AppHandle) -> Result<String, String> {
    log_interaction(
        app.clone(),
        "Initiating Karoo 1 Profile Extraction (Root Mode)".to_string(),
    )
    .await;

    let adb = adb_path();
    let db_paths = discover_profile_db_paths(&adb)?;
    let extraction_dir = managed_app_dir(&app, "profile-extractions")?;

    for (index, db_path) in db_paths.iter().enumerate() {
        let local_path = extraction_dir.join(format!(
            "profile-{:03}-{}.sqlite3",
            index + 1,
            uuid::Uuid::new_v4()
        ));

        stage_and_pull_profile_db(&adb, db_path, &local_path).map_err(|error| {
            let _ = std::fs::remove_file(&local_path);
            format!(
                "Profile extraction failed for database {}/{}: {}",
                index + 1,
                db_paths.len(),
                error
            )
        })?;
    }

    Ok(format!(
        "Pulled {} profile database(s) to {}",
        db_paths.len(),
        extraction_dir.display()
    ))
}

#[tauri::command]
async fn get_remote_profiles(app: tauri::AppHandle) -> Result<Vec<RemoteProfile>, String> {
    let adb = adb_path();

    log_to_nexus(&app, "SYSTEM :: Scanning for Ride Profiles...".to_string());

    let db_paths = discover_profile_db_paths(&adb)?;
    let total_dbs = db_paths.len();

    let mut profiles_map: std::collections::HashMap<String, (u64, RemoteProfile)> =
        std::collections::HashMap::new();
    let temp_dir = managed_app_dir(&app, "profile-discovery")?;

    for (index, db_device_path) in db_paths.iter().enumerate() {
        let percentage = ((index + 1) as f64 / total_dbs as f64) * 100.0;
        let _ = app.emit(
            "discovery-progress",
            DownloadProgress {
                current: (index + 1) as u64,
                total: total_dbs as u64,
                percentage,
            },
        );

        let local_db_path =
            temp_dir.join(format!("profile-{}.sqlite3", uuid::Uuid::new_v4()));

        stage_and_pull_profile_db(&adb, db_device_path, &local_db_path).map_err(|error| {
            let _ = std::fs::remove_file(&local_db_path);
            format!(
                "Profile discovery failed while extracting database {}/{}: {}",
                index + 1,
                total_dbs,
                error
            )
        })?;

        let parse_result = (|| -> Result<(), String> {
            let conn = rusqlite::Connection::open(&local_db_path)
                .map_err(|e| format!("Could not open staged profile database: {e}"))?;

            let mut tables = Vec::new();
            {
                let mut stmt = conn
                    .prepare(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kv_%'",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([], |row| row.get::<_, String>(0))
                    .map_err(|e| e.to_string())?;
                for table in rows {
                    tables.push(table.map_err(|e| e.to_string())?);
                }
            }

            for table in tables {
                let quoted_table = table.replace('"', "\"\"");
                let query = format!(
                    "SELECT key, body FROM \"{quoted_table}\" WHERE key LIKE '%ride_profile%'"
                );
                let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                    })
                    .map_err(|e| e.to_string())?;

                for row in rows {
                    let (key, body) = row.map_err(|e| e.to_string())?;
                    let parts: Vec<&str> = key.split('.').collect();
                    let slug = parts.last().unwrap_or(&"Unknown").to_string();
                    let de_dupe_key = if parts.len() > 1 {
                        parts[1..].join(".")
                    } else {
                        key.clone()
                    };

                    let mut display_name = slug.clone();
                    if let Some(bv4_pos) = body.windows(3).position(|w| w == b"Bv4") {
                        let start = bv4_pos + 3;
                        if start < body.len() {
                            let mut s = String::new();
                            let mut found_start = false;
                            for &b in &body[start..] {
                                if (32..=126).contains(&b) {
                                    if !found_start && !(b as char).is_alphanumeric() {
                                        continue;
                                    }
                                    s.push(b as char);
                                    found_start = true;
                                } else if found_start {
                                    break;
                                }
                            }

                            if s.len() > 1 {
                                let cleaned_raw = s[1..].to_string();
                                let cleaned = cleaned_raw
                                    .replace("CMapp", "")
                                    .replace("GWorkoutp", "")
                                    .replace('p', "");
                                display_name = cleaned.trim().to_string();
                            }
                        }
                    }

                    let db_id = db_device_path
                        .split('_')
                        .filter_map(|s| s.split('.').next())
                        .find_map(|s| s.parse::<u64>().ok())
                        .unwrap_or(0);

                    let profile = RemoteProfile {
                        id: key.clone(),
                        name: display_name,
                        db_path: db_device_path.clone(),
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

            Ok(())
        })();

        let local_cleanup = std::fs::remove_file(&local_db_path);
        if let Err(error) = parse_result {
            return Err(format!(
                "Profile discovery failed while parsing database {}/{}: {}",
                index + 1,
                total_dbs,
                error
            ));
        }
        if let Err(error) = local_cleanup {
            return Err(format!(
                "Profile discovery could not clean local staging file for database {}/{}: {}",
                index + 1,
                total_dbs,
                error
            ));
        }
    }

    let final_profiles: Vec<RemoteProfile> =
        profiles_map.into_values().map(|(_, profile)| profile).collect();
    log_to_nexus(
        &app,
        format!("SYSTEM :: Detected {} unique profiles", final_profiles.len()),
    );
    Ok(final_profiles)
}

#[tauri::command]
async fn rename_profile_on_device(
    app: tauri::AppHandle,
    db_path: String,
    old_name: String,
    new_name: String,
) -> Result<String, String> {
    let db_path = validate_profile_db_path(&db_path)?;
    validate_profile_rename(&old_name, &new_name)?;

    let adb = adb_path();
    let surgery_id = uuid::Uuid::new_v4().to_string();
    let local_dir = managed_app_dir(&app, "profile-surgery")?;
    let local_db = local_dir.join(format!("{surgery_id}.sqlite3"));
    let local_wal = local_dir.join(format!("{surgery_id}.sqlite3-wal"));
    let local_shm = local_dir.join(format!("{surgery_id}.sqlite3-shm"));
    let local_verify = local_dir.join(format!("{surgery_id}-verify.sqlite3"));

    let sd_db = format!("/sdcard/nexus-{surgery_id}.sqlite3");
    let sd_wal = format!("{sd_db}-wal");
    let sd_shm = format!("{sd_db}-shm");
    let sd_patched = format!("/sdcard/nexus-{surgery_id}-patched.sqlite3");
    let sd_verify = format!("/sdcard/nexus-{surgery_id}-verify.sqlite3");

    let backup_db = format!("{db_path}.nexus-backup-{surgery_id}");
    let backup_wal = format!("{backup_db}-wal");
    let backup_shm = format!("{backup_db}-shm");

    log_to_nexus(
        &app,
        format!("SURGERY :: Preparing recoverable rename '{}' -> '{}'", old_name, new_name),
    );

    run_adb_checked(
        &adb,
        &["shell", "am", "force-stop", "io.hammerhead.datasyncservice"],
    )?;
    let _service_guard = DataSyncServiceGuard { adb: adb.clone() };

    let metadata_raw = run_root_checked(&adb, &format!("stat -c '%u:%g:%a' {db_path}"))?;
    let (uid, gid, mode) = parse_device_file_metadata(&metadata_raw)?;

    let stage_command = format!(
        "cp {db_path} {sd_db}; chmod 666 {sd_db};          if [ -f {db_path}-wal ]; then cp {db_path}-wal {sd_wal}; chmod 666 {sd_wal}; fi;          if [ -f {db_path}-shm ]; then cp {db_path}-shm {sd_shm}; chmod 666 {sd_shm}; fi"
    );
    run_root_checked(&adb, &stage_command)?;

    let local_db_string = local_db.to_string_lossy().to_string();
    run_adb_checked(&adb, &["pull", sd_db.as_str(), local_db_string.as_str()])?;

    if root_file_exists(&adb, &sd_wal)? {
        let local_wal_string = local_wal.to_string_lossy().to_string();
        run_adb_checked(&adb, &["pull", sd_wal.as_str(), local_wal_string.as_str()])?;
    }
    if root_file_exists(&adb, &sd_shm)? {
        let local_shm_string = local_shm.to_string_lossy().to_string();
        run_adb_checked(&adb, &["pull", sd_shm.as_str(), local_shm_string.as_str()])?;
    }

    patch_profile_database(&local_db, &old_name, &new_name)?;

    let local_db_string = local_db.to_string_lossy().to_string();
    run_adb_checked(
        &adb,
        &["push", local_db_string.as_str(), sd_patched.as_str()],
    )?;

    let backup_command = format!(
        "cp {db_path} {backup_db};          if [ -f {db_path}-wal ]; then cp {db_path}-wal {backup_wal}; fi;          if [ -f {db_path}-shm ]; then cp {db_path}-shm {backup_shm}; fi"
    );
    run_root_checked(&adb, &backup_command)?;

    let install_command = format!(
        "cp {sd_patched} {db_path};          rm -f {db_path}-wal {db_path}-shm;          chown {uid}:{gid} {db_path}; chmod {mode} {db_path}"
    );

    if let Err(error) = run_root_checked(&adb, &install_command) {
        let rollback = format!(
            "cp {backup_db} {db_path};              if [ -f {backup_wal} ]; then cp {backup_wal} {db_path}-wal; else rm -f {db_path}-wal; fi;              if [ -f {backup_shm} ]; then cp {backup_shm} {db_path}-shm; else rm -f {db_path}-shm; fi;              chown {uid}:{gid} {db_path}; chmod {mode} {db_path};              if [ -f {db_path}-wal ]; then chown {uid}:{gid} {db_path}-wal; chmod 660 {db_path}-wal; fi;              if [ -f {db_path}-shm ]; then chown {uid}:{gid} {db_path}-shm; chmod 660 {db_path}-shm; fi"
        );
        let rollback_result = run_root_checked(&adb, &rollback);
        return Err(profile_rollback_failure_message(
            "Profile replacement",
            &error,
            rollback_result,
        ));
    }

    let verify_stage = format!("cp {db_path} {sd_verify}; chmod 666 {sd_verify}");
    let verification_result = (|| -> Result<(), String> {
        run_root_checked(&adb, &verify_stage)?;
        let local_verify_string = local_verify.to_string_lossy().to_string();
        run_adb_checked(
            &adb,
            &["pull", sd_verify.as_str(), local_verify_string.as_str()],
        )?;
        if !profile_database_contains_name(&local_verify, &new_name)? {
            return Err("Verified database does not contain the new profile name".to_string());
        }
        Ok(())
    })();

    if let Err(error) = verification_result {
        let rollback = format!(
            "cp {backup_db} {db_path};              if [ -f {backup_wal} ]; then cp {backup_wal} {db_path}-wal; else rm -f {db_path}-wal; fi;              if [ -f {backup_shm} ]; then cp {backup_shm} {db_path}-shm; else rm -f {db_path}-shm; fi;              chown {uid}:{gid} {db_path}; chmod {mode} {db_path};              if [ -f {db_path}-wal ]; then chown {uid}:{gid} {db_path}-wal; chmod 660 {db_path}-wal; fi;              if [ -f {db_path}-shm ]; then chown {uid}:{gid} {db_path}-shm; chmod 660 {db_path}-shm; fi"
        );
        let rollback_result = run_root_checked(&adb, &rollback);
        return Err(profile_rollback_failure_message(
            "Verification",
            &error,
            rollback_result,
        ));
    }

    let cleanup_command = format!("rm -f {sd_db} {sd_wal} {sd_shm} {sd_patched} {sd_verify}");
    let _ = run_root_checked(&adb, &cleanup_command);
    let _ = std::fs::remove_file(&local_db);
    let _ = std::fs::remove_file(&local_wal);
    let _ = std::fs::remove_file(&local_shm);
    let _ = std::fs::remove_file(&local_verify);

    log_to_nexus(
        &app,
        format!("SURGERY :: Verified success; recovery backup retained at {backup_db}"),
    );
    Ok(format!(
        "Renamed to '{}'. Recovery backup retained at {}",
        new_name, backup_db
    ))
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
    fn download_size_limit_applies_to_declared_and_streamed_bytes() {
        assert!(validate_declared_download_size(None).is_ok());
        assert!(validate_declared_download_size(Some(MAX_DOWNLOAD_BYTES)).is_ok());
        assert!(validate_declared_download_size(Some(MAX_DOWNLOAD_BYTES + 1)).is_err());

        assert_eq!(
            advance_downloaded_bytes(MAX_DOWNLOAD_BYTES - 1, 1).unwrap(),
            MAX_DOWNLOAD_BYTES
        );
        assert!(advance_downloaded_bytes(MAX_DOWNLOAD_BYTES, 1).is_err());
    }

    #[test]
    fn staged_download_guard_cleans_uncommitted_files() {
        let root = std::env::temp_dir().join(format!(
            "karoo-nexus-staged-download-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();

        let abandoned = root.join("abandoned.part");
        std::fs::write(&abandoned, b"partial").unwrap();
        {
            let _guard = StagedDownloadGuard::new(abandoned.clone());
        }
        assert!(!abandoned.exists());

        let committed = root.join("committed.part");
        std::fs::write(&committed, b"complete").unwrap();
        {
            let mut guard = StagedDownloadGuard::new(committed.clone());
            guard.disarm();
        }
        assert!(committed.exists());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn completed_download_replaces_existing_file_only_after_staging() {
        let root = std::env::temp_dir().join(format!(
            "karoo-nexus-download-replace-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();

        let final_path = root.join("firmware.zip");
        let staging_path = root.join("firmware.part");
        std::fs::write(&final_path, b"old").unwrap();
        std::fs::write(&staging_path, b"new").unwrap();

        replace_staged_download(&staging_path, &final_path).unwrap();

        assert_eq!(std::fs::read(&final_path).unwrap(), b"new");
        assert!(!staging_path.exists());

        let leftovers: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .collect();
        assert_eq!(leftovers.len(), 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn adb_value_and_package_parsers_fail_closed_on_empty_or_invalid_output() {
        assert_eq!(
            require_non_empty_adb_value("build", "  karoo-build-1  ".to_string()).unwrap(),
            "karoo-build-1"
        );
        assert!(require_non_empty_adb_value("build", "   \n".to_string()).is_err());

        let packages = parse_package_listing(
            "package:/data/app/app.one/base.apk=app.one\nnoise\npackage:/system/app/Settings.apk=com.android.settings\n",
        )
        .unwrap();
        assert_eq!(packages.len(), 2);
        assert!(packages[0].starts_with("package:"));
        assert!(parse_package_listing("").is_err());
        assert!(parse_package_listing("permission denied").is_err());
    }

    #[test]
    fn managed_file_boundary_rejects_paths_outside_the_download_root() {
        let temp = std::env::temp_dir().join(format!(
            "karoo-nexus-managed-file-{}",
            uuid::Uuid::new_v4()
        ));
        let downloads = temp.join("downloads");
        let outside = temp.join("outside");
        std::fs::create_dir_all(&downloads).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        let inside_file = downloads.join("firmware.zip");
        let outside_file = outside.join("secret.txt");
        std::fs::write(&inside_file, b"zip").unwrap();
        std::fs::write(&outside_file, b"secret").unwrap();

        let resolved =
            canonical_managed_file(&downloads, inside_file.to_str().unwrap()).unwrap();
        assert_eq!(resolved, std::fs::canonicalize(&inside_file).unwrap());

        assert!(canonical_managed_file(
            &downloads,
            outside_file.to_str().unwrap()
        )
        .is_err());
        assert!(canonical_managed_file(&downloads, downloads.to_str().unwrap()).is_err());
        assert!(canonical_managed_file(
            &downloads,
            downloads.join("missing.zip").to_str().unwrap()
        )
        .is_err());

        let _ = std::fs::remove_dir_all(temp);
    }

    #[test]
    fn root_payload_must_be_a_non_empty_regular_file() {
        let root = std::env::temp_dir().join(format!(
            "karoo-nexus-root-payload-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();

        let payload = root.join("mtk-su");
        std::fs::write(&payload, b"payload").unwrap();
        assert!(validate_root_payload(&payload).is_ok());

        let empty = root.join("empty");
        std::fs::write(&empty, b"").unwrap();
        assert!(validate_root_payload(&empty).is_err());
        assert!(validate_root_payload(&root).is_err());
        assert!(validate_root_payload(&root.join("missing")).is_err());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn adb_steps_fail_closed_and_preserve_useful_error_context() {
        assert_eq!(
            checked_adb_step("upload", true, b"1 file pushed", b"").unwrap(),
            "1 file pushed"
        );

        let stderr_error =
            checked_adb_step("upload", false, b"partial", b"device offline").unwrap_err();
        assert!(stderr_error.contains("upload failed"));
        assert!(stderr_error.contains("device offline"));

        let stdout_error =
            checked_adb_step("chmod", false, b"permission denied", b"").unwrap_err();
        assert!(stdout_error.contains("permission denied"));

        let empty_error = checked_adb_step("identity", false, b"", b"").unwrap_err();
        assert!(empty_error.contains("non-zero status"));
    }

    #[test]
    fn root_identity_requires_a_uid_zero_token() {
        for identity in [
            "uid=0(root) gid=0(root) groups=0(root)",
            "uid=0 gid=0 groups=0",
        ] {
            assert!(root_identity_is_uid_zero(identity), "{identity}");
        }

        for identity in [
            "uid=1000(shell) gid=1000(shell)",
            "euid=0(root) uid=1000(shell)",
            "fakeuid=0(root)",
            "",
        ] {
            assert!(!root_identity_is_uid_zero(identity), "{identity}");
        }
    }

    #[test]
    fn android_component_launches_are_exactly_allowlisted() {
        for component in APPROVED_ANDROID_COMPONENTS {
            assert_eq!(
                validate_android_component(component).unwrap(),
                component.to_string()
            );
        }

        for component in [
            "com.android.settings/.Settings",
            "com.android.settings/.DevelopmentSettings ",
            "com.mediatek.systemupdate/.Main\n",
            "com.attacker/.Activity",
            "",
        ] {
            assert!(validate_android_component(component).is_err(), "{component:?}");
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
    fn device_profile_db_list_is_validated_fail_closed() {
        let valid = parse_profile_db_paths(
            "/data/data/io.hammerhead.datasyncservice/files/account_123/db.sqlite3\n\n",
        )
        .unwrap();
        assert_eq!(valid.len(), 1);

        let invalid = parse_profile_db_paths(
            "/data/data/io.hammerhead.datasyncservice/files/account_123/db.sqlite3\n/data/local/tmp/db.sqlite3\n",
        );
        assert!(invalid.is_err());
        assert!(parse_profile_db_paths("\n\n").is_err());
    }

    #[test]
    fn profile_transfer_never_silences_cleanup_failures() {
        assert!(combine_profile_transfer_results(Ok(()), Ok(())).is_ok());

        let transfer_error =
            combine_profile_transfer_results(Err("pull failed".to_string()), Ok(()))
                .unwrap_err();
        assert!(transfer_error.contains("pull failed"));

        let cleanup_error =
            combine_profile_transfer_results(Ok(()), Err("rm failed".to_string()))
                .unwrap_err();
        assert!(cleanup_error.contains("cleanup"));
        assert!(cleanup_error.contains("rm failed"));

        let combined_error = combine_profile_transfer_results(
            Err("pull failed".to_string()),
            Err("rm failed".to_string()),
        )
        .unwrap_err();
        assert!(combined_error.contains("pull failed"));
        assert!(combined_error.contains("rm failed"));
    }

    #[test]
    fn profile_db_path_is_pinned_to_datasync_tree() {
        assert!(validate_profile_db_path(
            "/data/data/io.hammerhead.datasyncservice/files/account_123/db.sqlite3"
        )
        .is_ok());

        for path in [
            "/data/local/tmp/db.sqlite3",
            "/data/data/io.hammerhead.datasyncservice/files/../shared/db.sqlite3",
            "/data/data/io.hammerhead.datasyncservice/files/account/db.sqlite3;id",
            "/data/data/io.hammerhead.datasyncservice/files/account/not-db.sqlite3",
            "",
        ] {
            assert!(validate_profile_db_path(path).is_err(), "{path}");
        }
    }


    #[test]
    fn adb_session_is_online_only_for_exactly_one_authorized_transport() {
        let state = parse_adb_connection_state(
            "List of devices attached\nkaroo-123\tdevice product:karoo model:Karoo\n",
        )
        .unwrap();
        assert_eq!(state.status, "Online");
        assert_eq!(state.serial.as_deref(), Some("karoo-123"));
        assert_eq!(state.transport_count, 1);
        assert_eq!(state.authorized_count, 1);
    }

    #[test]
    fn adb_session_fails_closed_when_multiple_transports_are_present() {
        for raw in [
            "List of devices attached\nkaroo-1\tdevice\nkaroo-2\tdevice\n",
            "List of devices attached\nkaroo-1\tdevice\nphone-2\tunauthorized\n",
        ] {
            let state = parse_adb_connection_state(raw).unwrap();
            assert_eq!(state.status, "Ambiguous");
            assert!(state.serial.is_none());
            assert_eq!(state.transport_count, 2);
        }
    }

    #[test]
    fn adb_session_distinguishes_missing_or_unavailable_devices() {
        let none = parse_adb_connection_state("List of devices attached\n\n").unwrap();
        assert_eq!(none.status, "Disconnected");
        assert_eq!(none.transport_count, 0);
        assert_eq!(none.authorized_count, 0);

        let unauthorized =
            parse_adb_connection_state("List of devices attached\nkaroo-1\tunauthorized\n")
                .unwrap();
        assert_eq!(unauthorized.status, "Disconnected");
        assert_eq!(unauthorized.transport_count, 1);
        assert_eq!(unauthorized.authorized_count, 0);

        assert!(parse_adb_connection_state(
            "List of devices attached\nmalformed-device-row\n"
        )
        .is_err());
    }

    #[test]
    fn profile_rename_rejects_length_expansion_and_controls() {
        assert!(validate_profile_rename("Tempo Ride", "Tempo").is_ok());
        assert!(validate_profile_rename("Short", "Longer Name").is_err());
        assert!(validate_profile_rename("Tempo", "Bad\nName").is_err());
    }

    #[test]
    fn profile_database_patch_uses_sqlite_and_preserves_integrity() {
        let path = std::env::temp_dir().join(format!(
            "karoo-nexus-profile-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        {
            let conn = rusqlite::Connection::open(&path).unwrap();
            conn.execute(
                "CREATE TABLE kv_profiles (key TEXT NOT NULL, body BLOB NOT NULL)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO kv_profiles (key, body) VALUES (?1, ?2)",
                rusqlite::params![
                    "profile.ride_profile.1",
                    b"prefixTempo Ridesuffix".to_vec()
                ],
            )
            .unwrap();
        }

        patch_profile_database(&path, "Tempo Ride", "Tempo").unwrap();

        let conn = rusqlite::Connection::open(&path).unwrap();
        sqlite_integrity_check(&conn).unwrap();
        let body: Vec<u8> = conn
            .query_row("SELECT body FROM kv_profiles LIMIT 1", [], |row| row.get(0))
            .unwrap();
        assert!(body
            .windows(b"Tempo     ".len())
            .any(|window| window == b"Tempo     "));
        drop(conn);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn profile_rollback_failure_reports_restore_and_double_failure() {
        let restored = profile_rollback_failure_message(
            "Profile replacement",
            "install failed",
            Ok("restored".to_string()),
        );
        assert_eq!(
            restored,
            "Profile replacement failed; original database restored: install failed"
        );

        let critical = profile_rollback_failure_message(
            "Profile replacement",
            "install failed",
            Err("restore failed".to_string()),
        );
        assert_eq!(
            critical,
            "CRITICAL: Profile replacement failed and rollback also failed: install failed; rollback: restore failed"
        );
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
            sync_activities
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
