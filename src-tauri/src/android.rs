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
    command.args(args);
    run_command(&mut command)
}

fn push_command(adb: &Path, serial: &str, local: &Path, remote: &str) -> Result<Command, String> {
    let directory = local
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or("自动化组件路径缺少目录")?;
    let filename = local.file_name().ok_or("自动化组件路径缺少文件名")?;
    let mut command = Command::new(adb);
    // Avoid Windows verbatim-path compatibility differences in ADB by passing only the filename.
    command
        .current_dir(directory)
        .args(["-s", serial, "push"])
        .arg(filename)
        .arg(remote);
    Ok(command)
}

pub fn push(adb: &Path, serial: &str, local: &Path, remote: &str) -> Result<(), String> {
    run_command(&mut push_command(adb, serial, local, remote)?)?;
    Ok(())
}

pub(crate) fn run_command(command: &mut Command) -> Result<Vec<u8>, String> {
    command
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

pub fn focused_package(windows: &str) -> Option<&str> {
    let focus = windows
        .lines()
        .find(|line| line.contains("mCurrentFocus="))?
        .split_once("mCurrentFocus=")?
        .1
        .trim();
    if focus == "null" {
        return None;
    }
    let header = format!(" {focus}:");
    let mut inside = false;
    for line in windows.lines() {
        if line.trim_start().starts_with("Window #") {
            if inside {
                break;
            }
            inside = line.ends_with(&header);
        } else if inside {
            if let Some(package) = line.split_whitespace().find_map(|word| {
                word.strip_prefix("package=")
                    .or_else(|| word.strip_prefix("packageName="))
            }) {
                if !package.is_empty()
                    && package
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"._".contains(&b))
                {
                    return Some(package);
                }
            }
        }
    }
    // PopupWindow titles omit the package; only the matching window's owner is authoritative.
    focus
        .split_whitespace()
        .find_map(|word| word.split_once('/').map(|(package, _)| package))
}

pub fn text_input_active(input_method: &str, package: &str) -> bool {
    let words: Vec<_> = input_method.split_whitespace().collect();
    words.contains(&"mInputShown=true")
        && words
            .iter()
            .any(|word| word.strip_prefix("packageName=") == Some(package))
}

pub fn launcher_component<'a>(resolved: &'a str, package: &str) -> Result<&'a str, String> {
    let mut matches = resolved.lines().map(str::trim).filter(|line| {
        line.split_once('/').is_some_and(|(owner, class)| {
            owner == package
                && !class.is_empty()
                && class
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._$".contains(&b))
        })
    });
    let component = matches.next().ok_or("无法找到应用的已安装启动入口")?;
    if matches.next().is_some() {
        return Err("应用存在多个启动入口，未猜测启动方式".into());
    }
    Ok(component)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_uses_the_installed_alias_and_rejects_unrelated_or_ambiguous_components() {
        let output = "priority=0 preferredOrder=0 match=0x108000\norg.autojs.autojs6/org.autojs.autojs.launcher.AdaptiveIconAlias\n";
        assert_eq!(
            launcher_component(output, "org.autojs.autojs6").unwrap(),
            "org.autojs.autojs6/org.autojs.autojs.launcher.AdaptiveIconAlias"
        );
        assert!(launcher_component("other.app/.Main", "org.autojs.autojs6").is_err());
        assert!(launcher_component(
            "org.autojs.autojs6/.One\norg.autojs.autojs6/.Two",
            "org.autojs.autojs6"
        )
        .is_err());
    }

    #[test]
    fn text_input_requires_current_keyboard_and_exact_application() {
        let active = "mInputShown=true\n packageName=com.tencent.mm fieldId=123";
        assert!(text_input_active(active, "com.tencent.mm"));
        assert!(!text_input_active(
            &active.replace(
                "mInputShown=true",
                "mInputShown=false mIsInputViewShown=true"
            ),
            "com.tencent.mm"
        ));
        assert!(!text_input_active(
            &active.replace("com.tencent.mm", "com.tencent.mm.other"),
            "com.tencent.mm"
        ));
    }

    #[test]
    fn focused_package_uses_the_current_window_instead_of_a_background_activity() {
        let windows = "mCurrentFocus=Window{7d7f3f5 u0 com.bbk.launcher2/com.bbk.launcher2.Launcher}\nmFocusedApp=AppWindowToken{com.tencent.mm/.ui.LauncherUI}";
        assert_eq!(focused_package(windows), Some("com.bbk.launcher2"));
        assert_eq!(
            focused_package(
                "mCurrentFocus=Window{c284b24 u0 com.tencent.mm/com.tencent.mm.ui.LauncherUI}"
            ),
            Some("com.tencent.mm")
        );
        assert_eq!(
            focused_package(
                "mCurrentFocus=null\nmFocusedApp=AppWindowToken{com.tencent.mm/.ui.LauncherUI}"
            ),
            None
        );
    }

    #[test]
    fn popup_focus_uses_the_exact_window_owner_and_does_not_trust_focused_app() {
        let windows="Window #1 Window{bad u0 PopupWindow:other}:\n mOwnerUid=7 package=other.app appop=NONE\nWindow #2 Window{a4b7563 u0 PopupWindow:e621fa0}:\n mOwnerUid=10163 package=com.tencent.mm appop=NONE\nWindow #3 Window{main u0 com.tencent.mm/.ui.LauncherUI}:\n package=com.tencent.mm\n mCurrentFocus=Window{a4b7563 u0 PopupWindow:e621fa0}\n mFocusedApp=AppWindowToken{com.tencent.mm/.ui.LauncherUI}";
        assert_eq!(focused_package(windows), Some("com.tencent.mm"));
        assert_eq!(
            focused_package(&windows.replace(
                "mOwnerUid=10163 package=com.tencent.mm",
                "mOwnerUid=10163 package=com.android.systemui"
            )),
            Some("com.android.systemui")
        );
        assert_eq!(
            focused_package(&windows.replace(
                "mOwnerUid=10163 package=com.tencent.mm appop=NONE",
                "mOwnerUid=10163"
            )),
            None
        );
    }

    #[test]
    fn push_passes_only_filename_to_adb_and_keeps_native_parent_directory() {
        let folder = std::env::temp_dir().join(format!("Por Auto 中文 {}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("u2.jar");
        std::fs::write(&file, b"verified component").unwrap();
        let file = file.canonicalize().unwrap();
        #[cfg(windows)]
        assert!(file.to_string_lossy().starts_with(r"\\?\"));
        let command = push_command(
            Path::new("adb"),
            "test-device",
            &file,
            "/data/local/tmp/u2.jar",
        )
        .unwrap();
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(
            args,
            [
                "-s",
                "test-device",
                "push",
                "u2.jar",
                "/data/local/tmp/u2.jar"
            ]
        );
        assert_eq!(command.get_current_dir(), file.parent());
        assert_eq!(
            std::fs::read(command.get_current_dir().unwrap().join(args[3])).unwrap(),
            b"verified component"
        );
        std::fs::remove_dir_all(folder).unwrap();
    }

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
