use std::fs::File;
use std::path::PathBuf;
use fitparser;
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use crate::{adb_path, log_adb};


#[derive(Serialize, Debug)]
pub struct FitSummary {
    pub file_name: String,
    pub start_time: String,
    pub duration_mins: f64,
    pub distance_km: f64,
    pub avg_power: f64,
    pub avg_heart_rate: f64,
    pub calories: f64,
}

#[tauri::command]
pub async fn sync_activities(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let backup_dir = app_dir.join("backups");
    std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

    let args = ["pull", "/sdcard/Documents/Hammerhead/Activities/", backup_dir.to_str().unwrap()];
    log_adb(&app, &args);

    let output = app.shell()
        .command(&adb_path())
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

fn to_f64(val: &fitparser::Value) -> f64 {
    match val {
        fitparser::Value::Timestamp(t) => t.timestamp() as f64,
        fitparser::Value::Byte(v) => *v as f64,
        fitparser::Value::Enum(v) => *v as f64,
        fitparser::Value::SInt8(v) => *v as f64,
        fitparser::Value::UInt8(v) => *v as f64,
        fitparser::Value::SInt16(v) => *v as f64,
        fitparser::Value::UInt16(v) => *v as f64,
        fitparser::Value::SInt32(v) => *v as f64,
        fitparser::Value::UInt32(v) => *v as f64,
        fitparser::Value::Float32(v) => *v as f64,
        fitparser::Value::Float64(v) => *v,
        fitparser::Value::SInt64(v) => *v as f64,
        fitparser::Value::UInt64(v) => *v as f64,
        _ => 0.0,
    }
}

#[tauri::command]
pub async fn analyze_fit_file(path: String) -> Result<FitSummary, String> {
    let mut fp = File::open(&path).map_err(|e| e.to_string())?;
    let data = fitparser::from_reader(&mut fp).map_err(|e| e.to_string())?;

    let mut summary = FitSummary {
        file_name: PathBuf::from(path).file_name().unwrap().to_str().unwrap().to_string(),
        start_time: "Unknown".to_string(),
        duration_mins: 0.0,
        distance_km: 0.0,
        avg_power: 0.0,
        avg_heart_rate: 0.0,
        calories: 0.0,
    };

    let mut total_power = 0.0;
    let mut power_count = 0;
    let mut total_hr = 0.0;
    let mut hr_count = 0;

    for record in data {
        match record.kind() {
            fitparser::profile::MesgNum::Session => {
                for field in record.fields() {
                    match field.name() {
                        "total_elapsed_time" => summary.duration_mins = to_f64(field.value()) / 60.0,
                        "total_distance" => summary.distance_km = to_f64(field.value()) / 1000.0,
                        "total_calories" => summary.calories = to_f64(field.value()),
                        "start_time" => summary.start_time = field.value().to_string(),
                        _ => {}
                    }
                }
            },
            fitparser::profile::MesgNum::Record => {
                for field in record.fields() {
                    match field.name() {
                        "power" => { total_power += to_f64(field.value()); power_count += 1; },
                        "heart_rate" => { total_hr += to_f64(field.value()); hr_count += 1; },
                        _ => {}
                    }
                }
            },
            _ => {}
        }
    }

    if power_count > 0 { summary.avg_power = total_power / (power_count as f64); }
    if hr_count > 0 { summary.avg_heart_rate = total_hr / (hr_count as f64); }

    Ok(summary)
}
