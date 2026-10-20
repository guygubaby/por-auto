use crate::{
    android,
    send_input::SendInput,
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

pub const ENGINE_VERSION: u32 = 3;
pub const BUNDLED: &str = include_str!("../../workflows/wechat-nickname/workflow.json");
pub const BUNDLED_WORKFLOWS: &[&str] = &[
    BUNDLED,
    include_str!("../../workflows/wechat-open/workflow.json"),
    include_str!("../../workflows/wechat-first-chat/workflow.json"),
    include_str!("../../workflows/wechat-send-hello/workflow.json"),
    include_str!("../../workflows/wechat-broadcast/workflow.json"),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Step {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
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
    WechatHome,
    WechatOpenChat {
        target: String,
        output: String,
    },
    WechatBroadcast,
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
    pub fn validate_input(&self, input: Option<&SendInput>) -> Result<(), String> {
        if self.configurable() != input.is_some() {
            return Err("此工作流的输入缺失或不适用".into());
        }
        if let Some(input) = input {
            input.validate()?;
        }
        Ok(())
    }
    pub fn sends_messages(&self) -> bool {
        self.steps.iter().any(|s| {
            matches!(
                s.action,
                Action::WechatSendText { .. } | Action::WechatBroadcast
            )
        })
    }
    pub fn validate_run(&self, dry_run: bool) -> Result<(), String> {
        self.validate()?;
        if dry_run
            && self
                .steps
                .iter()
                .any(|s| matches!(s.action, Action::Tap { .. }))
        {
            return Err("此工作流含通用点击，无法作为消息演练运行；请使用标准微信发送动作".into());
        }
        Ok(())
    }
    pub fn configurable(&self) -> bool {
        self.steps
            .iter()
            .any(|s| matches!(s.action, Action::WechatBroadcast))
    }
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
            || self.version.len() > 80
            || semver::Version::parse(&self.version).is_err()
            || self.description.len() > 2000
            || !valid_android_name(&self.package)
            || !(1..=40).contains(&self.steps.len())
        {
            return Err("工作流名称、标识、目标应用或步骤数量无效".into());
        }
        let mut total_wait = 0;
        let mut outputs = BTreeSet::<&str>::new();
        let mut first_chat = false;
        let mut sends = 0;
        let mut ids = BTreeSet::new();
        if self.input_schema.is_some()
            && (!self.configurable()
                || self.input_schema
                    != Some(serde_json::json!({"$ref":"por-auto://schemas/wechat-send-input/v1"})))
        {
            return Err("工作流输入 Schema 不受此引擎支持".into());
        }
        if self.configurable() && self.input_schema.is_none() {
            return Err("消息工作流必须声明输入 Schema".into());
        }
        for step in &self.steps {
            if let Some(id) = &step.id {
                if !valid_id(id) || !ids.insert(id) {
                    return Err("步骤 ID 无效或重复".into());
                }
            }
            if !short_text(&step.name) {
                return Err("工作流步骤名称无效".into());
            }
            if !matches!(
                step.action,
                Action::WechatFirstChat { .. }
                    | Action::WechatOpenChat { .. }
                    | Action::WechatSendText { .. }
                    | Action::Wait { .. }
            ) {
                first_chat = false;
            }
            match &step.action {
                Action::WechatHome | Action::WechatOpenChat { .. } | Action::WechatBroadcast
                    if self.min_engine < 3 || self.package != "com.tencent.mm" =>
                {
                    return Err("此微信动作需要引擎 3".into())
                }
                Action::WechatOpenChat { target, output } => {
                    if !short_text(target) || !valid_id(output) || !outputs.insert(output) {
                        return Err("指定会话与输出字段无效".into());
                    }
                    first_chat = true;
                }
                Action::WechatBroadcast => {
                    sends += 1;
                    if sends > 1
                        || !outputs.insert("send_status")
                        || !outputs.insert("recipient_source")
                    {
                        return Err("每个工作流只能有一个发送动作".into());
                    }
                }
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
                        || !outputs.insert("message")
                        || !outputs.insert("send_status")
                    {
                        return Err(
                            "发送文字需要先确认会话，每个工作流最多发送一次且内容不超过 500 字节"
                                .into(),
                        );
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
        if outputs.contains("before_hook") || outputs.contains("after_hook") {
            return Err("before_hook 和 after_hook 为生命周期保留输出字段".into());
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
    if package == "com.tencent.mm"
        && ["安全保护中", "验证解除"].iter().all(|label| {
            doc.descendants()
                .any(|n| n.attribute("package") == Some(package) && node_label(n) == *label)
        })
    {
        return Err(wechat::VERIFICATION_REQUIRED.into());
    }
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
        return Err("当前微信未提供可读取的页面控件（空节点），已停止操作。请保持手机解锁；若已开启无障碍服务仍然失败，请导出本次记录以核对微信与手机版本兼容性".into());
    }
    Ok(doc)
}

fn screen(device: &impl Automation, package: &str, folder: &Path) -> Result<String, String> {
    let xml = device.dump()?;
    fs::write(folder.join("hierarchy.xml"), &xml).map_err(|e| e.to_string())?;
    page_document(&xml, package)?;
    Ok(xml)
}

pub fn execute_with_input(
    workflow: &Workflow,
    input: Option<&SendInput>,
    dry_run: bool,
    adb: &Path,
    serial: &str,
    jar: &Path,
    folder: &Path,
    mut report: impl FnMut(usize, usize, &str, &str) -> Result<(), String>,
) -> Result<BTreeMap<String, String>, String> {
    workflow.validate_run(dry_run)?;
    workflow.validate_input(input)?;
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
            Action::WechatHome => {
                wechat::home(&device, folder)?;
                chat = None;
            }
            Action::WechatOpenChat { target, output } => {
                let target = wechat::open_named(&device, folder, target)?;
                outputs.insert(output.clone(), target.title.clone());
                chat = Some(target);
            }
            Action::WechatBroadcast => {
                let config = input.ok_or("缺少发送配置")?;
                fs::write(
                    folder.join("input.json"),
                    serde_json::to_vec_pretty(&config.redacted()).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                let context = serde_json::json!({"workflow":{"id":workflow.id,"name":workflow.name,"version":workflow.version},"device":{"serial":serial},"run":{"id":folder.file_name().unwrap_or_default().to_string_lossy(),"status":"running","mode":if dry_run {"rehearsal"} else {"send"}}});
                outputs.extend(wechat::broadcast(
                    &device,
                    folder,
                    config,
                    &context,
                    dry_run,
                    |message| report(index + 1, workflow.steps.len(), message, "started"),
                )?);
            }
            Action::WechatSendText { text } => {
                let target = chat.as_ref().ok_or("尚未确认首个会话，禁止发送")?;
                let status = wechat::send_text(&device, target, text, folder, dry_run)?;
                outputs.insert("message".into(), text.clone());
                outputs.insert("send_status".into(), status);
            }
            Action::Tap {
                selector,
                skip_if,
                recover_back,
            } => {
                let mut done = false;
                for attempt in 0..=*recover_back {
                    let xml = screen(&device, &workflow.package, folder)?;
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
                    if attempt < *recover_back {
                        android::text(
                            adb,
                            &["-s", serial, "shell", "input", "keyevent", "KEYCODE_BACK"],
                        )?;
                        thread::sleep(Duration::from_millis(700));
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
                outputs.insert(
                    output.clone(),
                    read_row(&screen(&device, &workflow.package, folder)?, page, labels)?,
                );
            }
        }
        report(index + 1, workflow.steps.len(), &step.name, "completed")?;
    }
    Ok(outputs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_pages_stop_native_navigation() {
        let xml = r#"<hierarchy><node package="com.tencent.mm" text="安全保护中"/><node package="com.tencent.mm" text="验证解除"/></hierarchy>"#;
        assert!(
            page_document(xml, "com.tencent.mm").is_err_and(|e| e == wechat::VERIFICATION_REQUIRED)
        );
    }
    #[test]
    fn rehearsal_rejects_generic_taps_but_accepts_the_standard_sender() {
        let sender = Workflow::parse(BUNDLED_WORKFLOWS[3].as_bytes()).unwrap();
        assert!(sender.validate_run(true).is_ok());
        let generic = Workflow::parse(BUNDLED.as_bytes()).unwrap();
        assert!(generic.validate_run(true).is_err());
        assert!(generic.validate_run(false).is_ok());
    }

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
        let result = screen(&EmptyPage, "com.tencent.mm", &folder);
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
            source.replace("\"minEngine\": 3", "\"minEngine\": 1"),
            source.replace("\"text\": \"1\"", "\"text\": \"\""),
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
