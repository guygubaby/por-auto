use crate::{history, schedule, Jobs, Reply};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const CHECK_INTERVAL_MS: u64 = 6 * 60 * 60 * 1000;

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Installing,
    Error,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub phase: Phase,
    pub auto_check: bool,
    pub checked_at: Option<u64>,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub error: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Settings {
    auto_check: bool,
}

struct Inner {
    status: Status,
    update: Option<Update>,
}

pub struct AppUpdates {
    root: PathBuf,
    inner: Mutex<Inner>,
}

impl AppUpdates {
    pub fn open(root: PathBuf, version: String) -> Self {
        let path = root.join("update-settings.json");
        let settings = if path.exists() {
            fs::read(path).map_err(|e| e.to_string()).and_then(|bytes| {
                serde_json::from_slice::<Settings>(&bytes).map_err(|e| e.to_string())
            })
        } else {
            Ok(Settings { auto_check: true })
        };
        let error = settings
            .as_ref()
            .err()
            .map(|_| "更新设置无法读取，请重新设置自动检查开关".into());
        Self {
            root,
            inner: Mutex::new(Inner {
                status: Status {
                    current_version: version,
                    version: None,
                    notes: None,
                    phase: if error.is_some() {
                        Phase::Error
                    } else {
                        Phase::Idle
                    },
                    auto_check: settings
                        .map(|settings| settings.auto_check)
                        .unwrap_or(false),
                    checked_at: None,
                    downloaded: 0,
                    total: None,
                    error,
                },
                update: None,
            }),
        }
    }

    fn status(&self) -> Reply<Status> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| "更新器状态不可用")?
            .status
            .clone())
    }

    fn modify(&self, app: &AppHandle, edit: impl FnOnce(&mut Inner)) -> Reply<Status> {
        let status = {
            let mut inner = self.inner.lock().map_err(|_| "更新器状态不可用")?;
            edit(&mut inner);
            inner.status.clone()
        };
        let _ = app.emit("app-update-status", &status);
        Ok(status)
    }

    pub fn should_check(&self, now: u64) -> bool {
        self.status().is_ok_and(|status| {
            status.auto_check
                && !busy(status.phase)
                && status
                    .checked_at
                    .is_none_or(|last| now.saturating_sub(last) >= CHECK_INTERVAL_MS)
        })
    }
}

fn busy(phase: Phase) -> bool {
    matches!(
        phase,
        Phase::Checking | Phase::Downloading | Phase::Installing
    )
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Reply<Status> {
    app.state::<AppUpdates>().status()
}

#[tauri::command]
pub fn set_auto_update_check(app: AppHandle, enabled: bool) -> Reply<Status> {
    let updates = app.state::<AppUpdates>();
    let mut inner = updates.inner.lock().map_err(|_| "更新器状态不可用")?;
    fs::create_dir_all(&updates.root).map_err(|e| e.to_string())?;
    let temporary = updates.root.join("update-settings.next.json");
    fs::write(
        &temporary,
        serde_json::to_vec(&Settings {
            auto_check: enabled,
        })
        .map_err(|e| e.to_string())?,
    )
    .and_then(|_| fs::rename(temporary, updates.root.join("update-settings.json")))
    .map_err(|e| format!("保存更新设置失败：{e}"))?;
    inner.status.auto_check = enabled;
    let status = inner.status.clone();
    drop(inner);
    let _ = app.emit("app-update-status", &status);
    Ok(status)
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Reply<Status> {
    let updates = app.state::<AppUpdates>();
    {
        let mut inner = updates.inner.lock().map_err(|_| "更新器状态不可用")?;
        if busy(inner.status.phase) {
            return Ok(inner.status.clone());
        }
        inner.status.phase = Phase::Checking;
        inner.status.checked_at = Some(history::now());
        inner.status.error = None;
    }
    let _ = app.emit("app-update-status", updates.status()?);
    let result = async {
        app.updater_builder()
            .timeout(Duration::from_secs(30))
            .build()?
            .check()
            .await
    }
    .await;
    updates.modify(&app, |inner| match result {
        Ok(update) => {
            inner.status.version = update.as_ref().map(|update| update.version.clone());
            inner.status.notes = update.as_ref().and_then(|update| update.body.clone());
            inner.status.phase = if update.is_some() {
                Phase::Available
            } else {
                Phase::UpToDate
            };
            inner.update = update;
        }
        Err(error) => {
            inner.status.phase = Phase::Error;
            inner.status.error = Some(format!(
                "检查更新失败：{error}。请稍后重试，或检查 GitHub 连接。"
            ));
        }
    })
}

#[tauri::command]
pub async fn install_app_update(app: AppHandle) -> Reply<()> {
    crate::blocking(move || {
        let jobs = app.state::<Jobs>();
        let _guard = jobs
            .maintenance
            .try_write()
            .map_err(|_| "请等待工作流或维护操作结束后安装更新")?;
        if !app
            .state::<schedule::Scheduler>()
            .view()?
            .running_ids
            .is_empty()
        {
            return Err("请等待定时任务结束后安装更新".into());
        }
        let updates = app.state::<AppUpdates>();
        let update = {
            let mut inner = updates.inner.lock().map_err(|_| "更新器状态不可用")?;
            if busy(inner.status.phase) {
                return Err("正在检查或安装更新，请稍候".into());
            }
            let mut update = inner.update.clone().ok_or("请先检查并找到可用更新")?;
            if update.download_url.scheme() != "https" {
                return Err("更新下载地址必须使用 HTTPS".into());
            }
            update.timeout = Some(Duration::from_secs(600));
            inner.status.phase = Phase::Downloading;
            inner.status.downloaded = 0;
            inner.status.total = None;
            inner.status.error = None;
            update
        };
        let _ = app.emit("app-update-status", updates.status()?);
        let result = tauri::async_runtime::block_on(update.download_and_install(
            |bytes, total| {
                let _ = updates.modify(&app, |inner| {
                    inner.status.downloaded = inner.status.downloaded.saturating_add(bytes as u64);
                    inner.status.total = total;
                });
            },
            || {
                let _ = updates.modify(&app, |inner| inner.status.phase = Phase::Installing);
            },
        ));
        if let Err(error) = result {
            let message = format!("安装更新失败：{error}。当前版本可继续使用，可重新尝试更新。");
            updates.modify(&app, |inner| {
                inner.status.phase = Phase::Error;
                inner.status.error = Some(message.clone());
            })?;
            return Err(message);
        }
        app.restart();
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};

    #[test]
    fn configured_public_key_accepts_our_signature_and_rejects_tampering() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let public_text = STANDARD
            .decode(config["plugins"]["updater"]["pubkey"].as_str().unwrap())
            .unwrap();
        let public =
            minisign_verify::PublicKey::decode(std::str::from_utf8(&public_text).unwrap()).unwrap();
        let signature_text = STANDARD
            .decode(include_str!("../tests/fixtures/update.txt.sig").trim())
            .unwrap();
        let signature =
            minisign_verify::Signature::decode(std::str::from_utf8(&signature_text).unwrap())
                .unwrap();
        let payload = include_bytes!("../tests/fixtures/update.txt");
        public.verify(payload, &signature, false).unwrap();
        assert!(public
            .verify(b"modified updater payload", &signature, false)
            .is_err());
        assert_eq!(config["plugins"]["updater"]["requireSignedVersion"], true);
    }

    #[test]
    fn automatic_checks_are_rate_limited_and_skip_active_updates() {
        let root = std::env::temp_dir().join(format!("por-updater-{}", uuid::Uuid::new_v4()));
        let updates = AppUpdates::open(root, "0.1.1".into());
        assert!(updates.should_check(1000));
        {
            let mut inner = updates.inner.lock().unwrap();
            inner.status.checked_at = Some(1000);
        }
        assert!(!updates.should_check(2000));
        assert!(updates.should_check(1000 + CHECK_INTERVAL_MS));
        for phase in [Phase::Checking, Phase::Downloading, Phase::Installing] {
            updates.inner.lock().unwrap().status.phase = phase;
            assert!(!updates.should_check(1000 + CHECK_INTERVAL_MS));
        }
        let mut inner = updates.inner.lock().unwrap();
        inner.status.phase = Phase::Idle;
        inner.status.auto_check = false;
        drop(inner);
        assert!(!updates.should_check(1000 + CHECK_INTERVAL_MS));
    }

    #[test]
    fn saved_preference_survives_restart_and_corruption_stops_automatic_checks() {
        let root = std::env::temp_dir().join(format!("por-updater-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("update-settings.json"), br#"{"autoCheck":false}"#).unwrap();
        assert!(!AppUpdates::open(root.clone(), "0.1.1".into()).should_check(1000));
        fs::write(root.join("update-settings.json"), b"broken").unwrap();
        let updates = AppUpdates::open(root.clone(), "0.1.1".into());
        assert!(updates.status().unwrap().error.is_some());
        assert!(!updates.should_check(1000));
        fs::remove_dir_all(root).unwrap();
    }
}
