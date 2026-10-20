use crate::{
    history,
    send_input::{Scope, SendInput},
    u2::Automation,
    wechat::{self, Chat, TargetAction, TargetList},
    workflow::{node_bounds, page_document},
};
use roxmltree::{Document, Node};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::Path};

pub const PACKAGE: &str = "com.tencent.wework";
pub const ACTIVITY: &str = ".launch.LaunchSplashActivity";
fn label<'a>(n: Node<'a, '_>) -> &'a str {
    n.attribute("text").unwrap_or("")
}
fn visible(n: Node<'_, '_>) -> bool {
    n.attribute("package") == Some(PACKAGE)
        && n.attribute("visible-to-user") != Some("false")
        && n.attribute("enabled") != Some("false")
        && node_bounds(n).is_some()
}
fn id(n: Node<'_, '_>, name: &str) -> bool {
    visible(n) && n.attribute("resource-id") == Some(format!("{PACKAGE}:id/{name}").as_str())
}
fn one<'a, 'b>(doc: &'a Document<'b>, name: &str) -> Result<Node<'a, 'b>, String> {
    let mut nodes = doc.descendants().filter(|n| id(*n, name));
    let first = nodes
        .next()
        .ok_or_else(|| format!("企业微信没有提供控件 {name}，请核对应用版本"))?;
    if nodes.next().is_some() {
        return Err(format!("企业微信控件 {name} 不唯一，已停止"));
    }
    Ok(first)
}
fn snapshot(device: &impl Automation, folder: &Path, name: &str) -> Result<String, String> {
    for attempt in 0..4 {
        let xml = device.dump()?;
        fs::write(folder.join(name), &xml).map_err(|e| e.to_string())?;
        fs::write(folder.join("hierarchy.xml"), &xml).map_err(|e| e.to_string())?;
        let doc = page_document(&xml, PACKAGE)?;
        if doc
            .descendants()
            .filter(|n| visible(*n))
            .any(|n| !n.attribute("resource-id").unwrap_or("").is_empty())
        {
            return Ok(xml);
        }
        if attempt < 3 {
            device.settle();
        }
    }
    Err("企业微信暂未提供页面控件，已停止，未重复点击；请保持手机解锁并检查无障碍服务".into())
}
fn click(device: &impl Automation, n: Node<'_, '_>) -> Result<(), String> {
    let [l, t, r, b] = node_bounds(n).ok_or("目标控件不在可见区域")?;
    device.click((l + r) / 2, (t + b) / 2)?;
    device.settle();
    Ok(())
}
fn selector(name: &str) -> Value {
    json!({"mask":0x280000,"packageName":PACKAGE,"resourceId":format!("{PACKAGE}:id/{name}")})
}
fn on_home(doc: &Document<'_>) -> bool {
    let width = doc
        .descendants()
        .filter_map(node_bounds)
        .map(|b| b[2])
        .max()
        .unwrap_or(0);
    one(doc, "ncq").is_ok_and(|n| label(n) == "消息")
        && one(doc, "czp").is_ok_and(|n| node_bounds(n).is_some_and(|b| b[0] == 0 && b[2] == width))
        && one(doc, "fg8").is_ok()
}
pub fn home(device: &impl Automation, folder: &Path) -> Result<String, String> {
    for _ in 0..8 {
        let xml = snapshot(device, folder, "wecom-home.xml")?;
        let doc = page_document(&xml, PACKAGE)?;
        if on_home(&doc) {
            return Ok(xml);
        }
        let h = doc
            .descendants()
            .filter_map(node_bounds)
            .map(|b| b[3])
            .max()
            .unwrap_or(0);
        let tabs: Vec<_> = doc
            .descendants()
            .filter(|n| id(*n, "hrr") && node_bounds(*n).is_some_and(|b| b[1] * 4 > h * 3))
            .collect();
        if ["消息", "邮件", "文档", "工作台", "通讯录"]
            .iter()
            .all(|s| tabs.iter().any(|n| label(*n) == *s))
        {
            let buttons: Vec<_> = tabs.into_iter().filter(|n| label(*n) == "消息").collect();
            if buttons.len() != 1 {
                return Err("无法唯一确认企业微信「消息」导航".into());
            }
            click(device, buttons[0])?;
        } else {
            device.expect_true("pressKey", json!(["back"]))?;
            device.settle();
        }
    }
    Err("未能返回企业微信消息首页，请关闭弹窗后重试".into())
}
fn list_page(device: &impl Automation, folder: &Path, scope: Scope) -> Result<String, String> {
    let mut xml = home(device, folder)?;
    let desired = if scope == Scope::Groups {
        "群聊"
    } else {
        "全部"
    };
    let doc = page_document(&xml, PACKAGE)?;
    if label(one(&doc, "fg8")?) != desired {
        click(device, one(&doc, "fg9")?)?;
        xml = snapshot(device, folder, "wecom-filter.xml")?;
        let doc = page_document(&xml, PACKAGE)?;
        let options: Vec<_> = doc
            .descendants()
            .filter(|n| visible(*n) && label(*n) == desired)
            .collect();
        if options.len() != 1 {
            return Err("无法唯一确认企业微信会话分类".into());
        }
        click(device, options[0])?;
        xml = snapshot(device, folder, "wecom-list.xml")?;
    }
    let doc = page_document(&xml, PACKAGE)?;
    if !on_home(&doc) || label(one(&doc, "fg8")?) != desired {
        return Err("企业微信会话分类尚未切换，已停止".into());
    }
    device.expect_true("scrollToBeginning", json!([selector("czp"), true, 300, 20]))?;
    device.settle();
    snapshot(device, folder, "wecom-list.xml")
}
fn rows<'a, 'b>(
    doc: &'a Document<'b>,
    scope: Scope,
) -> Result<Vec<(String, Node<'a, 'b>)>, String> {
    let list = one(doc, "czp")?;
    let viewport = node_bounds(list).ok_or("会话列表不在可见区域")?;
    let mut result = Vec::new();
    for row in list
        .children()
        .filter(|n| n.is_element() && visible(*n) && n.attribute("clickable") == Some("true"))
    {
        if !node_bounds(row).is_some_and(|b| b[1] >= viewport[1] && b[3] <= viewport[3]) {
            continue;
        }
        let names: Vec<_> = row
            .descendants()
            .filter(|n| id(*n, "hrr"))
            .map(label)
            .filter(|s| !s.trim().is_empty())
            .collect();
        if names.len() != 1 {
            return Err("企业微信会话行无法唯一读取，未开始处理".into());
        }
        let name = names[0];
        if name.contains('…') || name.ends_with("...") {
            return Err("会话名称被截断，未猜测接收对象".into());
        }
        // These are application/service entries, not recipient chats. Group filtering keeps real groups with these names.
        if scope == Scope::Conversations
            && [
                "接收微信中的工作消息",
                "打卡",
                "企业微信团队",
                "我的客服",
                "添加管理员协助你体验",
            ]
            .contains(&name)
        {
            continue;
        }
        if result.iter().any(|(s, _)| s == name) {
            return Err("同名会话无法安全区分，已停止".into());
        }
        result.push((name.to_owned(), row));
    }
    Ok(result)
}
pub fn discover_progress(
    device: &impl Automation,
    folder: &Path,
    scope: Scope,
    mut report: impl FnMut(&str) -> Result<(), String>,
) -> Result<TargetList, String> {
    let mut xml = list_page(device, folder, scope)?;
    let mut names = Vec::new();
    for page in 0..300 {
        report(&format!(
            "正在读取企业微信第 {} 屏，已发现 {} 个会话",
            page + 1,
            names.len()
        ))?;
        let doc = page_document(&xml, PACKAGE)?;
        let current = rows(&doc, scope)?
            .into_iter()
            .map(|(n, _)| n)
            .collect::<Vec<_>>();
        wechat::merge_page(&mut names, &current)?;
        if names.len() > 2000 {
            return Err("本轮超过 2000 个会话，请分批选择".into());
        }
        let moved = device
            .rpc("scrollForward", json!([selector("czp"), true, 20]))?
            .as_bool()
            .ok_or("会话滚动响应无效")?;
        if !moved {
            return Ok(TargetList {
                items: names.into_iter().map(|title| Chat { title }).collect(),
                source: if scope == Scope::Groups {
                    "企业微信消息首页 · 群聊分类"
                } else {
                    "企业微信消息首页 · 普通会话（不含功能入口）"
                }
                .into(),
                scanned_at: history::now(),
                complete: true,
            });
        }
        device.settle();
        let next = snapshot(device, folder, "wecom-list.xml")?;
        if next == xml {
            return Err("列表未移动且尚未确认末尾，未开始处理".into());
        }
        xml = next;
    }
    Err("未能确认企业微信列表末尾，请分批选择".into())
}
fn check_chat(doc: &Document<'_>, target: &str) -> Result<(), String> {
    let actual = label(one(doc, "ncq")?);
    let suffix = actual
        .strip_prefix(target)
        .and_then(|s| s.strip_prefix('('))
        .and_then(|s| s.strip_suffix(')'));
    if actual != target
        && !suffix.is_some_and(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
    {
        return Err("企业微信会话标题与接收对象不符，已停止".into());
    }
    one(doc, "i_6")?;
    Ok(())
}
fn confirm_open(device: &impl Automation, folder: &Path, target: &str) -> Result<Chat, String> {
    for _ in 0..4 {
        let xml = snapshot(device, folder, "wecom-chat.xml")?;
        let doc = page_document(&xml, PACKAGE)?;
        if one(&doc, "i_6").is_ok() {
            check_chat(&doc, target)?;
            return Ok(Chat {
                title: target.into(),
            });
        }
        device.settle();
    }
    Err("目标会话尚未打开，未重复点击".into())
}
fn search_named(
    device: &impl Automation,
    folder: &Path,
    target: &str,
    scope: Scope,
) -> Result<Option<Chat>, String> {
    let xml = home(device, folder)?;
    let doc = page_document(&xml, PACKAGE)?;
    click(device, one(&doc, "ndh")?)?;
    let xml = snapshot(device, folder, "wecom-search.xml")?;
    let doc = page_document(&xml, PACKAGE)?;
    let input = one(&doc, "lba")?;
    if input.attribute("showing-hint-text") != Some("true") && !label(input).is_empty() {
        return Err("搜索框已有内容，未覆盖".into());
    }
    device.expect_true("setText", json!([selector("lba"), target]))?;
    device.settle();
    let mut xml = snapshot(device, folder, "wecom-search-results.xml")?;
    let doc = page_document(&xml, PACKAGE)?;
    if label(one(&doc, "lba")?) != target {
        return Err("企业微信搜索内容未能核对".into());
    }
    if scope == Scope::Groups {
        let tabs = one(&doc, "n5o")?;
        let groups: Vec<_> = tabs
            .children()
            .filter(|n| visible(*n) && label(*n) == "群聊")
            .collect();
        if groups.len() != 1 {
            return Err("无法确认搜索中的群聊分类".into());
        }
        click(device, groups[0])?;
        xml = snapshot(device, folder, "wecom-search-groups.xml")?;
    }
    let doc = page_document(&xml, PACKAGE)?;
    let list = one(&doc, "km_")?;
    let found: Vec<_> = list
        .descendants()
        .filter(|n| id(*n, "mid1Txt") && label(*n) == target)
        .collect();
    if found.len() > 1 {
        return Err("搜索到同名会话，未点击".into());
    }
    let Some(node) = found.first() else {
        return Ok(None);
    };
    let row = node
        .ancestors()
        .take_while(|n| *n != list)
        .find(|n| visible(*n) && n.attribute("clickable") == Some("true"))
        .ok_or("搜索会话没有可验证的行入口")?;
    click(device, row)?;
    confirm_open(device, folder, target).map(Some)
}
pub fn open_named(
    device: &impl Automation,
    folder: &Path,
    target: &str,
    scope: Scope,
) -> Result<Chat, String> {
    if let Some(chat) = search_named(device, folder, target, scope)? {
        return Ok(chat);
    }
    let mut xml = list_page(device, folder, scope)?;
    for _ in 0..300 {
        let doc = page_document(&xml, PACKAGE)?;
        let found: Vec<_> = rows(&doc, scope)?
            .into_iter()
            .filter(|(name, _)| name == target)
            .collect();
        if found.len() > 1 {
            return Err("接收会话重名，已停止".into());
        }
        if let Some((_, row)) = found.first() {
            click(device, *row)?;
            return confirm_open(device, folder, target);
        }
        if device.rpc("scrollForward", json!([selector("czp"), true, 20]))? != json!(true) {
            break;
        }
        device.settle();
        xml = snapshot(device, folder, "wecom-list.xml")?;
    }
    Err(format!("企业微信当前列表没有找到完整名称「{target}」"))
}
pub fn open_first(device: &impl Automation, folder: &Path) -> Result<Chat, String> {
    let xml = list_page(device, folder, Scope::Conversations)?;
    let doc = page_document(&xml, PACKAGE)?;
    let rows = rows(&doc, Scope::Conversations)?;
    let (title, row) = rows.first().ok_or("企业微信没有普通会话")?;
    click(device, *row)?;
    confirm_open(device, folder, title)
}
pub fn nickname(device: &impl Automation, folder: &Path) -> Result<String, String> {
    let xml = home(device, folder)?;
    let doc = page_document(&xml, PACKAGE)?;
    click(device, one(&doc, "ndw")?)?;
    let xml = snapshot(device, folder, "wecom-sidebar.xml")?;
    let doc = page_document(&xml, PACKAGE)?;
    let header = one(&doc, "og3")?;
    let name = one(&doc, "mi0")?;
    if !name.ancestors().any(|n| n == header) || label(name).trim().is_empty() {
        return Err("没有确认个人信息中的姓名，已停止".into());
    }
    Ok(label(name).into())
}
fn editor_text<'a>(doc: &'a Document<'_>) -> Result<&'a str, String> {
    let n = one(doc, "i_6")?;
    if n.attribute("password") == Some("true")
        || n.attribute("class") != Some("android.widget.EditText")
    {
        return Err("不是可验证的聊天输入框".into());
    }
    match n.attribute("showing-hint-text") {
        Some("true") => Ok(""),
        Some("false") => Ok(label(n)),
        _ => Err("缺少原生草稿提示状态，请更新连接组件；未覆盖草稿".into()),
    }
}
pub fn send_text(
    device: &impl Automation,
    chat: &Chat,
    text: &str,
    folder: &Path,
    dry_run: bool,
) -> Result<String, String> {
    crate::send_input::validate_message(text)?;
    let xml = snapshot(device, folder, "before-send.xml")?;
    let doc = page_document(&xml, PACKAGE)?;
    check_chat(&doc, &chat.title)?;
    let draft = editor_text(&doc)?;
    if dry_run && draft == text {
        return Ok("演练通过：保留已有相同草稿，未点击发送".into());
    }
    if !draft.is_empty() {
        return Err("会话已有草稿，未覆盖或发送".into());
    }
    let outgoing = |doc: &Document<'_>| {
        let width = doc
            .descendants()
            .filter_map(node_bounds)
            .map(|b| b[2])
            .max()
            .unwrap_or(0);
        doc.descendants()
            .filter(|n| {
                id(*n, "i_d")
                    && label(*n) == text
                    && node_bounds(*n).is_some_and(|b| b[0] > width / 2)
            })
            .count()
    };
    let before = outgoing(&doc);
    device.expect_true("setText", json!([selector("i_6"), text]))?;
    device.settle();
    let xml = snapshot(device, folder, "before-send.xml")?;
    let doc = page_document(&xml, PACKAGE)?;
    check_chat(&doc, &chat.title)?;
    if editor_text(&doc)? != text {
        return Err("草稿输入核对失败，未点击发送".into());
    }
    history::log(
        folder,
        0,
        "draft_verified",
        "原生控件已核对完整草稿和接收会话",
    )?;
    if dry_run {
        device.expect_true("setText", json!([selector("i_6"), ""]))?;
        device.settle();
        let xml = snapshot(device, folder, "after-draft.xml")?;
        let doc = page_document(&xml, PACKAGE)?;
        check_chat(&doc, &chat.title)?;
        if !editor_text(&doc)?.is_empty() {
            return Err("演练草稿清理未确认，未点击发送".into());
        }
        return Ok("演练通过：原生草稿已核对并清理，未点击发送".into());
    }
    let b = node_bounds(one(&doc, "i_6")?).ok_or("输入框不在可见区域")?;
    let sends: Vec<_> = doc
        .descendants()
        .filter(|n| {
            visible(*n)
                && label(*n) == "发送"
                && node_bounds(*n).is_some_and(|r| r[0] >= b[2] && r[1] < b[3] && r[3] > b[1])
        })
        .collect();
    if sends.len() != 1 {
        return Err("未能唯一确认发送按钮，草稿已保留".into());
    }
    history::log(
        folder,
        0,
        "send_requested",
        &format!("向「{}」提交一次发送", chat.title),
    )?;
    click(device, sends[0]).map_err(|e| format!("发送结果不明：{e}；未自动重发"))?;
    for _ in 0..4 {
        let xml = snapshot(device, folder, "after-send.xml")?;
        let doc = page_document(&xml, PACKAGE)?;
        check_chat(&doc, &chat.title)?;
        if editor_text(&doc)?.is_empty() && outgoing(&doc) > before {
            return Ok("已看到新的右侧消息，未验证网络送达".into());
        }
        device.settle();
    }
    Err("发送结果不明，未自动重发，请检查手机会话".into())
}
pub fn broadcast(
    device: &impl Automation,
    folder: &Path,
    input: &SendInput,
    context: &Value,
    dry_run: bool,
    mut report: impl FnMut(&str) -> Result<(), String>,
) -> Result<BTreeMap<String, String>, String> {
    input.validate()?;
    let frozen = if input.refresh_each() {
        None
    } else {
        Some(input.message_for(context)?)
    };
    let list = discover_progress(device, folder, input.recipients.scope, &mut report)?;
    let outputs = wechat::broadcast_to(
        folder,
        input,
        context,
        list,
        frozen,
        dry_run,
        &mut report,
        |action| match action {
            TargetAction::Open(target, path) => {
                open_named(device, path, &target.title, input.recipients.scope).map(|_| ())
            }
            TargetAction::Send(target, text, path) => {
                send_text(device, target, text, path, dry_run).map(|_| ())
            }
        },
    )?;
    home(device, folder)?;
    Ok(outputs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    struct Mock {
        screens: RefCell<std::collections::VecDeque<String>>,
        calls: RefCell<Vec<(String, Value)>>,
    }
    impl Automation for Mock {
        fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.borrow_mut().push((method.into(), params));
            if method == "dumpWindowHierarchy" {
                return Ok(json!(self
                    .screens
                    .borrow_mut()
                    .pop_front()
                    .expect("unexpected page read")));
            }
            Ok(json!(true))
        }
        fn settle(&self) {}
    }
    fn node(name: &str, text: &str, bounds: &str, children: &str) -> String {
        let resource_id = if name.is_empty() {
            String::new()
        } else {
            format!("{PACKAGE}:id/{name}")
        };
        format!(
            r#"<node package="{PACKAGE}" class="android.widget.TextView" resource-id="{resource_id}" text="{text}" bounds="{bounds}" clickable="true" enabled="true" visible-to-user="true">{children}</node>"#
        )
    }
    #[test]
    fn native_search_uses_group_category_and_exact_name_before_opening_once() {
        let home = format!(
            "<hierarchy>{}{}{}{}</hierarchy>",
            node("ncq", "消息", "[489,121][591,190]", ""),
            node("czp", "", "[0,228][1080,2111]", ""),
            node("fg8", "全部", "[109,281][187,331]", ""),
            node("ndh", "", "[792,84][936,228]", "")
        );
        let input = node("lba", "", "[168,123][936,188]", "")
            .replace("clickable=", "showing-hint-text=\"true\" clickable=");
        let typed = node("lba", "测试群", "[168,123][936,188]", "");
        let tabs = node(
            "n5o",
            "",
            "[0,228][1080,360]",
            &node("", "群聊", "[360,228][516,360]", ""),
        );
        let row = node(
            "result-row",
            "",
            "[0,466][1080,682]",
            &node("mid1Txt", "测试群", "[228,550][500,607]", ""),
        );
        let result = format!(
            "<hierarchy>{typed}{}{tabs}</hierarchy>",
            node("km_", "", "[0,361][1080,1449]", &row)
        );
        let chat = format!(
            "<hierarchy>{}{}</hierarchy>",
            node("ncq", "测试群(1)", "[100,100][500,190]", ""),
            node("i_6", "", "[100,2000][800,2200]", "")
        );
        let mock = Mock {
            screens: RefCell::new(
                [
                    home,
                    format!("<hierarchy>{input}</hierarchy>"),
                    format!("<hierarchy>{typed}{tabs}</hierarchy>"),
                    result,
                    chat,
                ]
                .into_iter()
                .collect(),
            ),
            calls: RefCell::new(Vec::new()),
        };
        let dir = std::env::temp_dir().join(format!("por-wecom-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let result = open_named(&mock, &dir, "测试群", Scope::Groups).unwrap();
        assert_eq!(result.title, "测试群");
        let calls = mock.calls.borrow();
        assert_eq!(calls.iter().filter(|(m, _)| m == "setText").count(), 1);
        assert_eq!(calls.iter().filter(|(m, _)| m == "click").count(), 3);
        assert!(!calls
            .iter()
            .any(|(m, _)| m == "scrollToBeginning" || m == "scrollForward"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn empty_transition_is_only_observed_and_never_replays_a_click() {
        let empty = format!(
            "<hierarchy>{}</hierarchy>",
            node("", "", "[0,0][1080,2280]", "")
        );
        let ready = format!(
            "<hierarchy>{}{}</hierarchy>",
            node("one", "一", "[0,0][100,100]", ""),
            node("two", "二", "[0,100][100,200]", "")
        );
        let mock = Mock {
            screens: RefCell::new([empty, ready.clone()].into_iter().collect()),
            calls: RefCell::new(Vec::new()),
        };
        let dir = std::env::temp_dir().join(format!("por-wecom-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        assert_eq!(snapshot(&mock, &dir, "state.xml").unwrap(), ready);
        assert!(mock
            .calls
            .borrow()
            .iter()
            .all(|(m, _)| m == "dumpWindowHierarchy"));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn hint_state_preserves_real_drafts_even_when_they_equal_the_placeholder() {
        let xml = |flag: &str| {
            format!(
                r#"<hierarchy><node package="{PACKAGE}" class="android.widget.EditText" resource-id="{PACKAGE}:id/i_6" bounds="[10,100][300,200]" text="发消息或按住..." {flag}/></hierarchy>"#
            )
        };
        let hint = xml("showing-hint-text=\"true\"");
        assert_eq!(editor_text(&Document::parse(&hint).unwrap()).unwrap(), "");
        let draft = xml("showing-hint-text=\"false\"");
        assert_eq!(
            editor_text(&Document::parse(&draft).unwrap()).unwrap(),
            "发消息或按住..."
        );
        let unknown = xml("");
        assert!(editor_text(&Document::parse(&unknown).unwrap()).is_err());
    }
    #[test]
    #[ignore = "requires an authorized, connected phone; rehearsal only, never clicks Send"]
    fn real_device_bundled_workflows() {
        let adb = std::path::PathBuf::from(std::env::var("POR_TEST_ADB").expect("POR_TEST_ADB"));
        let serial = std::env::var("POR_TEST_SERIAL").expect("POR_TEST_SERIAL");
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../work/wecom-debug-cache/product-runs");
        let mut wake = crate::awake::ScreenAwake::start(&adb, &serial).unwrap();
        let result = std::panic::catch_unwind(|| {
            for bytes in crate::workflow::BUNDLED_WORKFLOWS
                .iter()
                .filter(|s| s.contains("com.tencent.wework"))
            {
                let workflow = crate::workflow::Workflow::parse(bytes.as_bytes()).unwrap();
                let (_, folder) = history::create_folder(&root).unwrap();
                let input = if workflow.configurable() {
                    Some(serde_json::from_value::<SendInput>(json!({"message":{"type":"manual","text":"Ok"},"recipients":{"scope":"groups","mode":"all","names":[]},"intervalMs":1000})).unwrap())
                } else {
                    None
                };
                let outputs = crate::workflow::execute_with_input(
                    &workflow,
                    input.as_ref(),
                    true,
                    &adb,
                    &serial,
                    &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/u2.jar"),
                    &folder,
                    |_, _, step, _| {
                        println!("{}: {step}", workflow.id);
                        Ok(())
                    },
                )
                .unwrap();
                assert!(!outputs.is_empty() || workflow.id == "wecom-open");
                fs::write(
                    folder.join("validation.json"),
                    serde_json::to_vec_pretty(
                        &json!({"workflow":workflow.id,"outputs":outputs,"dryRun":true}),
                    )
                    .unwrap(),
                )
                .unwrap();
                println!("{}: PASSED (no Send)", workflow.id);
            }
        });
        wake.restore().unwrap();
        if let Err(error) = result {
            std::panic::resume_unwind(error);
        }
    }
}
