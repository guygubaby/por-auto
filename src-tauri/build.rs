fn main() {
    println!("cargo:rerun-if-changed=src/ocr-macos.swift");
    let target = std::env::var("TARGET").unwrap();
    if target.ends_with("apple-darwin") {
        let arch = if target.starts_with("aarch64") {
            "arm64"
        } else {
            "x86_64"
        };
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("por-ocr");
        let status = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-O",
                "-target",
                &format!("{arch}-apple-macosx11.0"),
                "src/ocr-macos.swift",
                "-o",
            ])
            .arg(output)
            .status()
            .expect("macOS 构建需要 Xcode Command Line Tools");
        assert!(status.success(), "无法构建本机文字识别组件");
    }
    tauri_build::build()
}
