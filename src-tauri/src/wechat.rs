use crate::{
    history,
    u2::Automation,
    workflow::{node_bounds, page_document},
};
use roxmltree::{Document, Node};
use serde_json::{json, Value};
use std::{collections::BTreeSet, fs, path::Path};

const PACKAGE: &str = "com.tencent.mm";

#[derive(Clone, Debug)]
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
            (text == "微信" || (text.starts_with("微信(") && text.ends_with(')')))
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
    // Scroll through the server, never guess a fixed screen coordinate.
    device.expect_true(
        "scrollToBeginning",
        json!([list_selector(&xml)?, true, 30, 20]),
    )?;
    device.settle();
    xml = snapshot(device, folder, "chat-list.xml")?;
    if home_tab(&xml)?.is_none() {
        return Err("滚动后不在微信首页，已停止".into());
    }
    let (chat, (x, y)) = first_row(&xml)?;
    history::log(
        folder,
        0,
        "target",
        &format!("本轮首个会话：{}（含置顶，按运行时列表顺序）", chat.title),
    )?;
    device.click(x, y)?;
    device.settle();
    let xml = snapshot(device, folder, "chat-open.xml")?;
    check_title(&document(&xml)?, &chat)?;
    Ok(chat)
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
    if !label(editor(&doc)?).is_empty() {
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
    }
    Err("已点击一次发送，但未能确认新消息；请人工核对会话，勿直接重跑以免重复发送".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;

    const HOME: &str = include_str!("../tests/fixtures/wechat-home.xml");
    const CHAT: &str = include_str!("../tests/fixtures/wechat-chat.xml");
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
        assert!(send_text(&device, &chat, "你好", &folder)
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
    fn preserves_drafts_rejects_wrong_chat_and_never_retries_ambiguous_send() {
        let folder = folder();
        let chat = Chat {
            title: "测试联系人".into(),
        };
        for screen in [typed(), CHAT.replace("测试联系人", "其他人")] {
            let device = fake(vec![screen], false);
            assert!(send_text(&device, &chat, "你好", &folder).is_err());
            assert!(!device
                .calls
                .borrow()
                .iter()
                .any(|c| c.0 == "setText" || c.0 == "click"));
        }
        let device = fake(vec![CHAT.into(), typed()], true);
        assert!(send_text(&device, &chat, "你好", &folder)
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
