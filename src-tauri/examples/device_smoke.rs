// Explicit real-device check. Only the bundled open/nickname steps are allowed.
#[allow(dead_code)]
#[path = "../src/android.rs"]
mod android;
#[allow(dead_code)]
#[path = "../src/history.rs"]
mod history;
#[allow(dead_code)]
#[path = "../src/send_input.rs"]
mod send_input;
#[allow(dead_code)]
#[path = "../src/u2.rs"]
mod u2;
#[allow(dead_code)]
#[path = "../src/wechat.rs"]
mod wechat;
#[allow(dead_code)]
#[path = "../src/workflow.rs"]
mod workflow;
use std::{env, fs, path::PathBuf};
fn main() {
    let args: Vec<_> = env::args().skip(1).collect();
    assert_eq!(
        args.len(),
        4,
        "usage: device_smoke <serial> <adb> <jar> <workflow.json>"
    );
    let flow = workflow::Workflow::parse(&fs::read(&args[3]).unwrap()).unwrap();
    let expected = workflow::BUNDLED_WORKFLOWS
        .iter()
        .map(|s| workflow::Workflow::parse(s.as_bytes()).unwrap())
        .find(|w| w.id == flow.id && ["wechat-open", "wechat-nickname"].contains(&w.id.as_str()))
        .expect("only bundled open/nickname workflows are allowed");
    assert!(
        flow.package == expected.package && flow.steps == expected.steps,
        "modified workflow steps are not allowed in this diagnostic"
    );
    let folder = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../work/real-device-debug-cache")
        .join(format!("{}-{}", flow.id, history::now()));
    fs::create_dir_all(&folder).unwrap();
    let result = workflow::execute_with_input(
        &flow,
        None,
        &PathBuf::from(&args[1]),
        &args[0],
        &PathBuf::from(&args[2]),
        &folder,
        |step, total, name, status| {
            println!("{step}/{total} {status} {name}");
            Ok(())
        },
    );
    fs::write(
        folder.join("verdict.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .unwrap();
    match result {
        Err(error) => {
            eprintln!("FAIL: {error}");
            std::process::exit(1);
        }
        Ok(outputs) => {
            if flow.id == "wechat-nickname" {
                assert!(
                    outputs
                        .get("nickname")
                        .is_some_and(|name| !name.trim().is_empty()),
                    "no nickname output"
                );
            }
            let window = android::text(
                &PathBuf::from(&args[1]),
                &["-s", &args[0], "shell", "dumpsys", "window", "windows"],
            )
            .unwrap();
            assert_eq!(
                android::focused_package(&window),
                Some("com.tencent.mm"),
                "WeChat is not the focused app"
            );
            println!(
                "PASS: {}; nickname_present={}",
                flow.id,
                outputs.contains_key("nickname")
            );
        }
    }
}
