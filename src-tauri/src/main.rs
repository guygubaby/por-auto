#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod android;
mod registry;
mod workflow;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

type Reply<T> = Result<T, String>;
#[derive(Default)]
struct Jobs(Mutex<()>);

#[derive(Deserialize)]
struct Manifest {
    version: String,
    platform: String,
    sha256: String,
}
#[derive(Serialize)]
struct Environment {
    ready: bool,
    version: String,
    platform: String,
    devices: Vec<android::Device>,
}
#[derive(Clone, Serialize)]
struct Progress {
    step: usize,
    total: usize,
    message: String,
}
#[derive(Serialize)]
struct RunResult {
    nickname: Option<String>,
    outputs: BTreeMap<String, String>,
    workflow_name: String,
    workflow_version: String,
    workflow_key: String,
    commit: String,
    serial: String,
    timestamp: u64,
    screenshot: Option<String>,
    error: Option<String>,
    warning: Option<String>,
    folder: String,
}

fn data_dir(app: &AppHandle) -> Reply<PathBuf> {
    app.path().app_local_data_dir().map_err(|e| e.to_string())
}

fn resource(app: &AppHandle, name: &str) -> Reply<PathBuf> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources")
        .join(name);
    if path.exists() {
        return Ok(path);
    }
    #[cfg(debug_assertions)]
    {
        let local = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name);
        if local.exists() {
            return Ok(local);
        }
    }
    Err(format!("安装包缺少连接组件 {name}，请重新安装软件"))
}

fn manifest(app: &AppHandle) -> Reply<Manifest> {
    let value: Manifest = serde_json::from_slice(
        &fs::read(resource(app, "adb-manifest.json")?).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let expected = if cfg!(windows) { "windows" } else { "macos" };
    if value.platform != expected {
        return Err("连接组件与当前系统不匹配，请使用对应系统的安装包".into());
    }
    Ok(value)
}

fn component_dir(app: &AppHandle, info: &Manifest) -> Reply<PathBuf> {
    Ok(data_dir(app)?
        .join("components")
        .join(format!("platform-tools-{}", info.version)))
}

fn adb_path(app: &AppHandle) -> Reply<PathBuf> {
    let path =
        component_dir(app, &manifest(app)?)?.join(if cfg!(windows) { "adb.exe" } else { "adb" });
    if !path.is_file() {
        return Err("请先点击「初始化连接组件」".into());
    }
    Ok(path)
}

fn environment(app: &AppHandle) -> Reply<Environment> {
    let info = manifest(app)?;
    let adb = adb_path(app).ok();
    let devices = if let Some(path) = &adb {
        let version = android::text(path, &["version"])?;
        if !version.contains("Android Debug Bridge") {
            return Err("连接组件无法正常运行，请重新初始化".into());
        }
        android::parse_devices(&android::text(path, &["devices", "-l"])?)
    } else {
        Vec::new()
    };
    Ok(Environment {
        ready: adb.is_some(),
        version: info.version,
        platform: info.platform,
        devices,
    })
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Reply<T> + Send + 'static) -> Reply<T> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|e| format!("后台任务结束：{e}"))?
}

#[tauri::command]
async fn check_environment(app: AppHandle) -> Reply<Environment> {
    blocking(move || environment(&app)).await
}

#[tauri::command]
async fn initialize_environment(app: AppHandle) -> Reply<Environment> {
    blocking(move || {
        let state = app.state::<Jobs>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "已有操作正在进行，请等待完成")?;
        let info = manifest(&app)?;
        let archive = fs::read(resource(&app, "platform-tools.zip")?).map_err(|e| e.to_string())?;
        if format!("{:x}", Sha256::digest(&archive)) != info.sha256 {
            return Err("连接组件校验失败，请重新下载安装包".into());
        }
        let destination = component_dir(&app, &info)?;
        let temporary = data_dir(&app)?.join("components").join("preparing");
        if temporary.exists() {
            fs::remove_dir_all(&temporary).map_err(|e| e.to_string())?;
        }
        fs::create_dir_all(&temporary).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(Cursor::new(archive)).map_err(|e| e.to_string())?;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
            let Some(relative) = entry.enclosed_name() else {
                return Err("连接组件包含无效文件路径".into());
            };
            let Ok(name) = relative.strip_prefix("platform-tools") else {
                continue;
            };
            if entry.is_dir() {
                continue;
            }
            if !matches!(
                name.to_str(),
                Some(
                    "adb"
                        | "adb.exe"
                        | "AdbWinApi.dll"
                        | "AdbWinUsbApi.dll"
                        | "NOTICE.txt"
                        | "source.properties"
                )
            ) {
                continue;
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            fs::write(temporary.join(name), bytes).map_err(|e| e.to_string())?;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(temporary.join("adb"), fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
        android::text(
            &temporary.join(if cfg!(windows) { "adb.exe" } else { "adb" }),
            &["version"],
        )?;
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|e| e.to_string())?;
        }
        fs::rename(temporary, destination).map_err(|e| e.to_string())?;
        environment(&app)
    })
    .await
}

fn progress(app: &AppHandle, step: usize, total: usize, message: &str) {
    let _ = app.emit(
        "read-progress",
        Progress {
            step,
            total,
            message: message.into(),
        },
    );
}

#[tauri::command]
async fn workflow_store(app: AppHandle) -> Reply<registry::Store> {
    blocking(move || registry::load(&data_dir(&app)?)).await
}

#[tauri::command]
async fn sync_registry(
    app: AppHandle,
    url: String,
    reference: String,
    token: String,
) -> Reply<registry::Store> {
    blocking(move || {
        let state = app.state::<Jobs>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "已有操作正在进行，请等待完成")?;
        registry::sync(&data_dir(&app)?, &url, &reference, &token)
    })
    .await
}

#[tauri::command]
async fn install_workflow(
    app: AppHandle,
    url: String,
    reference: String,
    id: String,
) -> Reply<registry::Store> {
    blocking(move || {
        let state = app.state::<Jobs>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "已有操作正在进行，请等待完成")?;
        registry::install(&data_dir(&app)?, &url, &reference, &id)
    })
    .await
}

#[tauri::command]
async fn run_workflow(app: AppHandle, serial: String, workflow_key: String) -> Reply<RunResult> {
    blocking(move || {
        let state = app.state::<Jobs>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "已有操作正在进行，请等待完成")?;
        if serial.is_empty() || serial.len() > 256 || serial.chars().any(char::is_control) {
            return Err("请选择有效的手机设备".into());
        }
        let installed = registry::load(&data_dir(&app)?)?
            .installed
            .into_iter()
            .find(|w| w.key == workflow_key)
            .ok_or("请先安装并选择工作流")?;
        let adb = adb_path(&app)?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64;
        let folder = data_dir(&app)?.join("runs").join(timestamp.to_string());
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let total = installed.workflow.steps.len();
        let read = workflow::execute(
            &installed.workflow,
            &adb,
            &serial,
            &folder,
            |step, count, message| progress(&app, step, count, message),
        );
        let screenshot = android::run(&adb, &["-s", &serial, "exec-out", "screencap", "-p"])
            .and_then(|bytes| {
                if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                    return Err("手机截图格式无效".into());
                }
                fs::write(folder.join("screen.png"), &bytes).map_err(|e| e.to_string())?;
                Ok(STANDARD.encode(bytes))
            });
        let warning = screenshot.as_ref().err().cloned();
        let result = RunResult {
            nickname: read
                .as_ref()
                .ok()
                .and_then(|outputs| outputs.get("nickname").cloned()),
            outputs: read.as_ref().ok().cloned().unwrap_or_default(),
            workflow_name: installed.workflow.name,
            workflow_version: installed.workflow.version,
            workflow_key,
            commit: installed.commit,
            serial,
            timestamp,
            screenshot: screenshot.ok(),
            error: read.err(),
            warning,
            folder: folder.to_string_lossy().into_owned(),
        };
        fs::write(
            folder.join("result.json"),
            serde_json::to_vec_pretty(&result).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("保存结果失败：{e}"))?;
        progress(
            &app,
            if result.error.is_some() { 0 } else { total + 1 },
            total,
            if result.error.is_some() {
                "工作流未完成，请查看提示与截图"
            } else {
                "工作流执行完成"
            },
        );
        Ok(result)
    })
    .await
}

#[tauri::command]
async fn open_results(app: AppHandle) -> Reply<()> {
    blocking(move || {
        let path = data_dir(&app)?.join("runs");
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        let mut command = std::process::Command::new("explorer.exe");
        #[cfg(not(windows))]
        let mut command = std::process::Command::new("open");
        command.arg(path).spawn().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

fn main() {
    tauri::Builder::default()
        .manage(Jobs::default())
        .invoke_handler(tauri::generate_handler![
            check_environment,
            initialize_environment,
            workflow_store,
            sync_registry,
            install_workflow,
            run_workflow,
            open_results
        ])
        .run(tauri::generate_context!())
        .expect("无法启动微信连接助手");
}
