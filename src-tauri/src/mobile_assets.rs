use serde::Deserialize;
use std::{fs, io::Write, path::Path};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Asset {
    Launcher,
    Workflows,
}
impl Asset {
    fn file(&self) -> (&'static str, &'static str, &'static [u8]) {
        match self {
            Self::Launcher => (
                "PorAuto-AutoJs6-bootstrap.js",
                "js",
                include_bytes!("../../mobile/autojs6/bootstrap.js"),
            ),
            Self::Workflows => (
                "PorAuto-mobile-scripts.json",
                "json",
                include_bytes!("../../mobile-workflows/offline-bundle.json"),
            ),
        }
    }
}
fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path
        .parent()
        .ok_or("保存目录无效")?
        .join(format!(".por-mobile-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::File::create_new(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    let _ = fs::remove_file(&temporary);
    result.map_err(|e: std::io::Error| format!("手机脚本保存失败：{e}"))
}
pub fn export(app: &AppHandle, kind: Asset) -> Result<Option<String>, String> {
    let (name, extension, bytes) = kind.file();
    let Some(file) = app
        .dialog()
        .file()
        .set_title("保存手机脚本")
        .set_file_name(name)
        .add_filter("手机脚本", &[extension])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
pub fn open_runtime() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let program = "explorer.exe";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg("https://github.com/SuperMonster003/AutoJs6/releases/latest")
        .spawn()
        .map_err(|e| format!("无法打开官方下载页面：{e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundled_mobile_assets_export_exact_bytes_and_failed_replacement_preserves_the_destination() {
        let root = std::env::temp_dir().join(format!("por-mobile-assets-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        for asset in [Asset::Launcher, Asset::Workflows] {
            let (name, _, bytes) = asset.file();
            let path = root.join(name);
            fs::write(&path, "previous version").unwrap();
            write(&path, bytes).unwrap();
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        let directory = root.join("existing");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("keep"), "kept").unwrap();
        assert!(write(&directory, b"cannot replace a directory").is_err());
        assert_eq!(fs::read_to_string(directory.join("keep")).unwrap(), "kept");
        assert!(!fs::read_dir(&root).unwrap().any(|f| f
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        assert!(serde_json::from_str::<Asset>("\"arbitrary-file\"").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
