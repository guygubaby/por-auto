use crate::android;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const PACKAGE: &str = "com.por.auto.input";
const IME: &str = "com.por.auto.input/.PorInputMethod";
const APK: &[u8] = include_bytes!("../../native/android-input/artifacts/por-input.apk");

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
fn selected(value: &str) -> bool {
    value == IME || value == "com.por.auto.input/com.por.auto.input.PorInputMethod"
}
fn packet(value: &str) -> Result<Value, String> {
    let json = value
        .trim()
        .strip_prefix("Result: Bundle[{result=")
        .and_then(|s| s.strip_suffix("}]"))
        .ok_or("输入组件没有返回有效结果，未自动重试")?;
    serde_json::from_str(json).map_err(|_| "输入组件返回格式无效，未自动重试".into())
}
fn success(value: Value) -> Result<Value, String> {
    if value["ok"] != true {
        let code = value["error"].as_str().unwrap_or("INVALID_RESPONSE");
        return Err(format!(
            "原生输入未完成：{code}；未自动重试，请检查手机草稿"
        ));
    }
    if value["protocolVersion"] != 1 || value["versionCode"].as_u64().unwrap_or(0) < 1 {
        return Err("输入组件版本不兼容，请重新初始化连接组件".into());
    }
    Ok(value)
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    package_name: String,
    pub session_id: String,
    pub text: String,
    complete: bool,
    pub ime_action: u32,
    owner_id: Option<String>,
}
fn frame(value: Value, package: &str) -> Result<Frame, String> {
    let result: Frame =
        serde_json::from_value(success(value)?).map_err(|_| "无法完整读取原生输入框")?;
    if !result.complete
        || result.package_name != package
        || result.text.len() > 4000
        || result.session_id.is_empty()
        || result.session_id.len() > 100
        || !result
            .session_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err("原生输入框位置或内容不完整，未输入或清理".into());
    }
    Ok(result)
}
struct Owned {
    session: String,
    owner: String,
    text: String,
}
pub struct Session {
    adb: PathBuf,
    serial: String,
    package: String,
    original_ime: String,
    changed: bool,
    owned: Option<Owned>,
    last_session: Option<String>,
}
impl Session {
    pub fn start(adb: &Path, serial: &str, folder: &Path, package: &str) -> Result<Self, String> {
        if !["com.tencent.mm", "com.tencent.wework"].contains(&package) {
            return Err("输入组件不支持目标应用".into());
        }
        let manifest: Value = serde_json::from_str(include_str!(
            "../../native/android-input/artifacts/manifest.json"
        ))
        .map_err(|_| "输入组件清单无效")?;
        if manifest["sha256"].as_str() != Some(format!("{:x}", Sha256::digest(APK)).as_str()) {
            return Err("输入组件校验失败，请重新安装软件".into());
        }
        let installed = android::text(
            adb,
            &["-s", serial, "shell", "pm", "list", "packages", PACKAGE],
        )?;
        let exact = if installed
            .lines()
            .any(|line| line.trim() == format!("package:{PACKAGE}"))
        {
            let paths = android::text(adb, &["-s", serial, "shell", "pm", "path", PACKAGE])?;
            let paths: Vec<_> = paths
                .lines()
                .filter_map(|line| line.trim().strip_prefix("package:"))
                .collect();
            if paths.len() != 1 {
                return Err("输入组件安装路径不唯一，请重新安装组件".into());
            }
            let path = paths[0];
            if !path.starts_with("/data/app/")
                || !path.ends_with("/base.apk")
                || path.chars().any(char::is_control)
            {
                return Err("输入组件安装位置无法验证".into());
            }
            let command = format!("cat {}", quote(path));
            android::run(adb, &["-s", serial, "exec-out", &command])? == APK
        } else {
            false
        };
        if !exact {
            fs::create_dir_all(folder).map_err(|e| e.to_string())?;
            let filename = format!("por-input-{}.apk", uuid::Uuid::new_v4());
            let path = folder.join(&filename);
            fs::write(&path, APK).map_err(|e| e.to_string())?;
            let mut command = Command::new(adb);
            command
                .current_dir(folder)
                .args(["-s", serial, "install", "-r"])
                .arg(&filename);
            let result = android::run_command(&mut command);
            let _ = fs::remove_file(path);
            let output = result.map_err(|e| {
                format!("{e}；请在手机确认「Por Auto 输入组件」安装，完成后重新运行")
            })?;
            if !String::from_utf8_lossy(&output)
                .lines()
                .any(|line| line.trim() == "Success")
            {
                return Err("输入组件未安装成功，请在手机确认安装后重新运行".into());
            }
        }
        let original_ime = android::text(
            adb,
            &[
                "-s",
                serial,
                "shell",
                "settings",
                "get",
                "secure",
                "default_input_method",
            ],
        )?
        .trim()
        .to_string();
        if !original_ime.contains('/') || original_ime.chars().any(char::is_control) {
            return Err("无法读取原键盘设置，未切换输入组件".into());
        }
        let mut result = Self {
            adb: adb.into(),
            serial: serial.into(),
            package: package.into(),
            original_ime,
            changed: false,
            owned: None,
            last_session: None,
        };
        if !selected(&result.original_ime) {
            android::text(adb, &["-s", serial, "shell", "ime", "enable", IME])?;
            result.changed = true;
            android::text(adb, &["-s", serial, "shell", "ime", "set", IME])?;
            let current = result.current_ime()?;
            if !selected(&current) {
                return Err("手机没有切换到输入组件，请检查手机设置".into());
            }
        }
        success(result.call("status", json!({}))?)?;
        Ok(result)
    }
    fn current_ime(&self) -> Result<String, String> {
        android::text(
            &self.adb,
            &[
                "-s",
                &self.serial,
                "shell",
                "settings",
                "get",
                "secure",
                "default_input_method",
            ],
        )
        .map(|s| s.trim().to_string())
    }
    fn call(&self, method: &str, mut data: Value) -> Result<Value, String> {
        data["protocolVersion"] = json!(1);
        let argument = quote(&data.to_string());
        let result = android::text(
            &self.adb,
            &[
                "-s",
                &self.serial,
                "shell",
                "content",
                "call",
                "--uri",
                "content://com.por.auto.input",
                "--method",
                method,
                "--arg",
                &argument,
            ],
        )?;
        packet(&result)
    }
    pub fn read(&self) -> Result<Option<Frame>, String> {
        let value = self.call("read", json!({"packageName":self.package}))?;
        if value["ok"] == false
            && matches!(
                value["error"].as_str(),
                Some("NO_EDITOR" | "PRIVATE_OR_UNSUPPORTED_EDITOR" | "IME_NOT_SELECTED")
            )
        {
            return Ok(None);
        }
        frame(value, &self.package).map(Some)
    }
    pub fn write(&mut self, text: &str) -> Result<(), String> {
        crate::send_input::validate_message(text)?;
        let before = self.read()?.ok_or("尚未获得文字输入焦点，未输入")?;
        if !before.text.is_empty() {
            return Err("输入框已有草稿，未覆盖".into());
        }
        let value = self.call("write", json!({"packageName":self.package,"sessionId":before.session_id,"requestId":uuid::Uuid::new_v4().to_string(),"text":text}))?;
        let after = frame(value, &self.package)?;
        let owner = after
            .owner_id
            .filter(|id| !id.is_empty() && id.len() <= 100)
            .ok_or("原生输入没有返回草稿标识，未自动重试")?;
        if after.session_id != before.session_id || after.text != text {
            return Err("原生输入结果不明，未自动重试".into());
        }
        self.last_session = Some(after.session_id.clone());
        self.owned = Some(Owned {
            session: after.session_id,
            owner,
            text: text.into(),
        });
        Ok(())
    }
    pub fn verify_owned(&self, text: &str) -> Result<(), String> {
        let before = self.read()?.ok_or("输入连接已停止，未发送或清理")?;
        let owned = self
            .owned
            .as_ref()
            .ok_or("当前草稿不属于本轮，未发送或清理")?;
        if owned.session != before.session_id || before.text != text || owned.text != text {
            return Err("输入框或草稿内容已变化，未发送或清理".into());
        }
        Ok(())
    }
    pub fn clear(&mut self, text: &str) -> Result<(), String> {
        self.verify_owned(text)?;
        let owned = self.owned.as_ref().unwrap();
        let value = self.call("clearOwned", json!({"packageName":self.package,"sessionId":owned.session,"requestId":uuid::Uuid::new_v4().to_string(),"ownerId":owned.owner}))?;
        let after = frame(value, &self.package)?;
        if after.session_id != owned.session || !after.text.is_empty() {
            return Err("原生草稿清理结果不明，未自动重试".into());
        }
        self.owned = None;
        Ok(())
    }
    pub fn observed(&self) -> Result<Option<Frame>, String> {
        if self.last_session.is_none() {
            return Ok(None);
        }
        Ok(self
            .read()?
            .filter(|frame| Some(&frame.session_id) == self.last_session.as_ref()))
    }
    pub fn restore(&mut self) -> Result<(), String> {
        if !std::mem::take(&mut self.changed) {
            return Ok(());
        }
        if selected(&self.current_ime()?) {
            let command = format!("ime set {}", quote(&self.original_ime));
            android::text(&self.adb, &["-s", &self.serial, "shell", &command])?;
            if self.current_ime()? != self.original_ime {
                return Err("原键盘恢复未完成，请在手机选择原来的键盘".into());
            }
        }
        Ok(())
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "requires an authorized phone; checks installed bytes and read-only Binder transport only"]
    fn real_device_read_only_transport() {
        let adb = PathBuf::from(std::env::var("POR_TEST_ADB").expect("POR_TEST_ADB"));
        let serial = std::env::var("POR_TEST_SERIAL").expect("POR_TEST_SERIAL");
        assert!(crate::schedule::valid_serial(&serial));
        let paths = android::text(&adb, &["-s", &serial, "shell", "pm", "path", PACKAGE]).unwrap();
        let path = paths
            .trim()
            .strip_prefix("package:")
            .expect("single installed APK");
        let command = format!("cat {}", quote(path));
        assert_eq!(
            android::run(&adb, &["-s", &serial, "exec-out", &command]).unwrap(),
            APK
        );
        let client = Session {
            adb,
            serial,
            package: "com.tencent.mm".into(),
            original_ime: String::new(),
            changed: false,
            owned: None,
            last_session: None,
        };
        let status = success(client.call("status", json!({})).unwrap()).unwrap();
        assert_eq!(status["protocolVersion"], 1);
        assert!(status["versionCode"].as_u64().unwrap() >= 1);
        println!("Installed signed APK and desktop read-only transport: PASSED");
    }
    #[test]
    fn native_text_is_parsed_as_data_and_requires_complete_target_and_session() {
        let body = json!({"ok":true,"protocolVersion":1,"versionCode":1,"packageName":"com.tencent.mm","sessionId":"session-a","text":"你好\n'$(printf bad)' }]","complete":true,"imeAction":6});
        let output = format!("Result: Bundle[{{result={body}}}]\n");
        assert_eq!(
            frame(packet(&output).unwrap(), "com.tencent.mm")
                .unwrap()
                .text,
            body["text"]
        );
        assert!(frame(body.clone(), "other.app").is_err());
        let mut partial = body.clone();
        partial["complete"] = json!(false);
        assert!(frame(partial, "com.tencent.mm").is_err());
        assert!(packet("Result: Bundle[{result=null}] injected").is_err());
        assert!(success(json!({"ok":false,"error":"EDIT_UNKNOWN_NO_REPLAY"})).is_err());
    }
    #[test]
    #[cfg(unix)]
    fn shell_transport_preserves_unicode_quotes_newlines_and_dollar_signs() {
        let value = "你好\n'$(printf bad)'`printf bad`$PATH";
        let output = Command::new("sh")
            .args(["-c", &format!("printf %s {}", quote(value))])
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap(), value);
    }
    #[test]
    #[cfg(unix)]
    fn keyboard_cleanup_restores_only_its_own_selection_and_never_repeats_a_failed_attempt() {
        use std::os::unix::fs::PermissionsExt;
        for (mode, current, calls) in [
            ("normal", IME, 3),
            ("user", "user.keyboard/.Board", 1),
            ("offline", IME, 1),
        ] {
            let folder =
                std::env::temp_dir().join(format!("Por Auto 输入 {}", uuid::Uuid::new_v4()));
            fs::create_dir(&folder).unwrap();
            let state = folder.join("state");
            let log = folder.join("calls");
            let adb = folder.join("adb");
            fs::write(&state, current).unwrap();
            let script=format!("#!/bin/sh\nprintf x >> {}\n{}\nif [ \"$4\" = settings ]; then cat {}; else printf %s daily.keyboard/.Board > {}; fi\n",quote(&log.to_string_lossy()),if mode=="offline"{"echo offline >&2; exit 1"}else{""},quote(&state.to_string_lossy()),quote(&state.to_string_lossy()));
            fs::write(&adb, script).unwrap();
            fs::set_permissions(&adb, fs::Permissions::from_mode(0o755)).unwrap();
            let mut session = Session {
                adb,
                serial: "test-device".into(),
                package: "com.tencent.mm".into(),
                original_ime: "daily.keyboard/.Board".into(),
                changed: true,
                owned: None,
                last_session: None,
            };
            assert_eq!(session.restore().is_err(), mode == "offline");
            drop(session);
            assert_eq!(fs::read(&log).unwrap().len(), calls);
            assert_eq!(
                fs::read_to_string(&state).unwrap(),
                if mode == "normal" {
                    "daily.keyboard/.Board"
                } else {
                    current
                }
            );
            fs::remove_dir_all(folder).unwrap();
        }
    }
}
