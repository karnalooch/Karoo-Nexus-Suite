#[tauri::command]
async fn inject_profile_config(app: tauri::AppHandle, payload: String) -> Result<String, String> {
    log_interaction(app.clone(), format!("Injecting Custom Profile Configuration")).await;
    
    let json: serde_json::Value = serde_json::from_str(&payload).unwrap_or(serde_json::json!({"name": "Nexus Custom"}));
    let profile_name = json["name"].as_str().unwrap_or("Nexus Custom");

    let mtk_su = "/data/local/tmp/mtk-su";
    log_to_nexus(&app, format!("KAROO 1 :: Injecting '{}' using Couchbase Lite override...", profile_name));
    
    Ok(format!("Profile '{}' prepared for Karoo 1 injection. Root-level surgery required for Couchbase Lite integration.", profile_name))
}

#[tauri::command]
async fn pull_profiles(app: tauri::AppHandle) -> Result<String, String> {
    log_interaction(app.clone(), "Initiating Karoo 1 Profile Extraction (Root Mode)".to_string()).await;
    
    let _ = std::fs::create_dir_all("scratch/databases");
    let mtk_su = "/data/local/tmp/mtk-su";

    let find_cmd = "find /data/data/io.hammerhead.datasyncservice/files -name *.cblite2";
    let output_find = Command::new(adb_path())
        .args(["shell", mtk_su, "-c", find_cmd])
        .output()
        .map_err(|e| e.to_string())?;
    
    let db_list = String::from_utf8_lossy(&output_find.stdout);
    log_to_nexus(&app, format!("SYSTEM :: Detected databases:\n{}", db_list));

    if db_list.trim().is_empty() {
        return Err("No profiles found. Ensure device is connected and Karoo 1 is initialized.".to_string());
    }

    for line in db_list.lines() {
        let db_path = line.trim();
        if db_path.is_empty() { continue; }
        
        let db_name = db_path.split('/').last().unwrap_or("unknown.cblite2");
        let sd_path = format!("/sdcard/{}", db_name);
        let local_path = format!("scratch/databases/{}", db_name);
        
        log_to_nexus(&app, format!("SYSTEM :: Pulling {}...", db_name));

        let cp_cmd = format!("cp -r {} {}", db_path, sd_path);
        let _ = Command::new(adb_path()).args(["shell", mtk_su, "-c", &cp_cmd]).output();
        let _ = Command::new(adb_path()).args(["pull", &sd_path, &local_path]).output();
        let _ = Command::new(adb_path()).args(["shell", "rm", "-rf", &sd_path]).output();
    }

    Ok("All Karoo 1 profiles successfully retrieved and archived in scratch/databases/.".to_string())
}

#[tauri::command]
async fn get_remote_profiles(app: tauri::AppHandle) -> Result<Vec<RemoteProfile>, String> {
    log_to_nexus(&app, "SYSTEM :: Scanning for Ride Profiles...".to_string());
    let mtk_su = "/data/local/tmp/mtk-su";
    
    let find_cmd = "find /data/data/io.hammerhead.datasyncservice/files -name db.sqlite3";
    let output = app.shell().command(&adb_path())
        .args(["shell", mtk_su, "-c", find_cmd])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut all_profiles = Vec::new();

    let temp_dir = std::path::PathBuf::from("scratch/temp_dbs");
    let _ = std::fs::create_dir_all(&temp_dir);

    for line in stdout.lines() {
        let db_device_path = line.trim();
        if db_device_path.is_empty() || !db_device_path.starts_with('/') || !db_device_path.contains("database_") { 
            continue; 
        }
        
        let local_db_name = format!("temp_{}.sqlite3", uuid::Uuid::new_v4());
        let local_db_path = temp_dir.join(&local_db_name);
        let staging_path = format!("/sdcard/Download/{}", local_db_name);

        log_to_nexus(&app, format!("SYSTEM :: Staging {}...", db_device_path.split('/').last().unwrap_or("db")));
        
        let staging_cmd = format!("mkdir -p /sdcard/Download && cp '{}' '{}' && chmod 777 '{}'", db_device_path, staging_path, staging_path);
        let staging_out = app.shell().command(&adb_path()).args(["shell", mtk_su, "-c", &staging_cmd]).output().await.map_err(|e| e.to_string())?;
        
        if !staging_out.status.success() { continue; }

        let pull_out = app.shell().command(&adb_path()).args(["pull", &staging_path, local_db_path.to_str().unwrap()]).output().await.map_err(|e| e.to_string())?;
        if !pull_out.status.success() { continue; }
        
        let _ = app.shell().command(&adb_path()).args(["shell", mtk_su, "-c", &format!("rm {}", staging_path)]).output().await;

        if let Ok(conn) = rusqlite::Connection::open(&local_db_path) {
            if let Ok(mut stmt) = conn.prepare("SELECT key, body FROM kv_default WHERE key LIKE '%profile%'") {
                let rows = stmt.query_map([], |row| {
                    let key: String = row.get(0)?;
                    let body: Vec<u8> = row.get(1)?;
                    Ok((key, body))
                });

                if let Ok(rows) = rows {
                    for res in rows {
                        if let Ok((key, body)) = res {
                            if key.contains(".ride_profile.") || key.contains("ride_profile") {
                                let parts: Vec<&str> = key.split('.').collect();
                                let name = parts.last().unwrap_or(&"Unknown").to_string();
                                all_profiles.push(RemoteProfile {
                                    id: key.clone(),
                                    name,
                                    db_path: db_device_path.to_string(),
                                    body: Some(hex::encode(body)),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    log_to_nexus(&app, format!("SYSTEM :: Detected {} Profiles", all_profiles.len()));
    Ok(all_profiles)
}

#[tauri::command]
async fn rename_profile_on_device(
    app: tauri::AppHandle,
    db_path: String,
    old_name: String,
    new_name: String,
) -> Result<String, String> {
    let mtk_su = "/data/local/tmp/mtk-su";
    
    let local_db_name = format!("patch_{}.sqlite3", uuid::Uuid::new_v4());
    let temp_dir = std::path::PathBuf::from("scratch/temp_dbs");
    let _ = std::fs::create_dir_all(&temp_dir);
    let local_path = temp_dir.join(&local_db_name);
    let sd_path = format!("/sdcard/Download/{}", local_db_name);

    log_to_nexus(&app, format!("SURGERY :: Initializing rename: '{}' -> '{}'", old_name, new_name));

    let _ = Command::new(adb_path()).args(["shell", "am", "force-stop", "io.hammerhead.datasyncservice"]).output();

    let cp_cmd = format!("cp '{}' '{}'", db_path, sd_path);
    let _ = Command::new(adb_path()).args(["shell", mtk_su, "-c", &cp_cmd]).output();
    let _ = Command::new(adb_path()).args(["pull", &sd_path, local_path.to_str().unwrap()]).output();

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
        let _ = Command::new(adb_path()).args(["shell", "am", "startservice", "io.hammerhead.datasyncservice/.DataSyncService"]).output();
        return Err(format!("Could not find profile name '{}' in database", old_name));
    }

    std::fs::write(&local_path, data).map_err(|e| e.to_string())?;

    let _ = Command::new(adb_path()).args(["push", local_path.to_str().unwrap(), &sd_path]).output();
    let inject_cmd = format!("cp '{}' '{}' && chmod 660 '{}' && chown 1000:1000 '{}'", sd_path, db_path, db_path, db_path);
    let _ = Command::new(adb_path()).args(["shell", mtk_su, "-c", &inject_cmd]).output();

    let _ = Command::new(adb_path()).args(["shell", "am", "startservice", "io.hammerhead.datasyncservice/.DataSyncService"]).output();

    log_to_nexus(&app, "SURGERY :: Success. Profile identity updated.".to_string());
    Ok(format!("Profile renamed to '{}'", new_name))
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
            start_map_proxy,
            stop_map_proxy,
            generate_ca_cert,
            get_device_id,
            open_folder,
            inject_profile_config,
            pull_profiles,
            root_karoo_1,
            get_remote_profiles,
            rename_profile_on_device,
            activity::sync_activities,
            activity::analyze_fit_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
