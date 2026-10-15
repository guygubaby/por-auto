#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod android;
mod history;
mod registry;
mod schedule;
mod updater;
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
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

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
        "workflow-progress",
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
async fn remove_registry(app: AppHandle, url: String, reference: String) -> Reply<registry::Store> {
    blocking(move || {
        let state = app.state::<Jobs>();
        let _guard = state
            .0
            .try_lock()
            .map_err(|_| "已有操作正在进行，请等待完成")?;
        registry::remove(&data_dir(&app)?, &url, &reference)
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
        if !schedule::valid_serial(&serial) {
            return Err("请选择有效的手机设备".into());
        }
        let installed = registry::load(&data_dir(&app)?)?
            .installed
            .into_iter()
            .find(|w| w.key == workflow_key)
            .ok_or("请先安装并选择工作流")?;
        run_installed(&app, serial, installed, None)
    })
    .await
}

fn run_installed(
    app: &AppHandle,
    serial: String,
    installed: registry::Installed,
    dispatch: Option<&schedule::Dispatch>,
) -> Reply<RunResult> {
    let adb = adb_path(app)?;
    let (id, folder) = history::create_folder(&data_dir(app)?.join("runs"))?;
    let timestamp = history::now();
    let mut summary = history::Summary {
        id,
        workflow_name: installed.workflow.name.clone(),
        workflow_version: installed.workflow.version.clone(),
        serial: serial.clone(),
        timestamp,
        status: "running".into(),
        error: None,
        schedule_id: dispatch.map(|d| d.task.id.clone()),
        schedule_name: dispatch.map(|d| d.task.name.clone()),
        trigger: dispatch.map(|d| d.trigger.into()),
    };
    history::save_summary(&folder, &summary)?;
    fs::write(
        folder.join("workflow.json"),
        serde_json::to_vec_pretty(&installed.workflow).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    history::log(&folder, 0, "started", "工作流开始，检查设备与目标应用")?;
    let total = installed.workflow.steps.len();
    let read = workflow::execute(
        &installed.workflow,
        &adb,
        &serial,
        &folder,
        |step, count, message, status| {
            history::log(&folder, step, status, message)?;
            if status == "started" {
                progress(app, step, count, message);
            }
            Ok(())
        },
    );
    if let Err(error) = &read {
        history::log(&folder, 0, "failed", error)?;
    }
    let screenshot =
        android::run(&adb, &["-s", &serial, "exec-out", "screencap", "-p"]).and_then(|bytes| {
            if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                return Err("手机截图格式无效".into());
            }
            fs::write(folder.join("screen.png"), &bytes).map_err(|e| e.to_string())?;
            Ok(STANDARD.encode(bytes))
        });
    let warning = screenshot.as_ref().err().cloned();
    if let Some(message) = &warning {
        history::log(&folder, 0, "warning", message)?;
    }
    let result = RunResult {
        nickname: read
            .as_ref()
            .ok()
            .and_then(|outputs| outputs.get("nickname").cloned()),
        outputs: read.as_ref().ok().cloned().unwrap_or_default(),
        workflow_name: installed.workflow.name,
        workflow_version: installed.workflow.version,
        workflow_key: installed.key,
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
    summary.status = if result.error.is_some() {
        "failed"
    } else {
        "completed"
    }
    .into();
    summary.error = result.error.clone();
    history::log(
        &folder,
        0,
        &summary.status,
        if result.error.is_some() {
            "工作流执行失败"
        } else {
            "工作流执行完成"
        },
    )?;
    history::save_summary(&folder, &summary)?;
    progress(
        app,
        if result.error.is_some() { 0 } else { total + 1 },
        total,
        if result.error.is_some() {
            "工作流未完成，请查看提示与截图"
        } else {
            "工作流执行完成"
        },
    );
    Ok(result)
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

#[tauri::command]
async fn list_runs(app: AppHandle) -> Reply<Vec<history::Summary>> {
    blocking(move || history::list(&data_dir(&app)?.join("runs"))).await
}

#[tauri::command]
async fn run_details(app: AppHandle, id: String) -> Reply<serde_json::Value> {
    blocking(move || history::details(&data_dir(&app)?.join("runs"), &id)).await
}

#[tauri::command]
async fn delete_runs(app: AppHandle, ids: Vec<String>) -> Reply<()> {
    blocking(move || {
        let state = app.state::<Jobs>();
        let _guard = state.0.try_lock().map_err(|_| "任务运行期间不能清理记录")?;
        history::delete(&data_dir(&app)?.join("runs"), &ids)
    })
    .await
}

#[tauri::command]
async fn export_runs(app: AppHandle, ids: Vec<String>) -> Reply<Option<String>> {
    blocking(move || {
        let state = app.state::<Jobs>();
        let _guard = state.0.try_lock().map_err(|_| "请等待当前操作完成后导出")?;
        let value = history::export(&data_dir(&app)?.join("runs"), &ids)?;
        let file = app
            .dialog()
            .file()
            .set_file_name(format!("por-auto-debug-{}.json", history::now()))
            .add_filter("JSON 调试记录", &["json"])
            .blocking_save_file();
        let Some(file) = file else {
            return Ok(None);
        };
        let path = file.into_path().map_err(|e| e.to_string())?;
        fs::write(
            &path,
            serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
        )
        .map_err(|e| format!("导出失败：{e}"))?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
fn list_schedules(app: AppHandle) -> Reply<schedule::View> {
    app.state::<schedule::Scheduler>().view()
}

#[tauri::command]
async fn preview_cron(cron: String, timezone: String) -> Reply<Vec<u64>> {
    blocking(move || schedule::upcoming(&cron, &timezone, history::now(), 5)).await
}

#[tauri::command]
async fn save_schedule(app: AppHandle, input: schedule::Input) -> Reply<schedule::View> {
    blocking(move || {
        let scheduler = app.state::<schedule::Scheduler>();
        scheduler.save(input)?;
        let _ = app.emit("schedules-changed", ());
        scheduler.view()
    })
    .await
}

#[tauri::command]
async fn set_schedule_enabled(app: AppHandle, id: String, enabled: bool) -> Reply<schedule::View> {
    blocking(move || {
        let scheduler = app.state::<schedule::Scheduler>();
        scheduler.enable(&id, enabled)?;
        let _ = app.emit("schedules-changed", ());
        scheduler.view()
    })
    .await
}

#[tauri::command]
async fn delete_schedule(app: AppHandle, id: String) -> Reply<schedule::View> {
    blocking(move || {
        let scheduler = app.state::<schedule::Scheduler>();
        scheduler.delete(&id)?;
        let _ = app.emit("schedules-changed", ());
        scheduler.view()
    })
    .await
}

#[tauri::command]
async fn run_schedule_now(app: AppHandle, id: String) -> Reply<schedule::View> {
    blocking(move || {
        let dispatch = app.state::<schedule::Scheduler>().claim_now(&id)?;
        dispatch_schedule(app.clone(), dispatch);
        app.state::<schedule::Scheduler>().view()
    })
    .await
}

fn run_schedule_logged(app: &AppHandle, dispatch: &schedule::Dispatch) -> Reply<(String, String)> {
    let (id, folder) = history::create_folder(&data_dir(app)?.join("runs"))?;
    let task = &dispatch.task;
    let mut summary = history::Summary {
        id,
        workflow_name: task.snapshot.workflow.name.clone(),
        workflow_version: task.snapshot.workflow.version.clone(),
        serial: format!("{} 台手机 · 批次", task.serials.len()),
        timestamp: history::now(),
        status: "running".into(),
        error: None,
        schedule_id: Some(task.id.clone()),
        schedule_name: Some(task.name.clone()),
        trigger: Some(dispatch.trigger.into()),
    };
    history::save_summary(&folder, &summary)?;
    fs::write(
        folder.join("workflow.json"),
        serde_json::to_vec_pretty(&task.snapshot.workflow).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    history::log(
        &folder,
        0,
        "started",
        &format!(
            "{} · {} · 计划时点 {}",
            task.name, dispatch.trigger, dispatch.scheduled_at
        ),
    )?;
    let jobs = app.state::<Jobs>();
    let guard = jobs.0.try_lock();
    let skip = dispatch.skip_reason.clone().or_else(|| {
        guard
            .as_ref()
            .err()
            .map(|_| "其他运行或维护操作尚未完成，本轮跳过".to_string())
    });
    let mut results = Vec::new();
    let (status, message) = if let Some(reason) = skip {
        ("skipped".to_string(), reason)
    } else {
        let mut succeeded = 0;
        for (index, serial) in task.serials.iter().enumerate() {
            history::log(
                &folder,
                index + 1,
                "started",
                &format!("开始执行设备 {serial}"),
            )?;
            let result = run_installed(app, serial.clone(), task.snapshot.clone(), Some(dispatch));
            let error = match &result {
                Ok(run) => run.error.clone(),
                Err(error) => Some(error.clone()),
            };
            if error.is_none() {
                succeeded += 1;
            }
            history::log(
                &folder,
                index + 1,
                if error.is_some() {
                    "failed"
                } else {
                    "completed"
                },
                &format!("{serial}：{}", error.as_deref().unwrap_or("完成")),
            )?;
            results.push(serde_json::json!({
                "serial": serial,
                "error": error,
                "runId": result.as_ref().ok().and_then(|r| std::path::Path::new(&r.folder).file_name()).map(|s| s.to_string_lossy().into_owned())
            }));
        }
        let status = if succeeded == task.serials.len() {
            "completed"
        } else if succeeded == 0 {
            "failed"
        } else {
            "partial"
        };
        (
            status.into(),
            format!(
                "共 {} 台，成功 {} 台，失败 {} 台",
                task.serials.len(),
                succeeded,
                task.serials.len() - succeeded
            ),
        )
    };
    summary.status = status.clone();
    summary.error = if status == "completed" {
        None
    } else {
        Some(message.clone())
    };
    fs::write(
        folder.join("result.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "schedule": task, "trigger": dispatch.trigger, "scheduledAt": dispatch.scheduled_at,
            "status": status, "message": message, "devices": results
        }))
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    history::log(&folder, 0, &status, &message)?;
    history::save_summary(&folder, &summary)?;
    Ok((status, message))
}

fn dispatch_schedule(app: AppHandle, dispatch: schedule::Dispatch) {
    let _ = app.emit("schedules-changed", ());
    tauri::async_runtime::spawn_blocking(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_schedule_logged(&app, &dispatch)
        }))
        .unwrap_or_else(|_| Err("调度任务意外中断，请查看运行记录".into()));
        let (status, message) = result.unwrap_or_else(|error| ("failed".into(), error));
        let scheduler = app.state::<schedule::Scheduler>();
        if let Err(error) = scheduler.finish(&dispatch, &status, &message) {
            scheduler.report_error(error);
        }
        let _ = app.emit("schedules-changed", ());
        let _ = app.emit("history-changed", ());
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Jobs::default())
        .setup(|app| {
            let handle = app.handle().clone();
            app.manage(schedule::Scheduler::open(data_dir(&handle)?));
            app.manage(updater::AppUpdates::open(
                data_dir(&handle)?,
                app.package_info().version.to_string(),
            ));
            thread::spawn(move || loop {
                let scheduler = handle.state::<schedule::Scheduler>();
                match scheduler.tick(history::now()) {
                    Ok(dispatches) => {
                        for dispatch in dispatches {
                            dispatch_schedule(handle.clone(), dispatch);
                        }
                    }
                    Err(error) => {
                        scheduler.report_error(error);
                        let _ = handle.emit("schedules-changed", ());
                    }
                }
                if handle
                    .state::<updater::AppUpdates>()
                    .should_check(history::now())
                {
                    let update_app = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = updater::check_for_updates(update_app).await;
                    });
                }
                thread::sleep(Duration::from_secs(1));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_environment,
            initialize_environment,
            workflow_store,
            sync_registry,
            remove_registry,
            install_workflow,
            run_workflow,
            open_results,
            list_runs,
            run_details,
            delete_runs,
            export_runs,
            list_schedules,
            preview_cron,
            save_schedule,
            set_schedule_enabled,
            delete_schedule,
            run_schedule_now,
            updater::update_status,
            updater::set_auto_update_check,
            updater::check_for_updates,
            updater::install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("无法启动Por Auto");
}
