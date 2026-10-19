use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Deserialize, Serialize)]
pub struct Summary {
    pub id: String,
    pub workflow_name: String,
    pub workflow_version: String,
    pub serial: String,
    pub timestamp: u64,
    pub status: String,
    pub error: Option<String>,
    #[serde(default)]
    pub schedule_id: Option<String>,
    #[serde(default)]
    pub schedule_name: Option<String>,
    #[serde(default)]
    pub trigger: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct Event {
    pub timestamp: u64,
    pub step: usize,
    pub status: String,
    pub message: String,
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn create_folder(root: &Path) -> Result<(String, PathBuf), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut id = now();
    loop {
        let path = root.join(id.to_string());
        match fs::create_dir(&path) {
            Ok(()) => return Ok((id.to_string(), path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => id += 1,
            Err(e) => return Err(format!("创建运行目录失败：{e}")),
        }
    }
}

pub fn log(folder: &Path, step: usize, status: &str, message: &str) -> Result<(), String> {
    let event = Event {
        timestamp: now(),
        step,
        status: status.into(),
        message: message.into(),
    };
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(folder.join("events.jsonl"))
        .map_err(|e| e.to_string())?;
    serde_json::to_writer(&mut file, &event).map_err(|e| e.to_string())?;
    file.write_all(b"\n")
        .and_then(|_| file.flush())
        .map_err(|e| format!("保存运行日志失败：{e}"))
}

pub fn save_summary(folder: &Path, summary: &Summary) -> Result<(), String> {
    let temporary = folder.join("meta.next.json");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(summary).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, folder.join("meta.json")).map_err(|e| e.to_string())
}

fn run_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 20 || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("运行记录标识无效".into());
    }
    let path = root.join(id);
    if fs::symlink_metadata(&path)
        .map_err(|_| "运行记录不存在")?
        .file_type()
        .is_symlink()
        || path.canonicalize().map_err(|e| e.to_string())?.parent()
            != Some(root.canonicalize().map_err(|e| e.to_string())?.as_path())
    {
        return Err("运行记录路径无效".into());
    }
    Ok(path)
}

pub fn list(root: &Path) -> Result<Vec<Summary>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let id = entry.file_name().to_string_lossy().into_owned();
        let Ok(path) = run_path(root, &id) else {
            continue;
        };
        if !path.join("meta.json").is_file() {
            continue;
        }
        let record: Summary =
            serde_json::from_slice(&fs::read(path.join("meta.json")).map_err(|e| e.to_string())?)
                .map_err(|_| format!("运行记录 {id} 的元数据损坏，请保留目录供排查"))?;
        records.push(record);
    }
    records.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(records)
}

pub fn details(root: &Path, id: &str) -> Result<Value, String> {
    let path = run_path(root, id)?;
    let summary: Summary =
        serde_json::from_slice(&fs::read(path.join("meta.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let mut logs = Vec::new();
    if path.join("events.jsonl").is_file() {
        for line in fs::read_to_string(path.join("events.jsonl"))
            .map_err(|e| e.to_string())?
            .lines()
        {
            match serde_json::from_str::<Event>(line) {
                Ok(event) => logs.push(serde_json::to_value(event).map_err(|e| e.to_string())?),
                Err(_) => logs.push(json!({ "status": "incomplete", "message": "日志末尾存在未写完的记录，可能因进程中断" })),
            }
        }
    }
    let load_json = |name: &str| -> Result<Value, String> {
        let file = path.join(name);
        if !file.exists() {
            return Ok(Value::Null);
        }
        serde_json::from_slice(&fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    };
    let hierarchy = fs::read_to_string(path.join("hierarchy.xml")).ok();
    let diagnostics: serde_json::Map<String, Value> = [
        "u2-server.log",
        "chat-list.xml",
        "chat-open.xml",
        "before-send.xml",
        "after-send.xml",
        "native-hierarchy.xml",
        "ocr-hierarchy.xml",
        "ocr-words.json",
        "launch.txt",
    ]
    .into_iter()
    .filter_map(|name| {
        fs::read_to_string(path.join(name))
            .ok()
            .map(|text| (name.into(), json!(text)))
    })
    .collect();
    Ok(
        json!({ "summary": summary, "logs": logs, "result": load_json("result.json")?, "workflow": load_json("workflow.json")?, "hierarchy": hierarchy, "diagnostics": diagnostics }),
    )
}

pub fn export(root: &Path, ids: &[String]) -> Result<Value, String> {
    if ids.is_empty() || ids.len() > 100 {
        return Err("每次请选择 1 至 100 条记录导出".into());
    }
    let records = ids
        .iter()
        .map(|id| details(root, id))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(
        json!({ "schemaVersion": 1, "appVersion": env!("CARGO_PKG_VERSION"), "exportedAt": now(), "records": records }),
    )
}

pub fn delete(root: &Path, ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Err("请先选择运行记录".into());
    }
    let paths = ids
        .iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|id| run_path(root, id))
        .collect::<Result<Vec<_>, _>>()?;
    for path in paths {
        fs::remove_dir_all(path).map_err(|e| format!("部分记录清理失败，请刷新列表后重试：{e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_survive_restart_export_and_batch_cleanup() {
        let root = std::env::temp_dir().join(format!("por-history-{}", std::process::id()));
        for id in ["100", "200"] {
            let folder = root.join(id);
            fs::create_dir_all(&folder).unwrap();
            save_summary(
                &folder,
                &Summary {
                    id: id.into(),
                    workflow_name: "测试流程".into(),
                    workflow_version: "1.0.0".into(),
                    serial: "test-device".into(),
                    timestamp: id.parse().unwrap(),
                    status: "failed".into(),
                    error: Some("手机断开".into()),
                    schedule_id: None,
                    schedule_name: None,
                    trigger: None,
                },
            )
            .unwrap();
            log(&folder, 1, "started", "准备操作").unwrap();
            log(&folder, 1, "failed", "手机断开").unwrap();
            fs::write(folder.join("before-send.xml"), "<hierarchy/> ").unwrap();
            fs::write(folder.join("u2-server.log"), "uiautomator2 starting").unwrap();
        }
        assert_eq!(list(&root).unwrap()[0].id, "200");
        let ids = vec!["100".into(), "200".into()];
        let exported = export(&root, &ids).unwrap();
        assert_eq!(exported["records"].as_array().unwrap().len(), 2);
        assert_eq!(exported["records"][0]["logs"][1]["status"], "failed");
        assert_eq!(
            exported["records"][0]["diagnostics"]["before-send.xml"],
            "<hierarchy/> "
        );
        assert!(exported["records"][0]["diagnostics"]["u2-server.log"]
            .as_str()
            .unwrap()
            .contains("uiautomator2"));
        assert!(delete(&root, &["../100".into()]).is_err());
        assert_eq!(list(&root).unwrap().len(), 2);
        delete(&root, &ids).unwrap();
        assert!(list(&root).unwrap().is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
