use crate::{
    history,
    send_input::{Scope, Selection, SendInput},
    u2::Automation,
    workflow::{node_bounds, page_document},
};
use roxmltree::{Document, Node};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::Path,
    thread,
    time::Duration,
};

const PACKAGE: &str = "com.tencent.mm";
pub const VERIFICATION_REQUIRED: &str =
    "微信显示「安全保护中」，需要账号本人在手机完成验证解除；当前流程已停止";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Chat {
    pub title: String,
}

fn label<'a>(node: Node<'a, '_>) -> &'a str {
    node.attribute("text").unwrap_or("")
}
fn enabled(node: Node<'_, '_>) -> bool {
    node.attribute("enabled") != Some("false")
}
fn height(doc: &Document<'_>) -> i32 {
    doc.descendants()
        .filter_map(node_bounds)
        .map(|b| b[3])
        .max()
        .unwrap_or(0)
}
fn center(node: Node<'_, '_>) -> Option<(i32, i32)> {
    node_bounds(node).map(|b| ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2))
}

fn document(xml: &str) -> Result<Document<'_>, String> {
    page_document(xml, PACKAGE)
}

fn snapshot(device: &impl Automation, folder: &Path, name: &str) -> Result<String, String> {
    let xml = device.dump()?;
    fs::write(folder.join("hierarchy.xml"), &xml).map_err(|e| e.to_string())?;
    fs::write(folder.join(name), &xml).map_err(|e| e.to_string())?;
    document(&xml)?;
    Ok(xml)
}

fn home_tab(xml: &str) -> Result<Option<(i32, i32)>, String> {
    let doc = document(xml)?;
    let h = height(&doc);
    let bottom = |n| node_bounds(n).is_some_and(|b| b[1] * 4 > h * 3);
    if !["通讯录", "发现", "我"]
        .iter()
        .all(|text| doc.descendants().any(|n| label(n) == *text && bottom(n)))
    {
        return Ok(None);
    }
    let points: BTreeSet<_> = doc
        .descendants()
        .filter(|n| {
            let text = label(*n);
            (text == "微信"
                || (text.starts_with("微信(") && text.ends_with(')'))
                || (text.starts_with("微信（") && text.ends_with('）')))
                && bottom(*n)
                && enabled(*n)
        })
        .filter_map(center)
        .collect();
    if points.len() != 1 {
        return Err("无法唯一确认微信底部会话入口".into());
    }
    Ok(points.into_iter().next())
}

fn list_node<'a, 'input>(doc: &'a Document<'input>) -> Result<Node<'a, 'input>, String> {
    let h = height(doc);
    let lists: Vec<_> = doc
        .descendants()
        .filter(|n| {
            let class = n.attribute("class").unwrap_or("");
            (class == "android.widget.ListView" || class.ends_with(".RecyclerView"))
                && n.attribute("package") == Some(PACKAGE)
                && node_bounds(*n).is_some_and(|b| b[1] < h * 2 / 5 && b[3] - b[1] > h * 2 / 5)
        })
        .collect();
    if lists.len() != 1 {
        return Err("无法唯一识别微信会话列表，请先运行「打开微信首个会话」检查适配".into());
    }
    Ok(lists[0])
}

fn list_selector(xml: &str) -> Result<Value, String> {
    let doc = document(xml)?;
    let list = list_node(&doc)?;
    Ok(
        if let Some(id) = list.attribute("resource-id").filter(|id| !id.is_empty()) {
            json!({"mask":0x280000,"resourceId":id,"packageName":PACKAGE})
        } else {
            json!({"mask":0x80010,"className":list.attribute("class"),"packageName":PACKAGE})
        },
    )
}

fn first_row(xml: &str) -> Result<(Chat, (i32, i32)), String> {
    let doc = document(xml)?;
    let list = list_node(&doc)?;
    let list_bounds = node_bounds(list).ok_or("会话列表不可见")?;
    let row = list
        .children()
        .filter(|n| n.is_element())
        .find(|n| node_bounds(*n).is_some_and(|b| b[3] > list_bounds[1] && b[1] < list_bounds[3]))
        .ok_or("微信会话列表为空")?;
    let row_bounds = node_bounds(row).ok_or("首个会话不可见")?;
    let avatar = row
        .descendants()
        .filter(|n| n.attribute("class") == Some("android.widget.ImageView"))
        .filter_map(node_bounds)
        .filter(|b| b[0] < (row_bounds[0] + row_bounds[2]) / 2)
        .min_by_key(|b| b[0])
        .ok_or("列表第一项无法确认为聊天会话，已停止；不会跳过第一项给其他会话发送")?;
    let names: BTreeSet<_> = row
        .descendants()
        .filter(|n| {
            n.attribute("class") == Some("android.widget.TextView")
                && enabled(*n)
                && !label(*n).trim().is_empty()
                && node_bounds(*n).is_some_and(|b| {
                    b[0] >= avatar[2]
                        && b[0] < (row_bounds[0] + row_bounds[2]) / 2
                        && b[1] < (row_bounds[1] + row_bounds[3]) / 2
                })
        })
        .map(label)
        .collect();
    if names.len() != 1 {
        return Err("无法唯一读取头像旁的首个会话名称，已停止".into());
    }
    let title = names.into_iter().next().unwrap();
    if ["订阅号消息", "服务通知", "折叠置顶聊天", "微信团队"].contains(&title) {
        return Err(format!("第一项「{title}」不是受支持的普通聊天会话，已停止"));
    }
    Ok((
        Chat {
            title: title.into(),
        },
        center(row).ok_or("首个会话不可见")?,
    ))
}

fn title_matches(expected: &str, actual: &str) -> bool {
    expected == actual
        || actual.strip_prefix(expected).is_some_and(|suffix| {
            let count = suffix
                .strip_prefix('(')
                .and_then(|s| s.strip_suffix(')'))
                .or_else(|| suffix.strip_prefix('（').and_then(|s| s.strip_suffix('）')));
            count.is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
        })
}

fn check_title(doc: &Document<'_>, chat: &Chat) -> Result<(), String> {
    let h = height(doc);
    let titles: BTreeSet<_> = doc
        .descendants()
        .filter(|n| {
            n.attribute("package") == Some(PACKAGE)
                && title_matches(&chat.title, label(*n))
                && node_bounds(*n).is_some_and(|b| b[1] < h / 5)
        })
        .filter_map(center)
        .collect();
    if titles.len() != 1 {
        return Err(format!(
            "会话标题与首项「{}」不一致或不可见，已停止发送",
            chat.title
        ));
    }
    Ok(())
}

fn editor<'a, 'input>(doc: &'a Document<'input>) -> Result<Node<'a, 'input>, String> {
    let h = height(doc);
    let editors: Vec<_> = doc
        .descendants()
        .filter(|n| {
            n.attribute("class") == Some("android.widget.EditText")
                && n.attribute("package") == Some(PACKAGE)
                && enabled(*n)
                && node_bounds(*n).is_some_and(|b| b[1] > h * 2 / 5)
        })
        .collect();
    if editors.len() != 1 {
        return Err("当前会话没有唯一可编辑的文字输入框，已停止发送".into());
    }
    Ok(editors[0])
}

pub fn open_first(device: &impl Automation, folder: &Path) -> Result<Chat, String> {
    let mut xml = home(device, folder)?;
    device.expect_true(
        "scrollToBeginning",
        json!([list_selector(&xml)?, true, 100, 20]),
    )?;
    device.settle();
    xml = snapshot(device, folder, "chat-list.xml")?;
    let (chat, (x, y)) = first_row(&xml)?;
    history::log(
        folder,
        0,
        "target",
        &format!("本轮首个会话：{}", chat.title),
    )?;
    device.click(x, y)?;
    device.settle();
    check_title(
        &document(&snapshot(device, folder, "chat-open.xml")?)?,
        &chat,
    )?;
    Ok(chat)
}

pub fn home(device: &impl Automation, folder: &Path) -> Result<String, String> {
    let mut xml = snapshot(device, folder, "chat-list.xml")?;
    let mut found = false;
    for attempt in 0..=4 {
        if let Some((x, y)) = home_tab(&xml)? {
            device.click(x, y)?;
            found = true;
            break;
        }
        if attempt == 4 {
            break;
        }
        device.expect_true("pressKey", json!(["back"]))?;
        device.settle();
        xml = snapshot(device, folder, "chat-list.xml")?;
    }
    if !found {
        return Err("无法回到微信首页，请手动打开会话列表后重试".into());
    }
    device.settle();
    xml = snapshot(device, folder, "chat-list.xml")?;
    if home_tab(&xml)?.is_none() {
        return Err("未回到微信首页，已停止".into());
    }
    Ok(xml)
}

fn tap_label(
    device: &impl Automation,
    xml: &str,
    labels: &[&str],
    top: bool,
) -> Result<(), String> {
    let doc = document(xml)?;
    let h = height(&doc);
    let points: BTreeSet<_> = doc
        .descendants()
        .filter(|n| {
            enabled(*n)
                && (labels.contains(&label(*n))
                    || labels.contains(&n.attribute("content-desc").unwrap_or("")))
                && (!top || node_bounds(*n).is_some_and(|b| b[1] < h / 5))
        })
        .filter_map(center)
        .collect();
    if points.len() != 1 {
        return Err(format!(
            "无法唯一识别「{}」，未执行点击",
            labels.join(" / ")
        ));
    }
    let (x, y) = points.into_iter().next().unwrap();
    device.click(x, y)?;
    device.settle();
    Ok(())
}

pub fn open_named(device: &impl Automation, folder: &Path, target: &str) -> Result<Chat, String> {
    let xml = home(device, folder)?;
    tap_label(device, &xml, &["搜索", "搜索按钮"], true)?;
    let xml = snapshot(device, folder, "search.xml")?;
    let doc = document(&xml)?;
    let edits: Vec<_> = doc
        .descendants()
        .filter(|n| {
            n.attribute("class") == Some("android.widget.EditText")
                && enabled(*n)
                && n.attribute("package") == Some(PACKAGE)
        })
        .collect();
    if edits.len() != 1 {
        return Err("搜索页没有唯一输入框，已停止".into());
    }
    let bounds = node_bounds(edits[0]).ok_or("搜索框不可见")?;
    let mut selector =
        json!({"mask":0x80010,"className":"android.widget.EditText","packageName":PACKAGE});
    if let Some(id) = edits[0].attribute("resource-id").filter(|v| !v.is_empty()) {
        selector["resourceId"] = json!(id);
        selector["mask"] = json!(0x280010);
    }
    device.expect_true("setText", json!([selector, target]))?;
    device.settle();
    let xml = snapshot(device, folder, "search.xml")?;
    let doc = document(&xml)?;
    let points: BTreeSet<_> = doc
        .descendants()
        .filter(|n| {
            label(*n) == target
                && enabled(*n)
                && n.attribute("class") != Some("android.widget.EditText")
                && node_bounds(*n).is_some_and(|b| b[1] >= bounds[3])
        })
        .filter_map(center)
        .collect();
    if points.len() != 1 {
        return Err(format!(
            "搜索「{target}」得到 {} 个同名结果，未选择；请核对接收会话",
            points.len()
        ));
    }
    let (x, y) = points.into_iter().next().unwrap();
    device.click(x, y)?;
    device.settle();
    let chat = Chat {
        title: target.into(),
    };
    let xml = snapshot(device, folder, "chat-open.xml")?;
    let doc = document(&xml)?;
    check_title(&doc, &chat)?;
    if target == "文件传输助手"
        && !doc
            .descendants()
            .any(|n| label(n) == target && node_bounds(n).is_some_and(|b| b[1] < height(&doc) / 5))
    {
        return Err("目标并非文件传输助手，已停止".into());
    }
    Ok(chat)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetList {
    pub items: Vec<Chat>,
    pub source: String,
    pub scanned_at: u64,
    pub complete: bool,
}

fn row_names(xml: &str) -> Result<Vec<String>, String> {
    let doc = document(xml)?;
    let list = list_node(&doc)?;
    let viewport = node_bounds(list).ok_or("列表不可见")?;
    let mut names = Vec::new();
    for row in list.children().filter(|n| n.is_element()) {
        let Some(b) = node_bounds(row).filter(|b| b[1] >= viewport[1] && b[3] <= viewport[3])
        else {
            continue;
        };
        let avatar = row
            .descendants()
            .filter(|n| n.attribute("class") == Some("android.widget.ImageView"))
            .filter_map(node_bounds)
            .filter(|a| a[0] < (b[0] + b[2]) / 2)
            .min_by_key(|a| a[0]);
        let Some(avatar) = avatar else {
            if row.attribute("clickable") == Some("true") {
                return Err("列表中存在无法识别的可点击项目，未开始发送".into());
            }
            continue;
        };
        let candidates: Vec<_> = row
            .descendants()
            .filter(|n| {
                n.attribute("class") == Some("android.widget.TextView")
                    && !label(*n).trim().is_empty()
                    && node_bounds(*n).is_some_and(|a| {
                        a[0] >= avatar[2] && a[0] < (b[0] + b[2]) / 2 && a[1] < (b[1] + b[3]) / 2
                    })
            })
            .map(label)
            .collect();
        if candidates.len() != 1 {
            return Err("列表存在无法唯一识别的会话名称，未开始发送".into());
        }
        let name = candidates[0];
        if ![
            "公众号",
            "订阅号消息",
            "服务通知",
            "折叠置顶聊天",
            "微信团队",
            "微信运动",
            "支付服务",
            "微信支付",
        ]
        .contains(&name)
        {
            names.push(name.into());
        }
    }
    Ok(names)
}

pub(crate) fn merge_page(names: &mut Vec<String>, page: &[String]) -> Result<(), String> {
    if page.iter().collect::<BTreeSet<_>>().len() != page.len() {
        return Err("列表包含同名会话，无法安全区分，未开始发送".into());
    }
    let overlap = (0..=names.len().min(page.len()))
        .rev()
        .find(|n| names[names.len() - n..] == page[..*n])
        .unwrap_or(0);
    for name in &page[overlap..] {
        if names.contains(name) {
            return Err(format!(
                "会话「{name}」出现重复或列表在读取中发生变化，请重新读取"
            ));
        }
        names.push(name.clone());
    }
    Ok(())
}

pub fn discover_progress(
    device: &impl Automation,
    folder: &Path,
    scope: Scope,
    mut report: impl FnMut(&str) -> Result<(), String>,
) -> Result<TargetList, String> {
    let mut xml = home(device, folder)?;
    let source = if scope == Scope::Groups {
        tap_label(device, &xml, &["更多功能按钮", "添加", "更多功能"], true)?;
        xml = snapshot(device, folder, "group-picker.xml")?;
        tap_label(device, &xml, &["发起群聊"], false)?;
        xml = snapshot(device, folder, "group-picker.xml")?;
        tap_label(
            device,
            &xml,
            &["选择一个群", "选择群聊", "选择一个已有的群"],
            false,
        )?;
        xml = snapshot(device, folder, "group-picker.xml")?;
        "微信「选择一个群」列表（本次可枚举的群聊）"
    } else {
        "微信首页会话列表（普通会话与群聊，不含公众号等系统入口）"
    };
    let selector = list_selector(&xml)?;
    device.expect_true("scrollToBeginning", json!([selector, true, 300, 20]))?;
    device.settle();
    let mut names = Vec::new();
    let mut last = Vec::new();
    for page_number in 0..300 {
        report(&format!(
            "正在读取会话列表第 {} 屏，已发现 {} 个",
            page_number + 1,
            names.len()
        ))?;
        xml = snapshot(device, folder, "recipient-list.xml")?;
        let page = row_names(&xml)?;
        if page == last && !names.is_empty() {
            return Err("列表无法继续滚动，也未确认到达末尾，未开始发送".into());
        }
        merge_page(&mut names, &page)?;
        last = page;
        if names.len() > 2000 {
            return Err("本轮超过 2000 个会话，请分批选择".into());
        }
        let moved = device
            .rpc("scrollForward", json!([selector, true, 20]))?
            .as_bool()
            .ok_or("滚动响应无效")?;
        if !moved {
            return Ok(TargetList {
                items: names.into_iter().map(|title| Chat { title }).collect(),
                source: source.into(),
                scanned_at: history::now(),
                complete: true,
            });
        }
        device.settle();
    }
    Err("未能确认列表末尾，未开始发送；请分批勾选会话".into())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delivery {
    pub title: String,
    pub status: String,
    pub message: Option<String>,
    pub error: Option<String>,
    pub updated_at: u64,
}
fn save_deliveries(folder: &Path, records: &[Delivery]) -> Result<(), String> {
    let next = folder.join("targets.next.json");
    let mut file = fs::File::create(&next).map_err(|e| e.to_string())?;
    file.write_all(&serde_json::to_vec_pretty(records).map_err(|e| e.to_string())?)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(next, folder.join("targets.json")).map_err(|e| format!("保存逐会话记录失败：{e}"))
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
    let frozen_message = if input.refresh_each() {
        None
    } else {
        Some(input.message_for(context)?)
    };
    report("正在读取接收会话列表")?;
    let list = discover_progress(device, folder, input.recipients.scope, &mut report)?;
    let outputs = broadcast_to(
        folder,
        input,
        context,
        list,
        frozen_message,
        dry_run,
        &mut report,
        |target, text, child| {
            let chat = open_named(device, child, &target.title)?;
            send_text(device, &chat, text, child, dry_run)
        },
    )?;
    home(device, folder)?;
    Ok(outputs)
}

pub fn broadcast_to(
    folder: &Path,
    input: &SendInput,
    context: &Value,
    list: TargetList,
    frozen_message: Option<String>,
    dry_run: bool,
    mut report: impl FnMut(&str) -> Result<(), String>,
    mut send: impl FnMut(&Chat, &str, &Path) -> Result<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    if !list.complete {
        return Err("接收会话列表未读取完整，未开始发送".into());
    }
    let targets = if input.recipients.mode == Selection::All {
        list.items
    } else {
        let mut selected = Vec::new();
        for name in &input.recipients.names {
            let matches: Vec<_> = list.items.iter().filter(|c| c.title == *name).collect();
            if matches.len() != 1 {
                return Err(format!(
                    "勾选的会话「{name}」不在当前列表或重名，未开始发送"
                ));
            }
            selected.push(matches[0].clone());
        }
        selected
    };
    if targets.is_empty() {
        return Err("没有找到可发送的会话，未发送消息".into());
    }
    let mut deliveries: Vec<_> = targets
        .iter()
        .map(|c| Delivery {
            title: c.title.clone(),
            status: "pending".into(),
            message: None,
            error: None,
            updated_at: history::now(),
        })
        .collect();
    save_deliveries(folder, &deliveries)?;
    let mut completed = 0;
    for (i, target) in targets.iter().enumerate() {
        if let Err(error) = report(&format!(
            "正在处理 {}/{}：{}",
            i + 1,
            targets.len(),
            target.title
        )) {
            for remaining in &mut deliveries[i..] {
                remaining.status = "skipped".into();
                remaining.error = Some(error.clone());
            }
            save_deliveries(folder, &deliveries)?;
            return Err(error);
        }
        let child = folder.join(format!("target-{:04}", i + 1));
        fs::create_dir_all(&child).map_err(|e| e.to_string())?;
        let result = (|| {
            let text = if let Some(message) = &frozen_message {
                message.clone()
            } else {
                let mut context = context.clone();
                context["recipient"] =
                    json!({"title":target.title,"index":i+1,"total":targets.len()});
                input.message_for(&context)?
            };
            deliveries[i].status = if dry_run { "rehearsing" } else { "sending" }.into();
            deliveries[i].message = Some(text.clone());
            deliveries[i].updated_at = history::now();
            save_deliveries(folder, &deliveries)?;
            send(target, &text, &child)
        })();
        deliveries[i].updated_at = history::now();
        match result {
            Ok(_) => {
                deliveries[i].status = if dry_run { "rehearsed" } else { "sent" }.into();
                completed += 1;
            }
            Err(error) => {
                let intent = fs::read_to_string(child.join("events.jsonl"))
                    .unwrap_or_default()
                    .contains("send_requested");
                deliveries[i].status = if intent { "uncertain" } else { "failed" }.into();
                deliveries[i].error = Some(error.clone());
                for remaining in &mut deliveries[i + 1..] {
                    remaining.status = "skipped".into();
                    remaining.error = Some("本轮已停止，未发送".into());
                }
                save_deliveries(folder, &deliveries)?;
                history::log(
                    folder,
                    0,
                    "failed",
                    &format!(
                        "已{} {completed}/{}；「{}」：{error}",
                        if dry_run { "演练" } else { "发送" },
                        targets.len(),
                        target.title
                    ),
                )?;
                return Err(format!(
                    "已{} {completed}/{}，本轮已停止：「{}」{error}；逐会话记录已保存",
                    if dry_run { "演练" } else { "发送" },
                    targets.len(),
                    target.title
                ));
            }
        }
        save_deliveries(folder, &deliveries)?;
        // Keep visual images for the first, latest successful and failed target; all target JSON stays.
        if i > 1 {
            for name in ["visual-before-send.png", "visual-after-send.png"] {
                let _ = fs::remove_file(folder.join(format!("target-{i:04}")).join(name));
            }
        }
        history::log(
            folder,
            i + 1,
            if dry_run { "rehearsed" } else { "sent" },
            &format!(
                "已{} {completed}/{}：{}",
                if dry_run { "演练" } else { "发送" },
                targets.len(),
                target.title
            ),
        )?;
        if i + 1 < targets.len() {
            thread::sleep(Duration::from_millis(input.interval_ms));
        }
    }
    let outputs = BTreeMap::from([
        (
            "send_status".into(),
            if dry_run {
                format!("演练通过 {completed}/{} 个会话，未点击发送", targets.len())
            } else {
                format!("已发送 {completed}/{} 个会话", targets.len())
            },
        ),
        ("recipient_source".into(), list.source),
    ]);
    Ok(outputs)
}

fn outgoing_count(doc: &Document<'_>, text: &str) -> usize {
    let width = doc
        .descendants()
        .filter_map(node_bounds)
        .map(|b| b[2])
        .max()
        .unwrap_or(0);
    doc.descendants()
        .filter(|n| {
            label(*n) == text
                && n.attribute("class") == Some("android.widget.TextView")
                && node_bounds(*n).is_some_and(|b| b[0] > width / 2 && b[1] > height(doc) / 5)
        })
        .count()
}

pub fn send_text(
    device: &impl Automation,
    chat: &Chat,
    text: &str,
    folder: &Path,
    dry_run: bool,
) -> Result<String, String> {
    let mut xml = snapshot(device, folder, "before-send.xml")?;
    {
        let doc = document(&xml)?;
        check_title(&doc, chat)?;
        if editor(&doc).is_err() {
            let switches: BTreeSet<_> = doc
                .descendants()
                .filter(|n| {
                    enabled(*n)
                        && ["切换到键盘", "切换到文字输入"]
                            .contains(&n.attribute("content-desc").unwrap_or(""))
                })
                .filter_map(center)
                .collect();
            if switches.len() != 1 {
                return Err("请将微信会话切换为文字输入模式，再重新运行".into());
            }
            let (x, y) = switches.into_iter().next().unwrap();
            device.click(x, y)?;
            device.settle();
            xml = snapshot(device, folder, "before-send.xml")?;
        }
    }
    let doc = document(&xml)?;
    check_title(&doc, chat)?;
    let draft = label(editor(&doc)?);
    if dry_run && draft == text {
        history::log(
            folder,
            0,
            "draft_verified",
            "演练通过：已有相同草稿，保留原草稿；未点击发送",
        )?;
        return Ok("演练通过：已有相同草稿，未改动草稿或点击发送".into());
    }
    if !draft.is_empty() {
        return Err("会话中已有未发送草稿，已停止，未覆盖草稿".into());
    }
    let input = editor(&doc)?;
    let resource_id = input
        .attribute("resource-id")
        .filter(|id| !id.is_empty())
        .ok_or("输入框没有可验证的标识，未输入或发送")?;
    if doc
        .descendants()
        .filter(|n| n.attribute("resource-id") == Some(resource_id))
        .count()
        != 1
    {
        return Err("输入框标识不唯一，未输入或发送".into());
    }
    let before = outgoing_count(&doc, text);
    device.expect_true(
        "setText",
        json!([{"mask":0x280010,"className":"android.widget.EditText","packageName":PACKAGE,"resourceId":resource_id}, text]),
    )?;
    device.settle();
    let xml = snapshot(device, folder, "before-send.xml")?;
    let doc = document(&xml)?;
    check_title(&doc, chat)?;
    let input = editor(&doc)?;
    if label(input) != text {
        return Err("输入内容校验失败，未点击发送；请检查手机草稿".into());
    }
    if dry_run {
        history::log(
            folder,
            0,
            "draft_verified",
            "演练通过：输入内容已核对，未点击发送",
        )?;
        device.expect_true("setText",json!([{"mask":0x280010,"className":"android.widget.EditText","packageName":PACKAGE,"resourceId":resource_id}, ""]))?;
        device.settle();
        let cleared = snapshot(device, folder, "after-draft.xml")?;
        let cleared = document(&cleared)?;
        check_title(&cleared, chat)?;
        if !label(editor(&cleared)?).is_empty() {
            return Err("演练草稿清理未能确认，未点击发送；请检查手机草稿".into());
        }
        return Ok("演练通过：草稿已核对并清理，未点击发送".into());
    }
    let input_bounds = node_bounds(input).ok_or("输入框不可见")?;
    let sends: BTreeSet<_> = doc
        .descendants()
        .filter(|n| {
            label(*n) == "发送"
                && enabled(*n)
                && n.attribute("package") == Some(PACKAGE)
                && node_bounds(*n).is_some_and(|b| b[1] < input_bounds[3] && b[3] > input_bounds[1])
        })
        .filter_map(center)
        .collect();
    if sends.len() != 1 {
        return Err("找不到唯一的发送按钮，未点击发送；请检查手机草稿".into());
    }
    // Persist intent before the irreversible click; never retry after this point.
    history::log(
        folder,
        0,
        "send_requested",
        &format!("即将向「{}」发送：{text}", chat.title),
    )?;
    let (x, y) = sends.into_iter().next().unwrap();
    device
        .click(x, y)
        .map_err(|e| format!("发送结果不明：{e}；请人工核对会话，勿直接重跑以免重复发送"))?;
    for _ in 0..6 {
        device.settle();
        let check = snapshot(device, folder, "after-send.xml").and_then(|xml| {
            let doc = document(&xml)?;
            check_title(&doc, chat)?;
            Ok(label(editor(&doc)?).is_empty() && outgoing_count(&doc, text) > before)
        });
        if check == Ok(true) {
            history::log(
                folder,
                0,
                "send_observed",
                "已点击一次发送，输入框已清空且看到新的右侧消息；未验证网络送达",
            )?;
            return Ok("已点击发送，看到新的右侧消息（未验证网络送达）".into());
        }
        if check
            .as_ref()
            .err()
            .is_some_and(|e| e == VERIFICATION_REQUIRED)
        {
            return Err(format!(
                "已点击一次发送；{VERIFICATION_REQUIRED}。发送结果待核对，不会自动重发"
            ));
        }
    }
    Err("已点击一次发送，但未能确认新消息；请人工核对会话，勿直接重跑以免重复发送".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_batch_stops_on_uncertain_send_and_keeps_every_target_state() {
        use crate::send_input::{Message, Recipients};
        let folder = std::env::temp_dir().join(format!("por-batch-state-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&folder).unwrap();
        let input = SendInput {
            message: Message::Manual { text: "Ok".into() },
            recipients: Recipients {
                scope: Scope::Groups,
                mode: Selection::All,
                names: vec![],
            },
            interval_ms: 500,
        };
        let list = TargetList {
            items: ["A", "B", "C"]
                .into_iter()
                .map(|s| Chat { title: s.into() })
                .collect(),
            source: "test-list".into(),
            scanned_at: history::now(),
            complete: true,
        };
        let mut calls = Vec::new();
        let result = broadcast_to(
            &folder,
            &input,
            &json!({}),
            list,
            Some("Ok".into()),
            false,
            |_| Ok(()),
            |target, text, child| {
                assert_eq!(text, "Ok");
                calls.push(target.title.clone());
                if target.title == "B" {
                    history::log(child, 0, "send_requested", "test intent")?;
                    Err("outcome unknown".into())
                } else {
                    Ok("observed".into())
                }
            },
        );
        assert!(result.is_err());
        assert_eq!(calls, vec!["A", "B"]);
        let records: Vec<Delivery> =
            serde_json::from_slice(&fs::read(folder.join("targets.json")).unwrap()).unwrap();
        assert_eq!(
            records
                .iter()
                .map(|d| d.status.as_str())
                .collect::<Vec<_>>(),
            vec!["sent", "uncertain", "skipped"]
        );
        fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn rehearsal_batch_records_completed_drafts_separately_from_sent_messages() {
        use crate::send_input::{Message, Recipients};
        let folder = folder();
        let input = SendInput {
            message: Message::Manual { text: "Ok".into() },
            recipients: Recipients {
                scope: Scope::Groups,
                mode: Selection::All,
                names: vec![],
            },
            interval_ms: 500,
        };
        let list = TargetList {
            items: vec![Chat {
                title: "测试群".into(),
            }],
            source: "test-list".into(),
            scanned_at: history::now(),
            complete: true,
        };
        let outputs = broadcast_to(
            &folder,
            &input,
            &json!({}),
            list,
            Some("Ok".into()),
            true,
            |_| Ok(()),
            |_, text, child| {
                assert_eq!(text, "Ok");
                history::log(child, 0, "draft_verified", "verified without send")?;
                Ok("rehearsed".into())
            },
        )
        .unwrap();
        assert_eq!(outputs["send_status"], "演练通过 1/1 个会话，未点击发送");
        let records: Vec<Delivery> =
            serde_json::from_slice(&fs::read(folder.join("targets.json")).unwrap()).unwrap();
        assert_eq!(records[0].status, "rehearsed");
        assert!(!fs::read_to_string(folder.join("events.jsonl"))
            .unwrap()
            .contains("send_requested"));
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn a_thousand_selected_targets_are_not_truncated_or_duplicated() {
        use crate::send_input::{Message, Recipients};
        let folder = folder();
        let names: Vec<_> = (0..1000).map(|i| format!("测试群{i:04}")).collect();
        let mut input = SendInput {
            message: Message::Manual { text: "Ok".into() },
            recipients: Recipients {
                scope: Scope::Groups,
                mode: Selection::Selected,
                names: names.clone(),
            },
            interval_ms: 500,
        };
        input.validate().unwrap();
        // Only this fixture bypasses pacing; production inputs enforce at least 500 ms.
        input.interval_ms = 0;
        let list = TargetList {
            items: names
                .iter()
                .map(|name| Chat {
                    title: name.clone(),
                })
                .collect(),
            source: "fixture".into(),
            scanned_at: history::now(),
            complete: true,
        };
        let mut visited = Vec::new();
        let outputs = broadcast_to(
            &folder,
            &input,
            &json!({}),
            list,
            Some("Ok".into()),
            true,
            |_| Ok(()),
            |chat, text, _| {
                assert_eq!(text, "Ok");
                visited.push(chat.title.clone());
                Ok("rehearsed".into())
            },
        )
        .unwrap();
        assert_eq!(visited, names);
        assert_eq!(
            outputs["send_status"],
            "演练通过 1000/1000 个会话，未点击发送"
        );
        let records: Vec<Delivery> =
            serde_json::from_slice(&fs::read(folder.join("targets.json")).unwrap()).unwrap();
        assert_eq!(records.len(), 1000);
        assert!(records.iter().all(|r| r.status == "rehearsed"));
        fs::remove_dir_all(folder).unwrap();
    }
    use std::cell::RefCell;
    use std::collections::VecDeque;

    const HOME: &str = include_str!("../tests/fixtures/wechat-home.xml");
    const CHAT: &str = include_str!("../tests/fixtures/wechat-chat.xml");

    #[test]
    fn recipient_pages_merge_overlap_but_reject_ambiguous_names() {
        let mut names = vec!["A".into(), "B".into(), "C".into()];
        merge_page(&mut names, &["C".into(), "D".into()]).unwrap();
        assert_eq!(names, vec!["A", "B", "C", "D"]);
        assert!(merge_page(&mut names, &["X".into(), "X".into()]).is_err());
        assert!(merge_page(&mut names, &["A".into(), "E".into()]).is_err());
        assert_eq!(row_names(HOME).unwrap(), vec!["测试联系人", "第二个联系人"]);
    }
    struct Fake {
        screens: RefCell<VecDeque<String>>,
        calls: RefCell<Vec<(String, Value)>>,
        fail_click: bool,
    }
    impl Automation for Fake {
        fn rpc(&self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.borrow_mut().push((method.into(), params));
            if method == "dumpWindowHierarchy" {
                return Ok(json!(self
                    .screens
                    .borrow_mut()
                    .pop_front()
                    .expect("unexpected extra read")));
            }
            if method == "click" && self.fail_click {
                return Err("timeout".into());
            }
            Ok(json!(true))
        }
        fn settle(&self) {}
    }
    fn fake(screens: Vec<String>, fail_click: bool) -> Fake {
        Fake {
            screens: RefCell::new(screens.into()),
            calls: RefCell::new(vec![]),
            fail_click,
        }
    }
    fn folder() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("por-wechat-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }
    fn typed() -> String {
        CHAT.replace(
            "text=\"\" resource-id=\"com.tencent.mm:id/input\"",
            "text=\"你好\" resource-id=\"com.tencent.mm:id/input\"",
        )
    }

    #[test]
    fn empty_wechat_tree_never_falls_back_to_visual_input_for_chat_workflows() {
        let device = fake(vec![r#"<hierarchy><node package="com.tencent.mm" class="" visible-to-user="false" bounds="[0,0][0,0]"/></hierarchy>"#.into()], false);
        let root = folder();
        assert!(open_first(&device, &root).unwrap_err().contains("页面控件"));
        let calls = device.calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "dumpWindowHierarchy");
        fs::remove_dir_all(root).unwrap();
    }
    fn sent() -> String {
        CHAT.replace("<!-- messages -->", r#"<node package="com.tencent.mm" class="android.widget.TextView" text="你好" bounds="[800,900][950,980]"/>"#)
    }

    #[test]
    fn selects_first_visible_row_including_pinned_and_checks_chat_identity() {
        let folder = folder();
        let device = fake(
            vec![HOME.into(), HOME.into(), HOME.into(), CHAT.into()],
            false,
        );
        let chat = open_first(&device, &folder).unwrap();
        assert_eq!(chat.title, "测试联系人");
        assert_eq!(
            device
                .calls
                .borrow()
                .iter()
                .filter(|c| c.0 == "click")
                .map(|c| c.1.clone())
                .collect::<Vec<_>>(),
            vec![json!([135, 1850]), json!([540, 275])]
        );
        assert!(check_title(
            &document(CHAT).unwrap(),
            &Chat {
                title: "其他人".into()
            }
        )
        .is_err());
        assert!(title_matches("测试群", "测试群(12)"));
        assert!(!title_matches("测试", "测试联系人"));
        assert!(first_row(&HOME.replace("android.widget.ImageView", "android.view.View")).is_err());
        assert!(first_row(&HOME.replace("测试联系人", "订阅号消息")).is_err());
        for name in ["周先生", "123", "昨天", "星期四测试群"] {
            assert_eq!(
                first_row(&HOME.replace("测试联系人", name))
                    .unwrap()
                    .0
                    .title,
                name
            );
        }
        let ambiguous = HOME.replace(
            "text=\"上一条消息\" bounds=\"[180,280][800,325]\"",
            "text=\"无法区分的另一个标题\" bounds=\"[180,230][800,270]\"",
        );
        assert!(first_row(&ambiguous).is_err());
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn sends_chinese_once_and_records_observation() {
        let folder = folder();
        let device = fake(vec![CHAT.into(), typed(), sent()], false);
        let chat = Chat {
            title: "测试联系人".into(),
        };
        assert!(send_text(&device, &chat, "你好", &folder, false)
            .unwrap()
            .contains("未验证网络送达"));
        let calls = device.calls.borrow();
        assert_eq!(calls.iter().filter(|c| c.0 == "click").count(), 1);
        assert_eq!(
            calls.iter().find(|c| c.0 == "setText").unwrap().1[1],
            "你好"
        );
        assert!(fs::read_to_string(folder.join("events.jsonl"))
            .unwrap()
            .contains("send_observed"));
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn rehearsal_verifies_and_clears_its_own_draft_without_any_send_click() {
        let root = folder();
        let chat = Chat {
            title: "测试联系人".into(),
        };
        let device = fake(vec![CHAT.into(), typed(), CHAT.into()], false);
        assert!(send_text(&device, &chat, "你好", &root, true)
            .unwrap()
            .contains("未点击发送"));
        let calls = device.calls.borrow();
        assert!(!calls.iter().any(|c| c.0 == "click"));
        assert_eq!(
            calls
                .iter()
                .filter(|c| c.0 == "setText")
                .map(|c| c.1[1].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["你好", ""]
        );
        assert!(!fs::read_to_string(root.join("events.jsonl"))
            .unwrap()
            .contains("send_requested"));
        drop(calls);
        let existing = fake(vec![typed()], false);
        assert!(send_text(&existing, &chat, "你好", &root, true)
            .unwrap()
            .contains("已有相同草稿"));
        assert!(!existing
            .calls
            .borrow()
            .iter()
            .any(|c| c.0 == "click" || c.0 == "setText"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn never_clicks_send_when_the_intent_cannot_be_saved() {
        let root = folder();
        fs::create_dir(root.join("events.jsonl")).unwrap();
        let device = fake(vec![CHAT.into(), typed()], false);
        assert!(send_text(
            &device,
            &Chat {
                title: "测试联系人".into()
            },
            "你好",
            &root,
            false
        )
        .is_err());
        assert!(!device.calls.borrow().iter().any(|c| c.0 == "click"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_drafts_rejects_wrong_chat_and_never_retries_ambiguous_send() {
        let folder = folder();
        let chat = Chat {
            title: "测试联系人".into(),
        };
        for screen in [typed(), CHAT.replace("测试联系人", "其他人")] {
            let device = fake(vec![screen], false);
            assert!(send_text(&device, &chat, "你好", &folder, false).is_err());
            assert!(!device
                .calls
                .borrow()
                .iter()
                .any(|c| c.0 == "setText" || c.0 == "click"));
        }
        let device = fake(vec![CHAT.into(), typed()], true);
        assert!(send_text(&device, &chat, "你好", &folder, false)
            .unwrap_err()
            .contains("勿直接重跑"));
        assert_eq!(
            device
                .calls
                .borrow()
                .iter()
                .filter(|c| c.0 == "click")
                .count(),
            1
        );
        fs::remove_dir_all(folder).unwrap();
    }
}
