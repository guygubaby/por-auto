use crate::{
    android,
    u2::{Automation, Session},
    wechat,
};
use roxmltree::Document;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    thread,
    time::Duration,
};

pub const ENGINE_VERSION: u32 = 2;
pub const BUNDLED: &str = include_str!("../../workflows/wechat-nickname/workflow.json");
pub const BUNDLED_WORKFLOWS: &[&str] = &[
    BUNDLED,
    include_str!("../../workflows/wechat-open/workflow.json"),
    include_str!("../../workflows/wechat-first-chat/workflow.json"),
    include_str!("../../workflows/wechat-send-hello/workflow.json"),
];

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workflow {
    pub schema_version: u32,
    pub min_engine: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub package: String,
    pub steps: Vec<Step>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Step {
    pub name: String,
    pub action: Action,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Wake,
    Launch {
        activity: String,
    },
    Wait {
        ms: u64,
    },
    Tap {
        selector: Selector,
        #[serde(default)]
        skip_if: Vec<Selector>,
        #[serde(default)]
        recover_back: u8,
    },
    Back,
    WechatFirstChat {
        output: String,
    },
    WechatSendText {
        text: String,
    },
    ReadRow {
        page: String,
        labels: Vec<String>,
        output: String,
    },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Selector {
    #[serde(default)]
    pub text: Vec<String>,
    #[serde(default)]
    pub prefix: Vec<String>,
    #[serde(default)]
    pub bottom: bool,
    #[serde(default)]
    pub peers: Vec<String>,
}

pub fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
}

fn valid_android_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 200
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._".contains(&c))
}

fn short_text(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 500 && !value.contains('\0')
}

impl Selector {
    fn validate(&self) -> Result<(), String> {
        if self.text.len() + self.prefix.len() == 0
            || self.text.len() + self.prefix.len() > 10
            || self.peers.len() > 10
            || !self
                .text
                .iter()
                .chain(&self.prefix)
                .chain(&self.peers)
                .all(|v| short_text(v))
        {
            return Err("工作流页面选择器无效".into());
        }
        Ok(())
    }
}

impl Workflow {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let value: Self =
            serde_json::from_slice(bytes).map_err(|e| format!("工作流格式错误：{e}"))?;
        value.validate()?;
        Ok(value)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.min_engine == 0 || self.min_engine > ENGINE_VERSION {
            return Err("此工作流需要其他版本的执行引擎，请更新客户端".into());
        }
        if !valid_id(&self.id)
            || !short_text(&self.name)
            || !short_text(&self.version)
            || self.description.len() > 2000
            || !valid_android_name(&self.package)
            || !(1..=40).contains(&self.steps.len())
        {
            return Err("工作流名称、标识、目标应用或步骤数量无效".into());
        }
        let mut total_wait = 0;
        let mut outputs = BTreeSet::new();
        let mut first_chat = false;
        let mut sends = 0;
        for step in &self.steps {
            if !short_text(&step.name) {
                return Err("工作流步骤名称无效".into());
            }
            if !matches!(
                step.action,
                Action::WechatFirstChat { .. }
                    | Action::WechatSendText { .. }
                    | Action::Wait { .. }
            ) {
                first_chat = false;
            }
            match &step.action {
                Action::WechatFirstChat { output } => {
                    if self.min_engine < 2
                        || self.package != "com.tencent.mm"
                        || !valid_id(output)
                        || !outputs.insert(output)
                    {
                        return Err("微信首个会话动作需要引擎 2 和唯一输出字段".into());
                    }
                    first_chat = true;
                }
                Action::WechatSendText { text } => {
                    sends += 1;
                    if self.min_engine < 2
                        || self.package != "com.tencent.mm"
                        || !first_chat
                        || !short_text(text)
                        || sends > 1
                    {
                        return Err("发送文字需要先确认首个会话，每个工作流最多发送一次且内容不超过 500 字节".into());
                    }
                }
                Action::Launch { activity } if !valid_android_name(activity) => {
                    return Err("工作流应用入口无效".into())
                }
                Action::Wait { ms } => {
                    if *ms > 10000 {
                        return Err("单步等待不能超过 10 秒".into());
                    }
                    total_wait += ms;
                }
                Action::Tap {
                    selector,
                    skip_if,
                    recover_back,
                } => {
                    selector.validate()?;
                    if *recover_back > 3 || skip_if.len() > 5 {
                        return Err("工作流页面恢复次数超出限制".into());
                    }
                    for selector in skip_if {
                        selector.validate()?;
                    }
                }
                Action::ReadRow {
                    page,
                    labels,
                    output,
                } => {
                    if !short_text(page)
                        || labels.is_empty()
                        || labels.len() > 10
                        || !labels.iter().all(|s| short_text(s))
                        || !valid_id(output)
                        || !outputs.insert(output)
                    {
                        return Err("工作流输出字段无效或重复".into());
                    }
                }
                _ => {}
            }
        }
        if total_wait > 30000 {
            return Err("工作流总等待时间不能超过 30 秒".into());
        }
        Ok(())
    }
}

pub(crate) fn node_bounds(node: roxmltree::Node<'_, '_>) -> Option<[i32; 4]> {
    let values: Vec<i32> = node
        .attribute("bounds")?
        .split(['[', ']', ','])
        .filter(|v| !v.is_empty())
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    let bounds: [i32; 4] = values.try_into().ok()?;
    (bounds[0] >= 0
        && bounds[1] >= 0
        && bounds[2] > bounds[0]
        && bounds[3] > bounds[1]
        && bounds[2] <= 20000
        && bounds[3] <= 20000)
        .then_some(bounds)
}

fn node_label<'a>(node: roxmltree::Node<'a, '_>) -> &'a str {
    node.attribute("text")
        .filter(|v| !v.is_empty())
        .or_else(|| node.attribute("content-desc"))
        .unwrap_or("")
}

fn same_label(actual: &str, expected: &str) -> bool {
    actual == expected
        || matches!(
            (actual, expected),
            ("个人资料", "个人信息") | ("个人信息", "个人资料")
        )
}

pub fn select(xml: &str, selector: &Selector) -> Result<Vec<(i32, i32)>, String> {
    let doc = Document::parse(xml).map_err(|_| "无法解析手机界面")?;
    let height = doc
        .descendants()
        .filter_map(node_bounds)
        .map(|b| b[3])
        .max()
        .unwrap_or(0);
    let mut matches = BTreeSet::new();
    for node in doc.descendants() {
        let label = node_label(node);
        if !selector.text.iter().any(|v| same_label(label, v))
            && !selector.prefix.iter().any(|v| label.starts_with(v))
        {
            continue;
        }
        let Some([left, top, right, bottom]) = node_bounds(node) else {
            continue;
        };
        if selector.bottom && top * 4 < height * 3 {
            continue;
        }
        let y = (top + bottom) / 2;
        if !selector.peers.iter().all(|peer| {
            doc.descendants().any(|n| {
                node_label(n) == peer
                    && node_bounds(n).is_some_and(|b| ((b[1] + b[3]) / 2 - y).abs() * 50 <= height)
            })
        }) {
            continue;
        }
        matches.insert(((left + right) / 2, y));
    }
    Ok(matches.into_iter().collect())
}

fn has_label(xml: &str, selector: &Selector) -> bool {
    Document::parse(xml).is_ok_and(|doc| {
        doc.descendants().any(|n| {
            selector.text.iter().any(|v| same_label(node_label(n), v))
                || selector.prefix.iter().any(|v| node_label(n).starts_with(v))
        })
    })
}

pub fn read_row(xml: &str, page: &str, labels: &[String]) -> Result<String, String> {
    let doc = Document::parse(xml).map_err(|_| "手机页面结构无法解析")?;
    if !doc.descendants().any(|n| {
        n.attribute("text")
            .is_some_and(|text| same_label(text, page))
    }) {
        return Err(format!("未进入「{page}」页面"));
    }
    let mut candidates = BTreeSet::new();
    for label in doc.descendants().filter(|n| {
        n.attribute("text")
            .is_some_and(|v| labels.iter().any(|l| l == v))
    }) {
        for row in label.ancestors().skip(1) {
            let values: Vec<_> = row
                .descendants()
                .filter(|n| *n != label)
                .filter_map(|n| n.attribute("text"))
                .filter(|v| !v.trim().is_empty())
                .collect();
            if !values.is_empty() {
                if values.len() == 1
                    && !same_label(values[0], page)
                    && !labels.iter().any(|v| v == values[0])
                {
                    candidates.insert(values[0].to_string());
                }
                break;
            }
        }
    }
    if candidates.len() != 1 {
        return Err("无法唯一读取目标字段，请检查手机页面及工作流版本".into());
    }
    Ok(candidates.into_iter().next().unwrap())
}

pub(crate) fn page_document<'a>(xml: &'a str, package: &str) -> Result<Document<'a>, String> {
    let doc = Document::parse(xml).map_err(|_| "手机页面结构无法解析")?;
    let mut nodes = doc
        .descendants()
        .filter(|n| n.attribute("package") == Some(package))
        .peekable();
    if nodes.peek().is_none() {
        return Err("目标应用不在可操作的前台，请解锁手机、关闭弹窗后重试".into());
    }
    if !nodes.any(|n| {
        n.attribute("visible-to-user") != Some("false")
            && n.attribute("class").is_some_and(|class| !class.is_empty())
            && node_bounds(n).is_some()
    }) {
        return Err("目标应用的页面控件不可读取（返回空节点），已停止操作。请在手机上开启可信的无障碍服务（如 AutoJs6）后重试；仍失败时检查应用版本兼容性".into());
    }
    Ok(doc)
}

fn screen(
    device: &impl Automation,
    package: &str,
    folder: &Path,
    visual: Option<(&Path, &str)>,
) -> Result<String, String> {
    let mut xml = device.dump()?;
    fs::write(folder.join("hierarchy.xml"), &xml).map_err(|e| e.to_string())?;
    if let Err(error) = page_document(&xml, package) {
        if let Some((adb, serial)) = visual.filter(|_| error.contains("返回空节点")) {
            if !folder.join("native-hierarchy.xml").exists() {
                fs::write(folder.join("native-hierarchy.xml"), &xml).map_err(|e| e.to_string())?;
            }
            xml = crate::ocr::hierarchy(adb, serial, folder)?;
            fs::write(folder.join("ocr-hierarchy.xml"), &xml).map_err(|e| e.to_string())?;
            fs::write(folder.join("hierarchy.xml"), &xml).map_err(|e| e.to_string())?;
        } else {
            return Err(error);
        }
    }
    Ok(xml)
}

pub fn execute(
    workflow: &Workflow,
    adb: &Path,
    serial: &str,
    jar: &Path,
    folder: &Path,
    mut report: impl FnMut(usize, usize, &str, &str) -> Result<(), String>,
) -> Result<BTreeMap<String, String>, String> {
    workflow.validate()?;
    let nickname = Workflow::parse(BUNDLED.as_bytes())?;
    // Visual input is limited to our exact read-only nickname steps; send workflows never fall back to OCR.
    let visual = (workflow.id == nickname.id
        && workflow.package == nickname.package
        && workflow.steps == nickname.steps)
        .then_some((adb, serial));
    let devices = android::parse_devices(&android::text(adb, &["devices", "-l"])?);
    if !devices
        .iter()
        .any(|d| d.serial == serial && d.state == "device")
    {
        return Err("手机已断开或尚未授权，请检查数据线及 USB 调试授权".into());
    }
    let package = android::text(
        adb,
        &["-s", serial, "shell", "pm", "path", &workflow.package],
    )?;
    if !package.starts_with("package:") {
        return Err(format!("手机未安装目标应用 {}", workflow.package));
    }
    report(0, workflow.steps.len(), "准备手机自动化服务", "started")?;
    let device = Session::start(adb, serial, jar, folder)?;
    let mut chat = None;
    let mut outputs = BTreeMap::new();
    for (index, step) in workflow.steps.iter().enumerate() {
        report(index + 1, workflow.steps.len(), &step.name, "started")?;
        match &step.action {
            Action::Wake => {
                android::text(
                    adb,
                    &["-s", serial, "shell", "input", "keyevent", "KEYCODE_WAKEUP"],
                )?;
            }
            Action::Launch { activity } => {
                let output = android::text(
                    adb,
                    &[
                        "-s",
                        serial,
                        "shell",
                        "am",
                        "start",
                        "-n",
                        &format!("{}/{activity}", workflow.package),
                    ],
                )?;
                if output.contains("Error") || output.contains("Exception") {
                    return Err("无法打开目标应用，请先解锁手机并手动打开后重试".into());
                }
                fs::write(folder.join("launch.txt"), &output).map_err(|e| e.to_string())?;
                let deadline = std::time::Instant::now() + Duration::from_secs(6);
                loop {
                    let windows = android::text(
                        adb,
                        &["-s", serial, "shell", "dumpsys", "window", "windows"],
                    )?;
                    if android::focused_package(&windows) == Some(workflow.package.as_str()) {
                        break;
                    }
                    if std::time::Instant::now() >= deadline {
                        return Err("目标应用未切换到前台，请解锁手机、关闭系统弹窗后重试".into());
                    }
                    thread::sleep(Duration::from_millis(250));
                }
            }
            Action::Wait { ms } => thread::sleep(Duration::from_millis(*ms)),
            Action::Back => {
                android::text(
                    adb,
                    &["-s", serial, "shell", "input", "keyevent", "KEYCODE_BACK"],
                )?;
                thread::sleep(Duration::from_millis(700));
            }
            Action::WechatFirstChat { output } => {
                let target = wechat::open_first(&device, folder)?;
                outputs.insert(output.clone(), target.title.clone());
                chat = Some(target);
            }
            Action::WechatSendText { text } => {
                let target = chat.as_ref().ok_or("尚未确认首个会话，禁止发送")?;
                let status = wechat::send_text(&device, target, text, folder)?;
                outputs.insert("message".into(), text.clone());
                outputs.insert("send_status".into(), status);
            }
            Action::Tap {
                selector,
                skip_if,
                recover_back,
            } => {
                let mut done = false;
                let attempts = if visual.is_some() {
                    (*recover_back).max(2)
                } else {
                    *recover_back
                };
                for attempt in 0..=attempts {
                    let xml = screen(&device, &workflow.package, folder, visual)?;
                    if skip_if.iter().any(|s| has_label(&xml, s)) {
                        done = true;
                        break;
                    }
                    let matches = select(&xml, selector)?;
                    if matches.len() == 1 {
                        device.click(matches[0].0, matches[0].1)?;
                        device.settle();
                        done = true;
                        break;
                    }
                    if matches.len() > 1 {
                        return Err(format!("「{}」匹配到多个目标，已停止", step.name));
                    }
                    if folder.join("ocr-hierarchy.xml").is_file() {
                        if attempt < attempts {
                            device.settle();
                            continue;
                        }
                        return Err(format!(
                            "截图识别未能确认「{}」，请回到微信主界面后重试",
                            step.name
                        ));
                    }
                    if attempt < *recover_back {
                        android::text(
                            adb,
                            &["-s", serial, "shell", "input", "keyevent", "KEYCODE_BACK"],
                        )?;
                        thread::sleep(Duration::from_millis(700));
                    } else if attempt < attempts {
                        device.settle();
                    }
                }
                if !done {
                    return Err(format!(
                        "「{}」找不到目标，请回到应用主界面后重试",
                        step.name
                    ));
                }
            }
            Action::ReadRow {
                page,
                labels,
                output,
            } => {
                let mut value = None;
                for attempt in 0..=2 {
                    match read_row(
                        &screen(&device, &workflow.package, folder, visual)?,
                        page,
                        labels,
                    ) {
                        Ok(found) => {
                            value = Some(found);
                            break;
                        }
                        Err(_) if attempt < 2 && folder.join("ocr-hierarchy.xml").is_file() => {
                            device.settle()
                        }
                        Err(error) => return Err(error),
                    }
                }
                outputs.insert(output.clone(), value.ok_or("无法读取昵称")?);
            }
        }
        report(index + 1, workflow.steps.len(), &step.name, "completed")?;
    }
    if folder.join("ocr-hierarchy.xml").is_file() {
        outputs.insert(
            "读取方式".into(),
            "本机截图文字识别，请结合截图核对昵称；表情等特殊字符可能无法识别".into(),
        );
        report(
            workflow.steps.len(),
            workflow.steps.len(),
            "使用本机截图文字识别读取昵称，请结合截图核对",
            "warning",
        )?;
    }
    Ok(outputs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_app_nodes_stop_before_navigation_instead_of_returning_to_the_launcher() {
        struct EmptyPage;
        impl Automation for EmptyPage {
            fn rpc(&self, method: &str, _: serde_json::Value) -> Result<serde_json::Value, String> {
                assert_eq!(
                    method, "dumpWindowHierarchy",
                    "an unreadable page must not trigger input"
                );
                Ok(serde_json::json!(
                    r#"<hierarchy><node package="com.android.systemui" class="android.widget.FrameLayout" bounds="[0,0][1080,80]"/><node package="com.tencent.mm" class="" text="" enabled="false" visible-to-user="false" bounds="[0,0][0,0]"/></hierarchy>"#
                ))
            }
        }
        let folder = std::env::temp_dir().join(format!("por-empty-page-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let result = screen(&EmptyPage, "com.tencent.mm", &folder, None);
        fs::remove_dir_all(&folder).unwrap();
        assert!(result.is_err_and(|error| error.contains("页面控件")));
    }

    #[test]
    fn bundled_workflow_validates_and_rejects_unknown_operations() {
        let workflow = Workflow::parse(BUNDLED.as_bytes()).unwrap();
        assert_eq!(workflow.id, "wechat-nickname");
        let invalid = BUNDLED.replace("\"wake\"", "\"shell\"");
        assert!(Workflow::parse(invalid.as_bytes()).is_err());
        let invalid = BUNDLED.replace("com.tencent.mm\"", "com.tencent.mm;reboot\"");
        assert!(Workflow::parse(invalid.as_bytes()).is_err());
    }

    #[test]
    fn engine_two_workflows_require_target_before_a_single_bounded_send() {
        for source in BUNDLED_WORKFLOWS {
            Workflow::parse(source.as_bytes()).unwrap();
        }
        let source = BUNDLED_WORKFLOWS[3];
        for invalid in [
            source.replace("\"minEngine\": 2", "\"minEngine\": 1"),
            source.replace("\"text\": \"你好\"", "\"text\": \"\""),
            source.replace("com.tencent.mm", "com.example.other"),
        ] {
            assert!(Workflow::parse(invalid.as_bytes()).is_err());
        }
        let mut workflow = Workflow::parse(source.as_bytes()).unwrap();
        workflow.steps.remove(3);
        assert!(workflow.validate().is_err());
        let mut workflow = Workflow::parse(source.as_bytes()).unwrap();
        workflow.steps.push(workflow.steps.last().unwrap().clone());
        assert!(workflow.validate().is_err());
    }

    #[test]
    fn selectors_require_unique_bottom_target_and_peer_row() {
        let xml = r#"<hierarchy><node bounds="[0,0][1080,1920]"><node text="我" bounds="[0,100][100,150]"/><node text="通讯录" bounds="[300,1800][400,1840]"/><node text="发现" bounds="[600,1800][700,1840]"/><node text="我" bounds="[900,1800][980,1840]"/></node></hierarchy>"#;
        let selector = Selector {
            text: vec!["我".into()],
            bottom: true,
            peers: vec!["通讯录".into(), "发现".into()],
            ..Default::default()
        };
        assert_eq!(select(xml, &selector).unwrap(), vec![(940, 1820)]);
        assert!(select(&xml.replace("发现", "其他"), &selector)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn reads_row_without_guessing_missing_or_ambiguous_value() {
        let xml = r#"<hierarchy><node text="个人信息"/><node><node><node text="昵称"/></node><node text="测试 🌱"/></node><node><node text="微信号"/><node text="wxid_test"/></node></hierarchy>"#;
        let labels = vec!["昵称".into(), "名字".into()];
        assert_eq!(read_row(xml, "个人信息", &labels).unwrap(), "测试 🌱");
        let updated = xml.replace("个人信息", "个人资料").replace("昵称", "名字");
        assert_eq!(read_row(&updated, "个人信息", &labels).unwrap(), "测试 🌱");
        assert!(has_label(
            &updated,
            &Selector {
                text: vec!["个人信息".into()],
                ..Default::default()
            }
        ));
        assert!(read_row(
            r#"<hierarchy><node text="个人信息"/><node text="昵称"/></hierarchy>"#,
            "个人信息",
            &labels
        )
        .is_err());
    }
}
