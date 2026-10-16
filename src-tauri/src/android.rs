use serde::Serialize;
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::Duration,
};
use wait_timeout::ChildExt;

#[derive(Debug, Clone, Serialize)]
pub struct Device {
    pub serial: String,
    pub state: String,
    pub model: String,
}

pub fn parse_devices(text: &str) -> Vec<Device> {
    text.lines()
        .filter_map(|line| {
            let parts: Vec<_> = line.split_whitespace().collect();
            if parts.len() < 2 || line.starts_with('*') || line.starts_with("List ") {
                return None;
            }
            if ![
                "device",
                "unauthorized",
                "offline",
                "recovery",
                "sideload",
                "no",
            ]
            .contains(&parts[1])
            {
                return None;
            }
            Some(Device {
                serial: parts[0].into(),
                state: parts[1].into(),
                model: parts
                    .iter()
                    .find_map(|p| p.strip_prefix("model:"))
                    .unwrap_or("Android 手机")
                    .replace('_', " "),
            })
        })
        .collect()
}

pub fn run(adb: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let mut command = Command::new(adb);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动手机连接组件：{e}"))?;
    let mut stdout = child.stdout.take().ok_or("无法读取连接组件输出")?;
    let mut stderr = child.stderr.take().ok_or("无法读取连接组件错误")?;
    let out_reader = thread::spawn(move || {
        let mut b = Vec::new();
        stdout.read_to_end(&mut b).map(|_| b)
    });
    let err_reader = thread::spawn(move || {
        let mut b = Vec::new();
        stderr.read_to_end(&mut b).map(|_| b)
    });
    let status = match child.wait_timeout(Duration::from_secs(25)) {
        Ok(Some(status)) => Ok(status),
        result => {
            let _ = child.kill();
            let _ = child.wait();
            match result {
                Ok(None) => Err("手机响应超时，请解锁手机、检查 USB 连接后重试".to_string()),
                Err(e) => Err(format!("等待手机响应失败：{e}")),
                _ => unreachable!(),
            }
        }
    };
    let output = out_reader
        .join()
        .map_err(|_| "读取手机输出失败")?
        .map_err(|e| e.to_string())?;
    let errors = err_reader
        .join()
        .map_err(|_| "读取手机错误失败")?
        .map_err(|e| e.to_string())?;
    if !status?.success() {
        return Err(format!(
            "手机操作失败：{}",
            String::from_utf8_lossy(&errors).trim()
        ));
    }
    Ok(output)
}

pub fn text(adb: &Path, args: &[&str]) -> Result<String, String> {
    String::from_utf8(run(adb, args)?).map_err(|_| "手机返回了无法识别的文字".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_device_authorization_states_separate() {
        let devices = parse_devices("List of devices attached\na unauthorized\nb device product:x model:Pixel_8 transport_id:1\nc offline\n* daemon started successfully\n");
        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0].state, "unauthorized");
        assert_eq!(devices[1].serial, "b");
        assert_eq!(devices[1].model, "Pixel 8");
        assert!(parse_devices("List of devices attached\n").is_empty());
    }
}
