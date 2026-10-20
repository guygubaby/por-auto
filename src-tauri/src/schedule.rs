use crate::{history, registry, Reply};
use chrono::{DateTime, LocalResult, TimeZone, Utc};
use chrono_tz::Tz;
use croner::Cron;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::Write,
    path::PathBuf,
    str::FromStr,
    sync::Mutex,
};
use uuid::Uuid;

const GRACE_MS: u64 = 10_000;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub cron: String,
    pub timezone: String,
    pub serials: Vec<String>,
    pub snapshot: registry::Installed,
    pub next_run_at: Option<u64>,
    pub last_run_at: Option<u64>,
    pub last_status: Option<String>,
    pub last_message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub id: Option<String>,
    pub name: String,
    pub enabled: bool,
    pub cron: String,
    pub timezone: String,
    pub serials: Vec<String>,
    pub workflow_key: String,
    #[serde(default)]
    pub update_workflow: bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStore {
    schema_version: u32,
    tasks: Vec<Task>,
}

#[derive(Default)]
struct State {
    tasks: Vec<Task>,
    running: BTreeSet<String>,
    error: Option<String>,
}

pub struct Scheduler {
    root: PathBuf,
    state: Mutex<State>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub tasks: Vec<Task>,
    pub running_ids: Vec<String>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct Dispatch {
    pub task: Task,
    pub trigger: &'static str,
    pub scheduled_at: u64,
    pub skip_reason: Option<String>,
    claimed: bool,
}

pub fn valid_serial(serial: &str) -> bool {
    !serial.trim().is_empty() && serial.len() <= 256 && !serial.chars().any(char::is_control)
}

fn parse(expression: &str, timezone: &str) -> Reply<(Cron, Tz)> {
    if expression.len() > 200 || expression.split_whitespace().count() != 5 {
        return Err("请输入标准五段 Cron：分 时 日 月 周，例如 0 9 * * *".into());
    }
    // Keep the contract POSIX-only even if the parser supports extra syntax.
    let words_valid = expression
        .split(|c: char| !c.is_ascii_alphabetic())
        .filter(|word| !word.is_empty())
        .all(|word| {
            matches!(
                word.to_ascii_uppercase().as_str(),
                "JAN"
                    | "FEB"
                    | "MAR"
                    | "APR"
                    | "MAY"
                    | "JUN"
                    | "JUL"
                    | "AUG"
                    | "SEP"
                    | "OCT"
                    | "NOV"
                    | "DEC"
                    | "SUN"
                    | "MON"
                    | "TUE"
                    | "WED"
                    | "THU"
                    | "FRI"
                    | "SAT"
            )
        });
    if !words_valid
        || !expression
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b.is_ascii_whitespace() || b"*,-/".contains(&b))
    {
        return Err("Cron 仅支持标准五段、*、范围、列表、步长与月份/星期缩写".into());
    }
    let zone = Tz::from_str(timezone).map_err(|_| "时区无效，请使用 Asia/Shanghai 等 IANA 时区")?;
    let cron = Cron::from_str(expression).map_err(|e| format!("Cron 表达式无效：{e}"))?;
    Ok((cron, zone))
}

pub fn upcoming(expression: &str, timezone: &str, after: u64, count: usize) -> Reply<Vec<u64>> {
    let (cron, zone) = parse(expression, timezone)?;
    let mut cursor =
        DateTime::<Utc>::from_timestamp_millis(i64::try_from(after).map_err(|_| "时间超出范围")?)
            .ok_or("时间超出范围")?
            .with_timezone(&zone);
    let mut times = Vec::new();
    while times.len() < count {
        cursor = cron
            .find_next_occurrence(&cursor, false)
            .map_err(|e| format!("Cron 没有可用的下次执行时间：{e}"))?;
        // Some parsers normalize a DST gap forward; only dispatch actual cron matches.
        let second_fold = matches!(
            zone.from_local_datetime(&cursor.naive_local()),
            LocalResult::Ambiguous(first, _) if cursor != first
        );
        if !second_fold && cron.is_time_matching(&cursor).map_err(|e| e.to_string())? {
            times.push(cursor.timestamp_millis() as u64);
        }
    }
    Ok(times)
}

fn next(task: &Task, now: u64) -> Reply<Option<u64>> {
    if task.enabled {
        Ok(upcoming(&task.cron, &task.timezone, now, 1)?
            .first()
            .copied())
    } else {
        Ok(None)
    }
}

impl Scheduler {
    pub fn open(root: PathBuf) -> Self {
        let scheduler = Self {
            root,
            state: Mutex::new(State::default()),
        };
        let loaded = (|| -> Reply<Vec<Task>> {
            let path = scheduler.root.join("schedules.json");
            if !path.exists() {
                return Ok(Vec::new());
            }
            let bytes = fs::read(&path).map_err(|e| e.to_string())?;
            let store: FileStore = serde_json::from_slice(&bytes)
                .map_err(|_| "定时任务配置损坏，请保留 schedules.json 供排查")?;
            if store.schema_version != 1 || store.tasks.len() > 100 {
                return Err("定时任务配置版本或数量不受支持".into());
            }
            let mut ids = BTreeSet::new();
            let mut tasks = store.tasks;
            for task in &mut tasks {
                if Uuid::parse_str(&task.id).is_err() || !ids.insert(task.id.clone()) {
                    return Err("定时任务标识损坏或重复".into());
                }
                validate_fields(&task.name, &task.serials)?;
                task.snapshot.workflow.validate()?;
                upcoming(&task.cron, &task.timezone, history::now(), 1)?;
                // Restart never replays missed work or a possibly completed device action.
                if task.last_status.as_deref() == Some("running") {
                    task.last_status = Some("interrupted".into());
                    task.last_message = Some("上次执行因应用退出而中断，未自动重试".into());
                }
                task.next_run_at = next(task, history::now())?;
            }
            scheduler.persist(&tasks)?;
            Ok(tasks)
        })();
        let mut state = scheduler.state.lock().unwrap();
        match loaded {
            Ok(tasks) => state.tasks = tasks,
            Err(error) => state.error = Some(error),
        }
        drop(state);
        scheduler
    }

    fn persist(&self, tasks: &[Task]) -> Reply<()> {
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let bytes = serde_json::to_vec_pretty(&FileStore {
            schema_version: 1,
            tasks: tasks.to_vec(),
        })
        .map_err(|e| e.to_string())?;
        let temporary = self.root.join("schedules.next.json");
        let mut file = File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(temporary, self.root.join("schedules.json"))
            .map_err(|e| format!("保存定时任务失败：{e}"))
    }

    pub fn view(&self) -> Reply<View> {
        let state = self.state.lock().map_err(|_| "调度器状态不可用")?;
        Ok(View {
            tasks: state.tasks.clone(),
            running_ids: state.running.iter().cloned().collect(),
            error: state.error.clone(),
        })
    }

    pub fn save(&self, input: Input) -> Reply<()> {
        validate_fields(&input.name, &input.serials)?;
        upcoming(&input.cron, &input.timezone, history::now(), 1)?;
        self.edit(|tasks, running| {
            let old = if let Some(id) = &input.id {
                let task = tasks.iter().find(|t| &t.id == id).ok_or("定时任务不存在")?;
                if running.contains(id) {
                    return Err("请等待此任务运行结束后编辑".into());
                }
                Some(task.clone())
            } else {
                if tasks.len() >= 100 {
                    return Err("最多保存 100 个定时任务".into());
                }
                None
            };
            let snapshot = match &old {
                Some(task) if task.snapshot.key == input.workflow_key && !input.update_workflow => {
                    task.snapshot.clone()
                }
                _ => registry::load(&self.root)?
                    .installed
                    .into_iter()
                    .find(|w| w.key == input.workflow_key)
                    .ok_or("请先安装并选择工作流")?,
            };
            snapshot.hooks.validate()?;
            if input.enabled
                && !registry::load(&self.root)?
                    .installed
                    .iter()
                    .any(|w| w.key == snapshot.key)
            {
                return Err("工作流已卸载，请先重新安装再启用此任务".into());
            }
            snapshot.workflow.validate_run(snapshot.dry_run)?;
            snapshot.workflow.validate_input(snapshot.input.as_ref())?;
            let mut task = Task {
                id: old
                    .as_ref()
                    .map(|t| t.id.clone())
                    .unwrap_or_else(|| Uuid::new_v4().to_string()),
                name: input.name.trim().into(),
                enabled: input.enabled,
                cron: input.cron.split_whitespace().collect::<Vec<_>>().join(" "),
                timezone: input.timezone,
                serials: input.serials,
                snapshot,
                next_run_at: None,
                last_run_at: old.as_ref().and_then(|t| t.last_run_at),
                last_status: old.as_ref().and_then(|t| t.last_status.clone()),
                last_message: old.as_ref().and_then(|t| t.last_message.clone()),
            };
            task.next_run_at = next(&task, history::now())?;
            if let Some(position) = tasks.iter().position(|t| t.id == task.id) {
                tasks[position] = task;
            } else {
                tasks.push(task);
            }
            Ok(())
        })
    }

    fn edit(&self, edit: impl FnOnce(&mut Vec<Task>, &BTreeSet<String>) -> Reply<()>) -> Reply<()> {
        let mut state = self.state.lock().map_err(|_| "调度器状态不可用")?;
        if let Some(error) = &state.error {
            return Err(error.clone());
        }
        let mut tasks = state.tasks.clone();
        edit(&mut tasks, &state.running)?;
        self.persist(&tasks)?;
        state.tasks = tasks;
        Ok(())
    }

    pub fn enable(&self, id: &str, enabled: bool) -> Reply<()> {
        self.edit(|tasks, _| {
            let task = tasks
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or("定时任务不存在")?;
            task.enabled = enabled;
            if enabled
                && !registry::load(&self.root)?
                    .installed
                    .iter()
                    .any(|w| w.key == task.snapshot.key)
            {
                return Err("工作流已卸载，请先重新安装再启用此定时任务".into());
            }
            task.next_run_at = next(task, history::now())?;
            Ok(())
        })
    }

    pub fn pause_workflow(&self, key: &str) -> Reply<()> {
        self.edit(|tasks, running| {
            if tasks
                .iter()
                .any(|t| t.snapshot.key == key && running.contains(&t.id))
            {
                return Err("此工作流有定时任务正在运行，请结束后卸载".into());
            }
            for task in tasks.iter_mut().filter(|t| t.snapshot.key == key) {
                task.enabled = false;
                task.next_run_at = None;
                task.last_message = Some("绑定的工作流已卸载，任务已暂停".into());
            }
            Ok(())
        })
    }

    pub fn delete(&self, id: &str) -> Reply<()> {
        self.edit(|tasks, running| {
            if running.contains(id) {
                return Err("请等待此任务运行结束后删除".into());
            }
            let position = tasks
                .iter()
                .position(|t| t.id == id)
                .ok_or("定时任务不存在")?;
            tasks.remove(position);
            Ok(())
        })
    }

    pub fn claim_now(&self, id: &str) -> Reply<Dispatch> {
        let mut state = self.state.lock().map_err(|_| "调度器状态不可用")?;
        if let Some(error) = &state.error {
            return Err(error.clone());
        }
        if state.running.contains(id) {
            return Err("此任务正在运行".into());
        }
        let mut tasks = state.tasks.clone();
        let task = tasks
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or("定时任务不存在")?;
        if !registry::load(&self.root)?
            .installed
            .iter()
            .any(|w| w.key == task.snapshot.key)
        {
            return Err("工作流已卸载，请先重新安装再执行此任务".into());
        }
        task.last_run_at = Some(history::now());
        task.last_status = Some("running".into());
        task.last_message = Some("手动触发，准备执行".into());
        let dispatch = Dispatch {
            task: task.clone(),
            trigger: "manual",
            scheduled_at: history::now(),
            skip_reason: None,
            claimed: true,
        };
        self.persist(&tasks)?;
        state.tasks = tasks;
        state.running.insert(id.into());
        Ok(dispatch)
    }

    pub fn tick(&self, now: u64) -> Reply<Vec<Dispatch>> {
        let mut state = self.state.lock().map_err(|_| "调度器状态不可用")?;
        if state.error.is_some() {
            return Ok(Vec::new());
        }
        let mut tasks = state.tasks.clone();
        let mut dispatches = Vec::new();
        for task in &mut tasks {
            let Some(due) = task.next_run_at.filter(|due| task.enabled && *due <= now) else {
                continue;
            };
            let skip_reason = if now.saturating_sub(due) > GRACE_MS {
                Some("错过执行时点（电脑休眠或调度延迟），本轮不补跑".into())
            } else if state.running.contains(&task.id) {
                Some("上一轮尚未结束，本轮跳过".into())
            } else {
                None
            };
            task.next_run_at = next(task, now)?;
            if skip_reason.is_none() {
                task.last_run_at = Some(now);
                task.last_status = Some("running".into());
                task.last_message = Some("Cron 到点，准备执行".into());
            }
            dispatches.push(Dispatch {
                task: task.clone(),
                trigger: "cron",
                scheduled_at: due,
                claimed: skip_reason.is_none(),
                skip_reason,
            });
        }
        if !dispatches.is_empty() {
            // Persist the advanced cursor before dispatch to avoid duplicate actions after a crash.
            self.persist(&tasks)?;
            state.tasks = tasks;
            for dispatch in &dispatches {
                if dispatch.claimed {
                    state.running.insert(dispatch.task.id.clone());
                }
            }
        }
        Ok(dispatches)
    }

    pub fn finish(&self, dispatch: &Dispatch, status: &str, message: &str) -> Reply<()> {
        let mut state = self.state.lock().map_err(|_| "调度器状态不可用")?;
        let mut tasks = state.tasks.clone();
        if dispatch.claimed || !state.running.contains(&dispatch.task.id) {
            if let Some(task) = tasks.iter_mut().find(|t| t.id == dispatch.task.id) {
                task.last_run_at = Some(dispatch.scheduled_at);
                task.last_status = Some(status.into());
                task.last_message = Some(message.into());
            }
        }
        if dispatch.claimed {
            state.running.remove(&dispatch.task.id);
        }
        self.persist(&tasks)?;
        state.tasks = tasks;
        Ok(())
    }

    pub fn report_error(&self, error: String) {
        if let Ok(mut state) = self.state.lock() {
            state.error = Some(error);
        }
    }
}

fn validate_fields(name: &str, serials: &[String]) -> Reply<()> {
    if name.trim().is_empty() || name.len() > 200 || name.chars().any(char::is_control) {
        return Err("任务名称须为 1 至 200 字节，不含控制字符".into());
    }
    if serials.is_empty()
        || serials.len() > 1000
        || !serials.iter().all(|s| valid_serial(s))
        || serials.iter().collect::<BTreeSet<_>>().len() != serials.len()
    {
        return Err("请选择 1 至 1000 台手机，设备标识不能重复或为空".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn time(value: &str) -> u64 {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .timestamp_millis() as u64
    }

    fn scheduler() -> Scheduler {
        let root = std::env::temp_dir().join(format!("por-cron-{}", Uuid::new_v4()));
        let scheduler = Scheduler::open(root);
        let key = registry::load(&scheduler.root).unwrap().installed[0]
            .key
            .clone();
        scheduler
            .save(Input {
                id: None,
                name: "每日检查".into(),
                enabled: true,
                cron: "* * * * *".into(),
                timezone: "Asia/Shanghai".into(),
                serials: vec!["device-A".into(), "device-B".into()],
                workflow_key: key,
                update_workflow: false,
            })
            .unwrap();
        scheduler
    }

    #[test]
    fn standard_cron_timezones_and_dst() {
        assert_eq!(
            upcoming(
                "0 9 * * *",
                "Asia/Shanghai",
                time("2026-10-15T00:00:00Z"),
                1
            )
            .unwrap(),
            vec![time("2026-10-15T01:00:00Z")]
        );
        // A nonexistent local time is skipped during spring DST.
        assert_eq!(
            upcoming(
                "30 2 * * *",
                "America/New_York",
                time("2026-03-08T05:00:00Z"),
                1
            )
            .unwrap(),
            vec![time("2026-03-09T06:30:00Z")]
        );
        for pattern in [
            "0 0 9 * * *",
            "61 * * * *",
            "* * * * ?",
            "0 0 L * *",
            "0 0 31 2 *",
        ] {
            assert!(
                upcoming(pattern, "Asia/Shanghai", history::now(), 1).is_err(),
                "{pattern}"
            );
        }
        assert!(upcoming("* * * * *", "bad-zone", history::now(), 1).is_err());
        let repeated = upcoming(
            "30 1 * * *",
            "America/New_York",
            time("2026-11-01T04:00:00Z"),
            2,
        )
        .unwrap();
        assert_eq!(
            repeated,
            vec![time("2026-11-01T05:30:00Z"), time("2026-11-02T06:30:00Z")]
        );
        assert_eq!(
            upcoming(
                "30 1 * * *",
                "America/New_York",
                time("2026-11-01T06:00:00Z"),
                1
            )
            .unwrap(),
            vec![time("2026-11-02T06:30:00Z")]
        );
        // DOM and DOW follow Vixie OR semantics.
        assert_eq!(
            upcoming("0 0 1 * MON", "UTC", time("2026-10-02T00:00:00Z"), 1).unwrap(),
            vec![time("2026-10-05T00:00:00Z")]
        );
    }

    #[test]
    fn cursor_persistence_overlap_and_misfire() {
        let scheduler = scheduler();
        let first = scheduler.view().unwrap().tasks[0].clone();
        let due = first.next_run_at.unwrap();
        let dispatch = scheduler.tick(due).unwrap().remove(0);
        assert!(scheduler.tick(due).unwrap().is_empty());
        assert!(scheduler.claim_now(&first.id).is_err());
        assert!(scheduler.delete(&first.id).is_err());
        let overlap = scheduler.tick(due + 60_000).unwrap().remove(0);
        assert!(overlap.skip_reason.unwrap().contains("上一轮"));
        scheduler.finish(&dispatch, "completed", "完成").unwrap();
        let late = scheduler.tick(due + 240_000).unwrap().remove(0);
        assert!(late.skip_reason.unwrap().contains("错过"));
        scheduler.enable(&first.id, false).unwrap();
        assert!(scheduler.view().unwrap().tasks[0].next_run_at.is_none());
        assert!(scheduler.tick(due + 300_000).unwrap().is_empty());
        let manual = scheduler.claim_now(&first.id).unwrap();
        let reopened = Scheduler::open(scheduler.root.clone());
        let view = reopened.view().unwrap();
        assert!(view.running_ids.is_empty());
        assert_eq!(view.tasks[0].last_status.as_deref(), Some("interrupted"));
        assert_eq!(
            view.tasks[0].snapshot.workflow.version,
            first.snapshot.workflow.version
        );
        scheduler.finish(&manual, "completed", "手动完成").unwrap();
        scheduler.delete(&first.id).unwrap();
        assert!(Scheduler::open(scheduler.root.clone())
            .view()
            .unwrap()
            .tasks
            .is_empty());
        fs::remove_dir_all(&scheduler.root).unwrap();
    }

    #[test]
    fn corrupt_store_is_visible_and_not_overwritten() {
        let root = std::env::temp_dir().join(format!("por-cron-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("schedules.json"), b"bad").unwrap();
        let scheduler = Scheduler::open(root.clone());
        assert!(scheduler.view().unwrap().error.is_some());
        assert!(scheduler.enable("test", true).is_err());
        assert_eq!(fs::read(root.join("schedules.json")).unwrap(), b"bad");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn editing_preserves_snapshot_until_explicit_update() {
        let scheduler = scheduler();
        let task = scheduler.view().unwrap().tasks[0].clone();
        let mut store = registry::load(&scheduler.root).unwrap();
        store.installed[0].workflow.version = "3.0.0".into();
        store.installed[0].commit = "updated-commit".into();
        store.installed[0].hooks=serde_json::from_value(serde_json::json!({"beforeRun":null,"afterRun":{"url":"https://example.com/result","method":"POST","auth":{"type":"none"},"body":{"status":"{{run.status}}"},"response":{"type":"ignore"}}})).unwrap();
        registry::save(&scheduler.root, &store).unwrap();
        let input = |update_workflow| Input {
            id: Some(task.id.clone()),
            name: "离线设备也保留".into(),
            enabled: true,
            cron: task.cron.clone(),
            timezone: task.timezone.clone(),
            serials: task.serials.clone(),
            workflow_key: task.snapshot.key.clone(),
            update_workflow,
        };
        scheduler.save(input(false)).unwrap();
        let unchanged = scheduler.view().unwrap().tasks[0].clone();
        assert_eq!(
            unchanged.snapshot.workflow.version,
            task.snapshot.workflow.version
        );
        assert_eq!(unchanged.serials, task.serials);
        assert!(unchanged.snapshot.hooks.after_run.is_none());
        scheduler.save(input(true)).unwrap();
        assert_eq!(
            scheduler.view().unwrap().tasks[0].snapshot.workflow.version,
            "3.0.0"
        );
        assert!(scheduler.view().unwrap().tasks[0]
            .snapshot
            .hooks
            .after_run
            .is_some());
        assert!(validate_fields("重复设备", &["A".into(), "A".into()]).is_err());
        fs::remove_dir_all(scheduler.root).unwrap();
    }

    #[test]
    fn uninstalled_workflow_cannot_be_reenabled_or_run_through_a_snapshot() {
        let scheduler = scheduler();
        let task = scheduler.view().unwrap().tasks[0].clone();
        scheduler.pause_workflow(&task.snapshot.key).unwrap();
        registry::uninstall(&scheduler.root, &task.snapshot.key).unwrap();
        assert!(!scheduler.view().unwrap().tasks[0].enabled);
        assert!(scheduler.claim_now(&task.id).is_err());
        assert!(scheduler.enable(&task.id, true).is_err());
        assert!(scheduler
            .save(Input {
                id: Some(task.id.clone()),
                name: task.name,
                enabled: true,
                cron: task.cron,
                timezone: task.timezone,
                serials: task.serials,
                workflow_key: task.snapshot.key,
                update_workflow: false
            })
            .is_err());
        assert!(!scheduler.view().unwrap().tasks[0].enabled);
        fs::remove_dir_all(scheduler.root).unwrap();
    }

    #[test]
    fn failed_cursor_write_does_not_claim_or_dispatch() {
        let scheduler = scheduler();
        let due = scheduler.view().unwrap().tasks[0].next_run_at.unwrap();
        let temporary = scheduler.root.join("schedules.next.json");
        fs::create_dir(&temporary).unwrap();
        assert!(scheduler.tick(due).is_err());
        assert!(scheduler.view().unwrap().running_ids.is_empty());
        assert_eq!(scheduler.view().unwrap().tasks[0].next_run_at, Some(due));
        fs::remove_dir(temporary).unwrap();
        assert_eq!(scheduler.tick(due).unwrap().len(), 1);
        fs::remove_dir_all(scheduler.root).unwrap();
    }
}
