use crate::android;
use reqwest::{blocking::Client, redirect::Policy};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

pub const VERSION: &str = "0.4.0";
const SHA256: &str = "0b74e83c55f443539a9f76f5ce023a51466b764b1100e4097a897053fdfc0eb6";
const REMOTE: &str = "/data/local/tmp/por-u2-0.4.0.jar";
const DEVICE_PORT: &str = "tcp:9010";

pub fn verify(jar: &Path) -> Result<(), String> {
    let bytes = fs::read(jar).map_err(|e| format!("无法读取自动化组件：{e}"))?;
    if format!("{:x}", Sha256::digest(&bytes)) != SHA256 {
        return Err("自动化组件校验失败，请重新安装软件".into());
    }
    Ok(())
}

// No automatic RPC retry: a timed-out click may already have sent a message.
pub trait Automation {
    fn rpc(&self, method: &str, params: Value) -> Result<Value, String>;

    fn settle(&self) {
        thread::sleep(Duration::from_millis(500));
    }

    fn dump(&self) -> Result<String, String> {
        self.rpc("dumpWindowHierarchy", json!([false, 80]))?
            .as_str()
            .filter(|xml| !xml.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| "无法读取手机页面，请解锁手机并关闭弹窗".into())
    }

    fn click(&self, x: i32, y: i32) -> Result<(), String> {
        self.expect_true("click", json!([x, y]))
    }

    fn expect_true(&self, method: &str, params: Value) -> Result<(), String> {
        if self.rpc(method, params)? == Value::Bool(true) {
            Ok(())
        } else {
            Err(format!("手机未完成操作 {method}，已停止"))
        }
    }
}

pub struct Session {
    adb: PathBuf,
    serial: String,
    port: String,
    client: Client,
    process: Option<Child>,
}

impl Session {
    pub fn start(adb: &Path, serial: &str, jar: &Path, folder: &Path) -> Result<Self, String> {
        verify(jar)?;
        android::text(adb, &["-s", serial, "push", &jar.to_string_lossy(), REMOTE])?;
        let port = android::text(adb, &["-s", serial, "forward", "tcp:0", DEVICE_PORT])?;
        let port = port.trim().to_owned();
        if port.parse::<u16>().ok().filter(|p| *p > 0).is_none() {
            return Err("无法建立自动化组件连接".into());
        }
        let mut session = Self {
            adb: adb.into(),
            serial: serial.into(),
            port,
            client: Client::builder()
                .no_proxy()
                .redirect(Policy::none())
                .retry(reqwest::retry::never())
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(15))
                .build()
                .map_err(|e| e.to_string())?,
            process: None,
        };
        // Stop only our dedicated port; leave other automation tools untouched.
        let _ = session
            .client
            .get(session.url("/stop"))
            .timeout(Duration::from_secs(2))
            .send();
        let log = File::create(folder.join("u2-server.log")).map_err(|e| e.to_string())?;
        let mut command = Command::new(adb);
        command
            .args([
                "-s",
                serial,
                "shell",
                &format!("CLASSPATH={REMOTE} app_process / com.wetest.uia2.Main -p 9010"),
            ])
            .stdin(Stdio::null())
            .stdout(log.try_clone().map_err(|e| e.to_string())?)
            .stderr(log);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        session.process = Some(
            command
                .spawn()
                .map_err(|e| format!("启动自动化组件失败：{e}"))?,
        );
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if session
                .client
                .get(session.url("/ping"))
                .timeout(Duration::from_secs(1))
                .send()
                .and_then(|r| r.error_for_status())
                .and_then(|r| r.text())
                .is_ok_and(|s| s == "pong")
            {
                session.rpc("deviceInfo", json!([]))?;
                return Ok(session);
            }
            if session
                .process
                .as_mut()
                .and_then(|p| p.try_wait().ok())
                .flatten()
                .is_some()
            {
                break;
            }
            thread::sleep(Duration::from_millis(250));
        }
        Err("手机自动化服务未就绪，请解锁手机、关闭其他自动化工具后重试；服务日志已保存".into())
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }
}

fn parse_response(value: Value) -> Result<Value, String> {
    if value.get("id") != Some(&json!(1)) || value.get("jsonrpc") != Some(&json!("2.0")) {
        return Err("自动化服务响应不匹配，已停止".into());
    }
    if let Some(error) = value.get("error").filter(|e| !e.is_null()) {
        return Err(format!(
            "手机自动化操作失败：{}",
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("服务异常")
        ));
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| "自动化服务响应缺少结果".into())
}

impl Automation for Session {
    fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
        let response = self
            .client
            .post(self.url("/jsonrpc/0"))
            .json(&json!({"jsonrpc":"2.0", "id":1, "method":method, "params":params}))
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| {
                format!("自动化服务 {method} 连接中断或超时，操作结果可能不明，请检查手机")
            })?;
        let mut bytes = Vec::new();
        response
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("手机页面结构超出大小限制".into());
        }
        parse_response(serde_json::from_slice(&bytes).map_err(|_| "自动化服务返回无效数据")?)
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self
            .client
            .get(self.url("/stop"))
            .timeout(Duration::from_secs(2))
            .send();
        if let Some(process) = &mut self.process {
            let _ = process.kill();
            let _ = process.wait();
        }
        let _ = android::text(
            &self.adb,
            &[
                "-s",
                &self.serial,
                "forward",
                "--remove",
                &format!("tcp:{}", self.port),
            ],
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_rpc_errors_ids_and_results_without_retry() {
        assert_eq!(
            parse_response(json!({"jsonrpc":"2.0","id":1,"result":true})).unwrap(),
            json!(true)
        );
        assert!(parse_response(json!({"jsonrpc":"2.0","id":2,"result":true})).is_err());
        assert!(
            parse_response(json!({"jsonrpc":"2.0","id":1,"error":{"message":"not found"}}))
                .unwrap_err()
                .contains("not found")
        );
        assert!(parse_response(json!({"jsonrpc":"2.0","id":1})).is_err());
    }
}
