use crate::android;
use serde::Deserialize;
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process::Command;
use std::{fs, path::Path};

#[derive(Clone, Deserialize)]
struct Word {
    text: String,
    bounds: [i32; 4],
}

#[cfg(target_os = "macos")]
fn recognize(image: &Path, folder: &Path) -> Result<Vec<u8>, String> {
    use std::os::unix::fs::PermissionsExt;
    let helper = folder.join("por-ocr");
    fs::write(
        &helper,
        include_bytes!(concat!(env!("OUT_DIR"), "/por-ocr")),
    )
    .map_err(|e| e.to_string())?;
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    android::run_command(Command::new(helper).arg(image))
}

#[cfg(target_os = "windows")]
fn recognize(image: &Path, _: &Path) -> Result<Vec<u8>, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let script: Vec<u8> = include_str!("ocr-windows.ps1")
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    let powershell = std::path::PathBuf::from(
        std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into()),
    )
    .join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let absolute = image.canonicalize().map_err(|e| e.to_string())?;
    let native = absolute.to_string_lossy();
    let native = native.strip_prefix(r"\\?\").unwrap_or(&native);
    let native = native
        .strip_prefix(r"UNC\")
        .map(|path| format!(r"\\{path}"))
        .unwrap_or_else(|| native.to_owned());
    android::run_command(
        Command::new(powershell)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                &STANDARD.encode(script),
            ])
            .env("POR_OCR_IMAGE_PATH", native)
            .env("POR_OCR_LANGUAGE", "zh-Hans"),
    )
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn recognize(_: &Path, _: &Path) -> Result<Vec<u8>, String> {
    Err("本平台暂不支持本机截图文字识别，请开启手机无障碍服务后重试".into())
}

fn escaped(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn hierarchy_from_words(words: Vec<Word>, width: i32, height: i32) -> Result<String, String> {
    if words.len() > 2000 {
        return Err("截图文字过多，无法可靠识别页面".into());
    }
    let mut unique: Vec<Word> = Vec::new();
    for mut word in words {
        word.text = word.text.trim().to_owned();
        let [l, t, r, b] = word.bounds;
        if word.text.is_empty()
            || word.text.len() > 4000
            || word.text.chars().any(|c| c.is_control())
            || l < 0
            || t < 0
            || r <= l
            || b <= t
            || r > width
            || b > height
        {
            continue;
        }
        let duplicate = unique.iter().any(|old| {
            let [ol, ot, or, ob] = old.bounds;
            old.text == word.text
                && (r.min(or) - l.max(ol)).max(0) * (b.min(ob) - t.max(ot)).max(0)
                    > ((r - l) * (b - t)).min((or - ol) * (ob - ot)) / 2
        });
        if !duplicate {
            unique.push(word);
        }
    }
    let mut expanded = Vec::new();
    for word in unique {
        let field = ["昵称", "名字"]
            .into_iter()
            .find(|label| word.text.starts_with(label) && word.text.len() > label.len());
        if let Some(label) = field {
            let value = word.text[label.len()..].trim_start_matches([' ', ':', '：']);
            if !value.is_empty() {
                let [l, t, r, b] = word.bounds;
                let split = l
                    + ((r - l) * label.chars().count() as i32 / word.text.chars().count() as i32)
                        .max(1);
                expanded.push(Word {
                    text: label.into(),
                    bounds: [l, t, split, b],
                });
                expanded.push(Word {
                    text: value.into(),
                    bounds: [split, t, r, b],
                });
                continue;
            }
        }
        expanded.push(word);
    }
    expanded.sort_by_key(|w| (w.bounds[1] + w.bounds[3], w.bounds[0]));
    let mut rows: Vec<Vec<Word>> = Vec::new();
    for word in expanded {
        if let Some(row) = rows.iter_mut().find(|row| {
            let a = row[0].bounds;
            let b = word.bounds;
            (a[3].min(b[3]) - a[1].max(b[1])).max(0) * 2 >= (a[3] - a[1]).min(b[3] - b[1])
        }) {
            row.push(word);
        } else {
            rows.push(vec![word]);
        }
    }
    let mut xml = format!("<hierarchy><node package=\"com.tencent.mm\" class=\"android.widget.FrameLayout\" bounds=\"[0,0][{width},{height}]\">");
    for mut row in rows {
        row.sort_by_key(|w| w.bounds[0]);
        xml.push_str("<node class=\"android.widget.LinearLayout\">");
        for word in row {
            let [l, t, r, b] = word.bounds;
            xml.push_str(&format!("<node package=\"com.tencent.mm\" class=\"android.widget.TextView\" text=\"{}\" bounds=\"[{l},{t}][{r},{b}]\"/>", escaped(&word.text)));
        }
        xml.push_str("</node>");
    }
    xml.push_str("</node></hierarchy>");
    Ok(xml)
}

pub fn hierarchy(adb: &Path, serial: &str, folder: &Path) -> Result<String, String> {
    let windows = android::text(
        adb,
        &["-s", serial, "shell", "dumpsys", "window", "windows"],
    )?;
    if android::focused_package(&windows) != Some("com.tencent.mm") {
        return Err("微信不在前台，已停止截图识别".into());
    }
    let png = android::run(adb, &["-s", serial, "exec-out", "screencap", "-p"])?;
    if png.len() < 24 || png.len() > 32 * 1024 * 1024 || !png.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("手机截图格式或大小无效".into());
    }
    let width = u32::from_be_bytes(png[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(png[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > 8000
        || height > 8000
        || u64::from(width) * u64::from(height) > 32_000_000
    {
        return Err("手机截图尺寸超出识别范围".into());
    }
    let image = folder.join("ocr-screen.png");
    fs::write(&image, png).map_err(|e| e.to_string())?;
    let bytes = recognize(&image, folder)?;
    fs::write(folder.join("ocr-words.json"), &bytes).map_err(|e| e.to_string())?;
    let words = serde_json::from_slice(&bytes).map_err(|_| "本机文字识别返回无效数据")?;
    hierarchy_from_words(words, width as i32, height as i32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::{read_row, select, Selector};
    #[test]
    fn visual_rows_preserve_nickname_spaces_escape_xml_and_deduplicate_zoomed_tabs() {
        let words = vec![
            Word {
                text: "个人信息".into(),
                bounds: [100, 60, 400, 120],
            },
            Word {
                text: "昵称 A & B".into(),
                bounds: [40, 300, 900, 350],
            },
            Word {
                text: "通讯录".into(),
                bounds: [300, 1800, 400, 1840],
            },
            Word {
                text: "发现".into(),
                bounds: [600, 1800, 700, 1840],
            },
            Word {
                text: "我".into(),
                bounds: [900, 1800, 940, 1840],
            },
            Word {
                text: "我".into(),
                bounds: [902, 1801, 941, 1840],
            },
        ];
        let xml = hierarchy_from_words(words, 1080, 1920).unwrap();
        assert_eq!(
            read_row(&xml, "个人信息", &["昵称".into()]).unwrap(),
            "A & B"
        );
        assert_eq!(
            select(
                &xml,
                &Selector {
                    text: vec!["我".into()],
                    bottom: true,
                    peers: vec!["通讯录".into(), "发现".into()],
                    ..Default::default()
                }
            )
            .unwrap(),
            vec![(920, 1820)]
        );
    }
}
