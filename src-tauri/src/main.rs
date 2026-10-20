#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod android;
mod credentials;
mod history;
mod jobs;
mod provider;
mod registry;
mod schedule;
mod send_input;
mod u2;
mod updater;
mod visual;
mod wechat;
mod workflow;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Cursor, Read},
    path::PathBuf,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

type Reply<T> = Result<T, String>;
use jobs::Jobs;

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
    automation_version: String,
}
#[derive(Clone, Serialize)]
struct Progress {
    step: usize,
    total: usize,
    message: String,
    serial: String,
    workflow_key: String,
    scheduled: bool,
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
        automation_version: u2::VERSION.into(),
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
            .maintenance
            .try_write()
            .map_err(|_| "已有操作正在进行，请等待完成")?;
        let info = manifest(&app)?;
        u2::verify(&resource(&app, "u2.jar")?)?;
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

fn progress(
    app: &AppHandle,
    scheduled: bool,
    serial: &str,
    workflow_key: &str,
    step: usize,
    total: usize,
    message: &str,
) {
    let _ = app.emit(
        "workflow-progress",
        Progress {
            step,
            total,
            message: message.into(),
            serial: serial.into(),
            workflow_key: workflow_key.into(),
            scheduled,
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
            .maintenance
            .try_write()
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
            .maintenance
            .try_write()
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
            .maintenance
            .try_write()
            .map_err(|_| "已有操作正在进行，请等待完成")?;
        registry::install(&data_dir(&app)?, &url, &reference, &id)
    })
    .await
}

#[tauri::command]
async fn uninstall_workflow(app: AppHandle, key: String) -> Reply<registry::Store> {
    blocking(move || {
        let jobs = app.state::<Jobs>();
        let _guard = jobs
            .maintenance
            .try_write()
            .map_err(|_| "请等待工作流运行结束后卸载")?;
        app.state::<schedule::Scheduler>().pause_workflow(&key)?;
        let store = registry::uninstall(&data_dir(&app)?, &key)?;
        let _ = app.emit("schedules-changed", ());
        Ok(store)
    })
    .await
}

#[tauri::command]
async fn configure_workflow(
    app: AppHandle,
    key: String,
    input: Option<send_input::SendInput>,
    hooks: send_input::Hooks,
    execution_mode: provider::ExecutionMode,
    dry_run: Option<bool>,
    secrets: BTreeMap<String, String>,
) -> Reply<registry::Store> {
    blocking(move || {
        let jobs = app.state::<Jobs>();
        let _guard = jobs
            .maintenance
            .try_write()
            .map_err(|_| "请等待当前任务结束再保存配置")?;
        if execution_mode == provider::ExecutionMode::Visual {
            provider::VisionClient::for_phone(&data_dir(&app)?)?;
        }
        registry::configure(
            &data_dir(&app)?,
            &key,
            input,
            hooks,
            execution_mode,
            dry_run.unwrap_or(false),
            &secrets,
        )
    })
    .await
}

#[tauri::command]
async fn vision_provider(app: AppHandle) -> Reply<Option<provider::Config>> {
    blocking(move || provider::load(&data_dir(&app)?)).await
}

#[tauri::command]
async fn save_vision_provider(
    app: AppHandle,
    config: provider::Config,
    secret: Option<String>,
) -> Reply<provider::Config> {
    blocking(move || {
        let jobs = app.state::<Jobs>();
        let _guard = jobs
            .maintenance
            .try_write()
            .map_err(|_| "请等待当前任务结束后修改模型设置")?;
        provider::save(&data_dir(&app)?, config, secret.as_deref())
    })
    .await
}

#[tauri::command]
async fn test_vision_provider(
    app: AppHandle,
    config: provider::Config,
    secret: Option<String>,
) -> Reply<provider::TestResult> {
    blocking(move || provider::test(&data_dir(&app)?, config, secret.as_deref())).await
}

#[tauri::command]
async fn test_http_request(
    request: send_input::Request,
    secret: Option<String>,
) -> Reply<send_input::Preview> {
    blocking(move || {
        let context=serde_json::json!({"run":{"id":"test-preview","status":"completed","error":null,"mode":"preview"},"workflow":{"id":"test-workflow","name":"测试工作流","version":"1.0.0"},"device":{"serial":"test-device"},"recipient":{"title":"测试会话","index":1,"total":1},"outputs":{"nickname":"测试昵称","send_status":"测试结果","before_hook":"测试数据"}});
        request.with_context(&context)?.preview(secret.as_deref().filter(|s| !s.is_empty()))
    }).await
}

#[tauri::command]
async fn parse_http_response(raw: String, response: send_input::Response) -> Reply<String> {
    if raw.len() > 1_048_576 {
        return Err("解析样本不能超过 1 MiB".into());
    }
    send_input::parse(&raw, &response)
}

#[tauri::command]
async fn list_wechat_targets(
    app: AppHandle,
    serial: String,
    scope: send_input::Scope,
    execution_mode: Option<provider::ExecutionMode>,
) -> Reply<wechat::TargetList> {
    blocking(move || {
        if !schedule::valid_serial(&serial) {
            return Err("请选择有效手机".into());
        }
        let jobs = app.state::<Jobs>();
        let _permit = jobs.acquire(&serial)?;
        _permit.check()?;
        let adb = adb_path(&app)?;
        let folder = data_dir(&app)?
            .join("recipient-scan")
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let result = (|| {
            android::text(
                &adb,
                &[
                    "-s",
                    &serial,
                    "shell",
                    "input",
                    "keyevent",
                    "KEYCODE_WAKEUP",
                ],
            )?;
            android::text(
                &adb,
                &[
                    "-s",
                    &serial,
                    "shell",
                    "am",
                    "start",
                    "-n",
                    "com.tencent.mm/com.tencent.mm.ui.LauncherUI",
                ],
            )?;
            thread::sleep(Duration::from_millis(1600));
            if execution_mode == Some(provider::ExecutionMode::Visual) {
                let mut check = |_: &str| _permit.check();
                return visual::Session::start(
                    &data_dir(&app)?,
                    &adb,
                    &serial,
                    &folder,
                    false,
                    &mut check,
                )?
                .discover(scope);
            }
            let device = u2::Session::start(&adb, &serial, &resource(&app, "u2.jar")?, &folder)?;
            wechat::discover_progress(&device, &folder, scope, |_| _permit.check())
        })();
        let _ = fs::remove_dir_all(folder);
        result
    })
    .await
}

#[tauri::command]
async fn run_workflow(app: AppHandle, serial: String, workflow_key: String) -> Reply<RunResult> {
    blocking(move || {
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

#[tauri::command]
fn cancel_device_tasks(app: AppHandle, serials: Vec<String>) -> Reply<()> {
    if serials.len() > 100 || serials.iter().any(|s| !schedule::valid_serial(s)) {
        return Err("设备列表无效".into());
    }
    for serial in serials {
        app.state::<Jobs>().cancel(&serial)?;
    }
    Ok(())
}

fn run_installed(
    app: &AppHandle,
    serial: String,
    installed: registry::Installed,
    dispatch: Option<&schedule::Dispatch>,
) -> Reply<RunResult> {
    progress(
        app,
        dispatch.is_some(),
        &serial,
        &installed.key,
        0,
        installed.workflow.steps.len(),
        "等待此手机的任务队列",
    );
    let jobs = app.state::<Jobs>();
    let _permit = jobs.acquire(&serial)?;
    _permit.check()?;
    if !registry::load(&data_dir(app)?)?
        .installed
        .iter()
        .any(|w| w.key == installed.key)
    {
        return Err("此工作流已卸载，请重新安装后运行".into());
    }
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
        dry_run: installed.dry_run,
    };
    history::save_summary(&folder, &summary)?;
    fs::write(
        folder.join("workflow.json"),
        serde_json::to_vec_pretty(&installed.workflow).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    history::log(&folder, 0, "started", "工作流开始，检查设备与目标应用")?;
    if installed.dry_run {
        history::log(
            &folder,
            0,
            "started",
            "演练模式：填写并核对消息，不点击微信发送；新建草稿核对后清理，已有相同草稿保留",
        )?;
    }
    let total = installed.workflow.steps.len();
    let context = serde_json::json!({"run":{"id":summary.id,"status":"running","mode":if installed.dry_run {"rehearsal"} else {"send"}},"workflow":{"id":installed.workflow.id,"name":installed.workflow.name,"version":installed.workflow.version},"device":{"serial":serial},"outputs":{}});
    let mut read = (|| {
        let before = if let Some(request) = &installed.hooks.before_run {
            history::log(&folder, 0, "started", "前置 Hook：请求并解析数据")?;
            let preview = request.with_context(&context)?.fetch(None)?;
            history::log(
                &folder,
                0,
                "completed",
                &format!(
                    "前置 Hook 完成，HTTP {}，{} ms",
                    preview.status, preview.elapsed_ms
                ),
            )?;
            Some(preview.message)
        } else {
            None
        };
        let mut input = installed.input.clone();
        if let Some(input) = &mut input {
            if matches!(input.message, send_input::Message::BeforeRun) {
                let text = before
                    .clone()
                    .ok_or("消息来源为前置 Hook，但未配置前置请求")?;
                send_input::validate_message(&text)?;
                input.message = send_input::Message::Manual { text };
            }
        }
        let mut report = |step: usize, count: usize, message: &str, status: &str| {
            _permit.check()?;
            history::log_step(
                &folder,
                step,
                step.checked_sub(1)
                    .and_then(|i| installed.workflow.steps.get(i))
                    .and_then(|s| s.id.as_deref()),
                status,
                message,
            )?;
            if status == "started" {
                progress(
                    app,
                    dispatch.is_some(),
                    &serial,
                    &installed.key,
                    step.max(1),
                    count,
                    message,
                );
            }
            Ok(())
        };
        let mut outputs = match installed.execution_mode {
            provider::ExecutionMode::Native => workflow::execute_with_input(
                &installed.workflow,
                input.as_ref(),
                installed.dry_run,
                &adb,
                &serial,
                &resource(app, "u2.jar")?,
                &folder,
                &mut report,
            ),
            provider::ExecutionMode::Visual => visual::execute(
                &data_dir(app)?,
                &installed.workflow,
                input.as_ref(),
                installed.dry_run,
                &adb,
                &serial,
                &folder,
                &report,
            ),
        }?;
        outputs.insert(
            "run_mode".into(),
            if installed.dry_run {
                "演练（未点击发送）"
            } else {
                "正式运行"
            }
            .into(),
        );
        if let Some(value) = before {
            outputs.insert("before_hook".into(), value);
        }
        Ok::<_, String>(outputs)
    })();
    let mut hook_warning = None;
    if let Some(request) = &installed.hooks.after_run {
        let mut context = context.clone();
        context["run"]["status"] =
            serde_json::json!(if read.is_ok() { "completed" } else { "failed" });
        context["run"]["error"] = serde_json::json!(read.as_ref().err());
        context["outputs"] = serde_json::json!(read.as_ref().ok().cloned().unwrap_or_default());
        let result = (|| {
            history::log(&folder, 0, "started", "后置 Hook：回传本轮结果")?;
            let preview = request.with_context(&context)?.fetch(None)?;
            history::log(
                &folder,
                0,
                "completed",
                &format!("后置 Hook 完成，HTTP {}", preview.status),
            )?;
            Ok::<_, String>(())
        })();
        if let Err(error) = result {
            history::log(
                &folder,
                0,
                "warning",
                &format!("后置 Hook 失败：{error}；不会重新发送消息"),
            )?;
            hook_warning = Some(format!("后置 Hook 失败：{error}；手机动作不会重跑"));
        } else if let Ok(outputs) = &mut read {
            outputs.insert("after_hook".into(), "已完成结果回调".into());
        }
    }
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
    let warning = match (hook_warning, screenshot.as_ref().err()) {
        (Some(a), Some(b)) => Some(format!("{a}；截图：{b}")),
        (Some(a), None) => Some(a),
        (None, b) => b.cloned(),
    };
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
        serial: serial.clone(),
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
        dispatch.is_some(),
        &serial,
        &result.workflow_key,
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
        let _guard = state
            .maintenance
            .try_write()
            .map_err(|_| "任务运行期间不能清理记录")?;
        history::delete(&data_dir(&app)?.join("runs"), &ids)
    })
    .await
}

#[tauri::command]
async fn export_runs(app: AppHandle, ids: Vec<String>) -> Reply<Option<String>> {
    blocking(move || {
        let state = app.state::<Jobs>();
        let _guard = state
            .maintenance
            .try_write()
            .map_err(|_| "请等待当前操作完成后导出")?;
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
    let jobs = app.state::<Jobs>();
    let Ok(_batch) = jobs.maintenance.try_read() else {
        return Ok((
            "skipped".into(),
            "维护操作进行中，本轮跳过；原因保存在定时任务状态中".into(),
        ));
    };
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
        dry_run: task.snapshot.dry_run,
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
    let mut results = Vec::new();
    let (status, message) = if let Some(reason) = dispatch.skip_reason.clone() {
        ("skipped".to_string(), reason)
    } else {
        let mut succeeded = 0;
        for serials in task.serials.chunks(4) {
            let outcomes = thread::scope(|scope| {
                serials
                    .iter()
                    .map(|serial| {
                        scope.spawn(move || {
                            run_installed(
                                app,
                                serial.clone(),
                                task.snapshot.clone(),
                                Some(dispatch),
                            )
                        })
                    })
                    .collect::<Vec<_>>()
                    .into_iter()
                    .map(|worker| {
                        worker
                            .join()
                            .unwrap_or_else(|_| Err("设备任务意外中断，请检查手机与日志".into()))
                    })
                    .collect::<Vec<_>>()
            });
            for (serial, result) in serials.iter().zip(outcomes) {
                let error = match &result {
                    Ok(run) => run.error.clone(),
                    Err(error) => Some(error.clone()),
                };
                if error.is_none() {
                    succeeded += 1;
                }
                history::log(
                    &folder,
                    results.len() + 1,
                    if error.is_some() {
                        "failed"
                    } else {
                        "completed"
                    },
                    &format!("{serial}：{}", error.as_deref().unwrap_or("完成")),
                )?;
                results.push(serde_json::json!({
                    "serial": serial, "error": error,
                    "runId": result.as_ref().ok().and_then(|r| std::path::Path::new(&r.folder).file_name()).map(|s| s.to_string_lossy().into_owned())
                }));
            }
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
            "schedule": {"id":task.id,"name":task.name,"cron":task.cron,"timezone":task.timezone,"serials":task.serials,"workflowKey":task.snapshot.key,"workflowVersion":task.snapshot.workflow.version}, "trigger": dispatch.trigger, "scheduledAt": dispatch.scheduled_at,
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
            uninstall_workflow,
            configure_workflow,
            vision_provider,
            save_vision_provider,
            test_vision_provider,
            test_http_request,
            parse_http_response,
            list_wechat_targets,
            run_workflow,
            cancel_device_tasks,
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
