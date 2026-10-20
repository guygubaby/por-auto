use crate::{
    android, history,
    provider::VisionClient,
    send_input::{Scope, SendInput},
    wechat::{self, Chat, TargetList},
    workflow::{Action, Selector, Workflow},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    cell::Cell,
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    thread,
    time::{Duration, Instant},
};

const PACKAGE: &str = "com.tencent.mm";
const PROTOCOL: &str = r#"Observe this WeChat screenshot. Return JSON with exactly these fields:
{"page":"home|me|profile|chat|search|new_chat|groups|other","title":"exact full current page/chat title or empty","certain":true,"items":[{"role":"tab|search|search_input|chat|group|more|new_chat|choose_group|profile|row|keyboard|send|back","text":"exact visible label","value":null,"point":[500,500],"complete":true}],"editor":null,"outgoing":[],"listEmpty":false}
editor, if a text-message input is visible, is {"point":[500,900],"text":"exact full draft or empty string"}; use text:null if not fully readable. Voice-record button is NOT an editor. 'keyboard' means switch from voice to text mode, not a keyboard key.
For search_input, value is the exact existing search query (empty string for an empty field, null if unreadable).
outgoing contains visible RIGHT-ALIGNED sent message bubbles in screen order: {"text":"exact full text","pending":false,"failed":false}; never include incoming messages or the draft. pending/failed mean visible clock/spinner/red error.
Use role send only for a visible button explicitly labeled 发送, with text 发送. The bottom-right circled + is role more, never send. The left speaker icon is keyboard only when it switches from voice recording to text; when a text editor is visible, do not mark the speaker as keyboard.
If no 发送 button is visible, omit send from items. Do not invent a location for an absent control.
page home is specifically the first WeChat tab's conversation list, with all four bottom tabs. page groups is specifically the existing-group picker (选择一个群 / 选择群聊), not contacts nor a chat. page new_chat is the contact selection screen containing 选择一个群 or 选择一个已有的群 (role choose_group). page search is global search (not search within a conversation).
The global search page may initially be empty, showing only a back arrow and the field 搜索本地或网络结果. This is page search, not other; include that field as search_input with value "". Search results below it are chat/group rows with complete full names.
For the pulled-down miniapp drawer showing 最近 and 搜索小程序, return page other, title 最近, and a row item text 搜索小程序. Do not treat this as global search.
On home include the top-bar magnifying-glass icon as search and the + icon as more whenever visible, even with empty text. Do not omit these controls while listing conversations.
When the plus-button popup menu is open, return page other, title 微信菜单, certain true if readable, and its visible entries (发起群聊 is role new_chat); do not include underlying home controls blocked by the popup.
If WeChat shows 安全保护中 with 验证解除, report page other and title 安全保护中. Never treat verification or account recovery as navigation controls.
For home/search/groups list: include every visible conversation row as chat/group in top-to-bottom order; text is only the full chat name, NOT time, unread count or preview. Do NOT include service/system entries (公众号, 订阅号消息, 服务通知, 微信团队, 微信运动, 支付服务, 微信支付, 折叠置顶聊天). Mark a partially visible or ellipsized name complete:false; do not expand it from memory. For chat titles keep the member count as visible. Never take a message bubble as a title.
On the groups picker omit the separately styled grey member count (e.g. (497)); it is metadata, not part of the group name. Keep that count in chat-page titles only.
On profile page include rows with role row, text the field label (昵称/名字 etc.), value the full field value. On me page the profile entry containing 微信号： must be role profile and text include that visible line. Include top-right plus as role more, 发起群聊 menu entry as new_chat, 选择一个群 as choose_group. For tabs strip unread badge counts from tab text. Mark certain:false if blocked by a dialog, blurry, black or uncertain. A heads-up notification covering the title or navigation makes the page uncertain; never use its sender or group name as the underlying chat title. A chat requires a completely visible, nonempty top-bar title. All points are centers normalized to 0..1000 in the full screenshot. Don't infer hidden controls. No actions, recommendations, Markdown, or additional fields."#;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Point([u16; 2]);
impl Point {
    fn pixels(&self, width: u32, height: u32) -> Result<(u32, u32), String> {
        if self.0.iter().any(|v| !(1..1000).contains(v))
            || !(100..=10000).contains(&width)
            || !(100..=10000).contains(&height)
        {
            return Err("视觉坐标超出截图边界，未点击".into());
        }
        Ok((
            u32::from(self.0[0]) * width / 1000,
            u32::from(self.0[1]) * height / 1000,
        ))
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Item {
    role: String,
    text: String,
    value: Option<String>,
    point: Point,
    complete: bool,
}
impl Item {
    fn matches_text(&self, selector: &Selector) -> bool {
        selector.text.contains(&self.text)
            || selector.prefix.iter().any(|prefix| {
                self.text.starts_with(prefix)
                    || (self.role == "profile"
                        && self
                            .text
                            .split_whitespace()
                            .any(|part| part.starts_with(prefix)))
            })
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Editor {
    point: Point,
    text: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Bubble {
    text: String,
    pending: bool,
    failed: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Screen {
    page: String,
    title: String,
    certain: bool,
    items: Vec<Item>,
    editor: Option<Editor>,
    outgoing: Vec<Bubble>,
    list_empty: bool,
}
fn parse_screen(mut value: serde_json::Value) -> Result<Screen, String> {
    if let Some(items) = value
        .get_mut("items")
        .and_then(serde_json::Value::as_array_mut)
    {
        // A null send location denotes an absent optional button; required controls remain strict.
        items.retain(|item| {
            !(item["role"] == "send" && item.get("point") == Some(&serde_json::Value::Null))
        });
    }
    serde_json::from_value(value)
        .map_err(|_| "模型输出不符合页面协议，已停止；页面与响应已保存在本机日志".into())
}
impl Screen {
    fn validate(&self) -> Result<(), String> {
        if !self.certain
            || ![
                "home", "me", "profile", "chat", "search", "new_chat", "groups", "other",
            ]
            .contains(&self.page.as_str())
            || self.items.len() > 100
            || self.outgoing.len() > 100
            || self.title.len() > 500
            || (self.page == "chat" && self.title.trim().is_empty())
            || self.items.iter().any(|i| {
                i.text.len() > 1000
                    || i.value.as_ref().is_some_and(|v| v.len() > 4000)
                    || ![
                        "tab",
                        "search",
                        "search_input",
                        "chat",
                        "group",
                        "more",
                        "new_chat",
                        "choose_group",
                        "profile",
                        "row",
                        "keyboard",
                        "send",
                        "back",
                    ]
                    .contains(&i.role.as_str())
                    || i.point.pixels(1000, 1000).is_err()
            })
            || self.editor.as_ref().is_some_and(|e| {
                e.point.pixels(1000, 1000).is_err()
                    || e.text.as_ref().is_some_and(|v| v.len() > 4000)
            })
            || self.outgoing.iter().any(|b| b.text.len() > 4000)
        {
            return Err("视觉页面无法可靠识别，已停止，未猜测点击位置".into());
        }
        Ok(())
    }
    fn unique(&self, role: &str) -> Result<&Item, String> {
        let mut matches = self.items.iter().filter(|i| {
            i.complete
                && (i.role == role
                    || (role == "choose_group"
                        && self.page == "new_chat"
                        && ["选择一个群", "选择群聊", "选择一个已有的群"]
                            .contains(&i.text.as_str()))
                    || (role == "new_chat" && self.page == "other" && i.text == "发起群聊"))
        });
        let first = matches
            .next()
            .ok_or_else(|| format!("视觉页面没有可确认的 {role} 入口"))?;
        if matches.next().is_some() {
            return Err(format!("视觉页面有多个 {role} 入口，未点击"));
        }
        Ok(first)
    }
    fn names(&self, page: &str) -> Result<Vec<String>, String> {
        if self.page != page {
            return Err("页面已离开会话列表，未继续枚举或发送".into());
        }
        let mut rows: Vec<_> = self
            .items
            .iter()
            .filter(|i| ["chat", "group"].contains(&i.role.as_str()))
            .collect();
        rows.sort_by_key(|i| (i.point.0[1], i.point.0[0]));
        if rows.is_empty() && !self.list_empty {
            return Err("无法确认列表内容，未开始发送".into());
        }
        if rows.iter().any(|i| {
            !i.complete
                || i.text.trim().is_empty()
                || i.text.contains('…')
                || i.text.ends_with("...")
        }) {
            return Err(
                "会话名称被截断或只显示部分内容，未开始发送；可先手动填写完整名称并选择指定会话"
                    .into(),
            );
        }
        let names: Vec<_> = rows.iter().map(|i| i.text.clone()).collect();
        if name_set(&names).len() != names.len() {
            return Err("视觉列表存在无法区分的重名会话，未开始处理".into());
        }
        Ok(names)
    }
    fn check_chat(&self, title: &str) -> Result<(), String> {
        if self.page != "chat" || !same_title(&self.title, title) {
            return Err(format!("当前页面不能确认为目标会话「{title}」"));
        }
        Ok(())
    }
    fn protected(&self) -> bool {
        self.page == "other" && self.title == "安全保护中"
    }
}
fn same_title(actual: &str, expected: &str) -> bool {
    name_key(actual) == name_key(expected) || group_title(actual, expected)
}
fn group_title(actual: &str, expected: &str) -> bool {
    // A searched contact with the same name must not stand in for a group.
    name_key(actual)
        .strip_prefix(&format!("{}(", name_key(expected)))
        .and_then(|s| s.strip_suffix(')'))
        .is_some_and(|count| !count.is_empty() && count.bytes().all(|b| b.is_ascii_digit()))
}

fn name_key(name: &str) -> String {
    name.chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            '（' => '(',
            '）' => ')',
            '｜' | '丨' => '|',
            other => other,
        })
        .collect()
}
fn name_set(names: &[String]) -> BTreeSet<String> {
    names.iter().map(|n| name_key(n)).collect()
}
fn merge_names(names: &mut Vec<String>, page: &[String]) -> Result<(), String> {
    let keys: Vec<_> = names.iter().map(|n| name_key(n)).collect();
    let page_keys: Vec<_> = page.iter().map(|n| name_key(n)).collect();
    if page_keys.iter().collect::<BTreeSet<_>>().len() != page.len() {
        return Err("视觉列表存在重名会话，已停止".into());
    }
    let overlap = (0..=keys.len().min(page_keys.len()))
        .rev()
        .find(|n| keys[keys.len() - n..] == page_keys[..*n])
        .unwrap_or(0);
    for (name, key) in page.iter().zip(&page_keys).skip(overlap) {
        if keys.contains(key) {
            return Err("会话列表在读取中发生变化，请重新读取或勾选指定会话".into());
        }
        names.push(name.clone());
    }
    Ok(())
}

pub struct Session<'a> {
    client: VisionClient,
    adb: &'a Path,
    serial: &'a str,
    folder: &'a Path,
    check: &'a mut dyn FnMut(&str) -> Result<(), String>,
    width: u32,
    height: u32,
    observations: usize,
    dry_run: bool,
}
impl<'a> Session<'a> {
    pub fn start(
        root: &Path,
        adb: &'a Path,
        serial: &'a str,
        folder: &'a Path,
        dry_run: bool,
        check: &'a mut dyn FnMut(&str) -> Result<(), String>,
    ) -> Result<Self, String> {
        let client = VisionClient::for_phone(root)?;
        let mut description = client.description();
        description["dryRun"] = json!(dry_run);
        fs::write(
            folder.join("execution.json"),
            serde_json::to_vec_pretty(&description).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        history::log(
            folder,
            0,
            "started",
            "使用视觉 AI 模式；截图提交到用户配置的模型接口",
        )?;
        Ok(Self {
            client,
            adb,
            serial,
            folder,
            check,
            width: 0,
            height: 0,
            observations: 0,
            dry_run,
        })
    }
    fn shell(&mut self, args: &[&str]) -> Result<String, String> {
        (self.check)("执行手机操作（视觉模式）")?;
        let mut command = vec!["-s", self.serial, "shell"];
        command.extend_from_slice(args);
        android::text(self.adb, &command)
    }
    fn foreground(&self) -> Result<(), String> {
        let windows = android::text(
            self.adb,
            &["-s", self.serial, "shell", "dumpsys", "window", "windows"],
        )?;
        if android::focused_package(&windows) != Some(PACKAGE) {
            return Err("微信未处于前台，未向模型发送其他应用的截图".into());
        }
        Ok(())
    }
    fn observe(&mut self) -> Result<Screen, String> {
        self.observe_for("")
    }
    fn observe_for(&mut self, hint: &str) -> Result<Screen, String> {
        self.observe_attempt(0, hint)
    }
    fn observe_attempt(&mut self, attempt: u8, hint: &str) -> Result<Screen, String> {
        (self.check)("正在读取手机页面（视觉模式）")?;
        if self.observations >= 20000 {
            return Err("本轮视觉读取达到上限，已停止".into());
        }
        self.foreground()?;
        let bytes = android::run(
            self.adb,
            &["-s", self.serial, "exec-out", "screencap", "-p"],
        )?;
        self.foreground()?;
        if bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("无法获得可用手机截图".into());
        }
        self.width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        self.height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        fs::write(self.folder.join("visual-last.png"), &bytes).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(self.folder.join("visual-last.json"));
        if self.observations == 0 {
            fs::write(self.folder.join("visual-first.png"), &bytes).map_err(|e| e.to_string())?;
        }
        self.observations += 1;
        let instruction = format!(
            "{PROTOCOL}\nSource image dimensions: {} × {} pixels. Output coordinates are NOT image pixels: x = pixel_x / {} * 1000, y = pixel_y / {} * 1000. Every coordinate must be an integer from 1 to 999. Bottom of image is y=999, never 1280 or the image height. Check every point before returning JSON.\nCurrent inspection goal (observation only): {hint}",
            self.width, self.height, self.width, self.height
        );
        let observation: serde_json::Value = match self.client.observe(&bytes, &instruction) {
            Ok(value) => value,
            Err(error) if error.invalid_output && attempt < 2 => {
                history::log(self.folder, 0, "observation_rejected", &error.message)?;
                thread::sleep(Duration::from_millis(800));
                return self.observe_attempt(attempt + 1, hint);
            }
            Err(error) => return Err(error.message),
        };
        fs::write(
            self.folder.join("visual-last.json"),
            serde_json::to_vec_pretty(&observation).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let parsed = parse_screen(observation).and_then(|screen| {
            screen.validate()?;
            Ok(screen)
        });
        if let Err(error) = &parsed {
            fs::copy(
                self.folder.join("visual-last.json"),
                self.folder.join("visual-rejected.json"),
            )
            .map_err(|e| e.to_string())?;
            fs::copy(
                self.folder.join("visual-last.png"),
                self.folder.join("visual-rejected.png"),
            )
            .map_err(|e| e.to_string())?;
            history::log(self.folder, 0, "observation_rejected", error)?;
            if attempt < 2 {
                thread::sleep(Duration::from_millis(800));
                return self.observe_attempt(attempt + 1, hint);
            }
        }
        let screen = parsed?;
        if screen.protected() {
            fs::write(
                self.folder.join("visual-last.json"),
                serde_json::to_vec_pretty(&screen).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            history::log(self.folder, 0, "blocked", wechat::VERIFICATION_REQUIRED)?;
            return Err(wechat::VERIFICATION_REQUIRED.into());
        }
        (self.check)("视觉页面已返回，核对当前目标")?;
        fs::write(
            self.folder.join("visual-last.json"),
            serde_json::to_vec_pretty(&screen).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        history::log(
            self.folder,
            0,
            "observed",
            &format!("视觉观察 #{}：{}", self.observations, screen.page),
        )?;
        Ok(screen)
    }
    fn click(&mut self, point: &Point) -> Result<(), String> {
        self.foreground()?;
        let (x, y) = point.pixels(self.width, self.height)?;
        fs::copy(
            self.folder.join("visual-last.json"),
            self.folder.join("visual-before-action.json"),
        )
        .map_err(|e| e.to_string())?;
        fs::copy(
            self.folder.join("visual-last.png"),
            self.folder.join("visual-before-action.png"),
        )
        .map_err(|e| e.to_string())?;
        self.shell(&["input", "tap", &x.to_string(), &y.to_string()])?;
        thread::sleep(Duration::from_millis(1000));
        Ok(())
    }
    fn click_row(&mut self, title: &str, page: &str, approximate: &Point) -> Result<(), String> {
        (self.check)("正在核对会话所在行")?;
        self.foreground()?;
        let bytes = android::run(
            self.adb,
            &["-s", self.serial, "exec-out", "screencap", "-p"],
        )?;
        self.foreground()?;
        let frame = crate::markers::Frame::new(&bytes)?;
        self.width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        self.height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        if frame.points.is_empty() {
            return Err("当前会话列表没有可确认的头像位置，未使用估算坐标".into());
        }
        fs::write(self.folder.join("visual-grounding-source.png"), &bytes)
            .map_err(|e| e.to_string())?;
        fs::write(
            self.folder.join("visual-markers.json"),
            serde_json::to_vec_pretty(&frame.points).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let mut attempts = Vec::new();
        let mut confirmed = None;
        for candidate in frame.candidates(approximate.0)? {
            fs::write(
                self.folder.join("visual-grounding-candidate.png"),
                &candidate.png,
            )
            .map_err(|e| e.to_string())?;
            let selection: crate::markers::Selection = self.client.observe(
                &candidate.png,
                &crate::markers::instruction(title, page, candidate.id),
            )?;
            attempts.push(json!({"candidate":candidate.id,"crop":[0,candidate.top,self.width,candidate.bottom],"selection":selection}));
            fs::write(
                self.folder.join("visual-grounding.json"),
                serde_json::to_vec_pretty(&json!({"target":title,"page":page,"attempts":attempts}))
                    .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            if !selection.found {
                continue;
            }
            if name_key(&selection.text) != name_key(title)
                || selection.marker != Some(candidate.id)
            {
                return Err("候选行与模型返回内容不一致，未点击".into());
            }
            confirmed = Some(frame.selected(&selection)?);
            break;
        }
        let point =
            confirmed.ok_or_else(|| format!("没有确认「{title}」所在的完整会话行，未点击"))?;
        self.ensure_unchanged(&bytes, &Point(point), false)?;
        fs::write(
            self.folder.join("visual-grounding.json"),
            serde_json::to_vec_pretty(
                &json!({"attempts":attempts,"point":point,"page":page,"target":title}),
            )
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        self.click(&Point(point))
    }
    fn ensure_unchanged(
        &mut self,
        before: &[u8],
        point: &Point,
        editor: bool,
    ) -> Result<(), String> {
        self.foreground()?;
        let fresh = android::run(
            self.adb,
            &["-s", self.serial, "exec-out", "screencap", "-p"],
        )?;
        self.foreground()?;
        if !crate::markers::unchanged(before, &fresh, point.0, editor)? {
            fs::write(self.folder.join("visual-changed.png"), fresh).map_err(|e| e.to_string())?;
            history::log(
                self.folder,
                0,
                "screen_changed",
                "目标区域在识别后发生变化，未点击或清理草稿",
            )?;
            return Err("页面在识别后发生变化，未点击或清理草稿；请核对手机后重新运行".into());
        }
        Ok(())
    }
    fn back(&mut self) -> Result<(), String> {
        self.shell(&["input", "keyevent", "KEYCODE_BACK"])?;
        thread::sleep(Duration::from_millis(650));
        Ok(())
    }
    fn scroll(&mut self, up: bool) -> Result<(), String> {
        self.foreground()?;
        let (x, y1) = Point([500, if up { 350 } else { 730 }]).pixels(self.width, self.height)?;
        let (_, y2) = Point([500, if up { 730 } else { 350 }]).pixels(self.width, self.height)?;
        self.shell(&[
            "input",
            "swipe",
            &x.to_string(),
            &y1.to_string(),
            &x.to_string(),
            &y2.to_string(),
            "650",
        ])?;
        thread::sleep(Duration::from_millis(900));
        Ok(())
    }
    fn home(&mut self) -> Result<Screen, String> {
        for _ in 0..8 {
            let screen = self.observe()?;
            let tabs: Vec<_> = screen.items.iter().filter(|i| i.role == "tab").collect();
            if ["微信", "通讯录", "发现", "我"]
                .iter()
                .all(|label| tabs.iter().any(|i| i.text == *label))
            {
                if screen.page == "home" {
                    return Ok(screen);
                }
                let tab = tabs.iter().find(|i| i.text == "微信").unwrap();
                self.click(&tab.point)?;
            } else {
                self.back()?;
            }
        }
        Err("未能恢复微信的第一个页面，已停止".into())
    }
    fn beginning(&mut self, mut screen: Screen) -> Result<Screen, String> {
        let page = screen.page.clone();
        let mut previous = screen.names(&page)?;
        for _ in 0..300 {
            self.scroll(true)?;
            screen = self.observe()?;
            if page == "home" && miniapp_drawer(&screen) {
                // Pulling past the first row opens WeChat's miniapp drawer; dismiss without touching an app.
                self.back()?;
                screen = self.observe()?;
                screen.names(&page)?;
                return Ok(screen);
            }
            let names = screen.names(&page)?;
            if name_set(&names) == name_set(&previous) {
                return Ok(screen);
            }
            previous = names;
        }
        Err("未能确认列表开头，已停止".into())
    }
    fn open_first(&mut self) -> Result<Chat, String> {
        let screen = self.home()?;
        let screen = self.beginning(screen)?;
        let first = screen
            .items
            .iter()
            .filter(|i| ["chat", "group"].contains(&i.role.as_str()))
            .min_by_key(|i| (i.point.0[1], i.point.0[0]))
            .ok_or("微信会话列表为空")?;
        if !first.complete || first.text.is_empty() {
            return Err("第一个会话名称无法完整识别，未点击".into());
        }
        let title = first.text.clone();
        self.click_row(&title, "home", &first.point)?;
        self.confirm_chat(&title)?;
        Ok(Chat { title })
    }
    fn open_named(&mut self, title: &str) -> Result<Chat, String> {
        if self.named_page(title)?.is_none() {
            return Err(format!("未能唯一匹配完整会话「{title}」，未打开"));
        }
        Ok(Chat {
            title: title.into(),
        })
    }
    fn named_page(&mut self, title: &str) -> Result<Option<Screen>, String> {
        let mut home = self.home()?;
        let visible: Vec<_> = home
            .items
            .iter()
            .filter(|i| {
                ["chat", "group"].contains(&i.role.as_str())
                    && i.complete
                    && name_key(&i.text) == name_key(title)
            })
            .collect();
        if visible.len() > 1 {
            return Ok(None);
        }
        if visible.len() == 1 {
            self.click_row(title, "home", &visible[0].point)?;
        } else {
            if home.unique("search").is_err() {
                home = self.observe_for("Locate the top-right magnifying-glass search icon on the home screen. Include it as role search. Do not confuse it with the adjacent plus icon.")?;
                if home.page != "home" {
                    return Err("页面已离开微信首页，未打开搜索".into());
                }
            }
            self.click(&home.unique("search")?.point)?;
            let search = self.observe()?;
            if search.page != "search" {
                return Err("没有进入微信全局搜索，已停止".into());
            }
            let field = search.unique("search_input")?;
            if field.value.as_deref() != Some("") {
                return Err("搜索框中有已有内容或无法完整读取，请先清空搜索后重试".into());
            }
            self.focus_input(None, search)?;
            self.type_text(title, None)?;
            thread::sleep(Duration::from_millis(1000));
            let results = self.observe_for(&format!(
                "Locate the exact local conversation/function result named {} below the search field. Ignore online search suggestions. Report the clickable result row as chat/group and its actual center, not the query field or the area below the row. Coordinates use the entire screenshot.",
                quote(title)
            ))?;
            if results.page != "search" {
                return Err("搜索页面已改变，未进入任何会话".into());
            }
            let exact: Vec<_> = results
                .items
                .iter()
                .filter(|i| {
                    ["chat", "group"].contains(&i.role.as_str())
                        && i.complete
                        && name_key(&i.text) == name_key(title)
                })
                .collect();
            if exact.len() != 1 {
                return Ok(None);
            }
            self.click_row(title, "search", &exact[0].point)?;
        }
        Ok(Some(self.confirm_chat(title)?))
    }
    fn confirm_chat(&mut self, title: &str) -> Result<Screen, String> {
        for attempt in 0..4 {
            if attempt > 0 {
                thread::sleep(Duration::from_millis(800));
            }
            let screen = self.observe_for(&format!(
                "Verify whether navigation has reached the chat named {}. Read the exact top-bar title. A search result or a search query with this name is not an open chat.",
                quote(title)
            ))?;
            if screen.page == "chat" {
                screen.check_chat(title)?;
                return Ok(screen);
            }
            if !["home", "search", "groups"].contains(&screen.page.as_str()) {
                break;
            }
        }
        Err(format!("会话「{title}」未能完成页面切换，未继续输入或发送"))
    }
    fn recipient_page(&mut self, scope: Scope) -> Result<Screen, String> {
        let mut screen = self.home()?;
        if scope == Scope::Groups {
            self.click(&screen.unique("more")?.point)?;
            screen = self.observe()?;
            self.click(&screen.unique("new_chat")?.point)?;
            screen = self.observe()?;
            if screen.page != "new_chat" {
                return Err("未打开群聊选择入口，未发送".into());
            }
            self.click(&screen.unique("choose_group")?.point)?;
            screen = self.observe()?;
            if screen.page != "groups" {
                return Err("无法确认现有群聊列表，未发送".into());
            }
        }
        Ok(screen)
    }
    fn open_group(&mut self, title: &str) -> Result<Chat, String> {
        if self
            .named_page(title)?
            .is_some_and(|screen| group_title(&screen.title, title))
        {
            return Ok(Chat {
                title: title.into(),
            });
        }
        let mut screen = self.recipient_page(Scope::Groups)?;
        for page in 0..300 {
            let matches: Vec<_> = screen
                .items
                .iter()
                .filter(|i| i.role == "group" && i.complete && name_key(&i.text) == name_key(title))
                .collect();
            if matches.len() > 1 {
                return Err("群列表存在重名，已停止".into());
            }
            if !matches.is_empty() {
                self.click_row(title, "groups", &matches[0].point)?;
                self.confirm_chat(title)?;
                return Ok(Chat {
                    title: title.into(),
                });
            }
            if page == 0 {
                screen = self.beginning(screen)?;
            } else {
                self.scroll(false)?;
                screen = self.observe()?;
            }
            if screen.page != "groups" {
                return Err("已离开现有群聊列表，已停止".into());
            }
        }
        Err(format!("没有在现有群聊列表找到「{title}」"))
    }
    pub fn discover(&mut self, scope: Scope) -> Result<TargetList, String> {
        let mut screen = self.recipient_page(scope)?;
        let source = if scope == Scope::Groups {
            "视觉读取微信现有群聊列表（本次可枚举的群聊）"
        } else {
            "视觉读取微信首页会话列表（不含系统入口）"
        };
        screen = self.beginning(screen)?;
        let page = screen.page.clone();
        let mut names = Vec::new();
        for number in 0..300 {
            (self.check)(&format!(
                "视觉读取会话第 {} 屏，已发现 {} 个",
                number + 1,
                names.len()
            ))?;
            let current = screen.names(&page)?;
            merge_names(&mut names, &current)?;
            if names.len() > 2000 {
                return Err("本轮超过 2000 个会话，请分批选择".into());
            }
            self.scroll(false)?;
            let next = self.observe()?;
            if name_set(&next.names(&page)?) == name_set(&current) {
                // A second independent swipe distinguishes a settled boundary from one missed gesture.
                self.scroll(false)?;
                screen = self.observe()?;
                if name_set(&screen.names(&page)?) == name_set(&current) {
                    return Ok(TargetList {
                        items: names.into_iter().map(|title| Chat { title }).collect(),
                        source: source.into(),
                        scanned_at: history::now(),
                        complete: true,
                    });
                }
            } else {
                screen = next;
            }
        }
        Err("未能确认会话列表末尾，未开始发送".into())
    }
    fn type_text(&mut self, text: &str, chat: Option<&Chat>) -> Result<(), String> {
        if !text.is_empty() && text.bytes().all(|b| b.is_ascii_alphanumeric()) {
            self.shell(&["input", "text", text])?;
            return Ok(());
        }
        clipboard_input(self.adb, self.serial, text, |stage| {
            (self.check)("准备文字输入")?;
            if matches!(stage, ClipboardStage::BeforePaste) {
                let screen = self.observe_for("Locate the active text input: the global search field on page search, or the message editor on page chat. Report its exact current value and center in normalized coordinates.")?;
                self.focus_input(chat, screen)?;
            }
            Ok(())
        })
    }
    fn focus_input(&mut self, chat: Option<&Chat>, mut screen: Screen) -> Result<(), String> {
        for attempt in 0..3 {
            let point = if let Some(chat) = chat {
                screen.check_chat(&chat.title)?;
                let editor = screen.editor.as_ref().ok_or("无法确认文字输入框，未输入")?;
                if editor.text.as_deref() != Some("") {
                    return Err("输入框有草稿或无法完整读取，未覆盖草稿".into());
                }
                editor.point.clone()
            } else {
                if screen.page != "search" {
                    return Err("页面已离开全局搜索，未输入".into());
                }
                let field = screen.unique("search_input")?;
                if field.value.as_deref() != Some("") {
                    return Err("搜索框已有内容或无法完整读取，未输入".into());
                }
                field.point.clone()
            };
            self.click(&point)?;
            let state = self.shell(&["dumpsys", "input_method"])?;
            if android::text_input_active(&state, PACKAGE) {
                return Ok(());
            }
            if attempt < 2 {
                screen = self.observe_for("Locate the actual text input: top search field on page search; bottom message editor on page chat. Report its center precisely in normalized coordinates and the exact existing text. Do not report a message bubble or voice-record button as an editable field.")?;
            }
        }
        Err("未能确认微信文字输入焦点，未输入或点击发送".into())
    }
    fn send(&mut self, chat: &Chat, text: &str, folder: &Path) -> Result<String, String> {
        crate::send_input::validate_message(text)?;
        let mut screen = self.observe()?;
        screen.check_chat(&chat.title)?;
        if screen.editor.is_none() {
            self.click(&screen.unique("keyboard")?.point)?;
            screen = self.observe()?;
            screen.check_chat(&chat.title)?;
        }
        let editor = screen.editor.as_ref().ok_or("无法确认文字输入框，未输入")?;
        if self.dry_run && editor.text.as_deref() == Some(text) {
            history::log(
                folder,
                0,
                "draft_verified",
                "演练通过：已有相同草稿，保留原草稿；未点击发送",
            )?;
            return Ok("演练通过：已有相同草稿，未改动草稿或点击发送".into());
        }
        if editor.text.as_deref() != Some("") {
            return Err("会话有草稿或输入框无法完整读取，未覆盖草稿".into());
        }
        self.focus_input(Some(chat), screen)?;
        self.type_text(text, Some(chat))?;
        thread::sleep(Duration::from_millis(500));
        let before = self.observe()?;
        before.check_chat(&chat.title)?;
        if before.editor.as_ref().and_then(|e| e.text.as_deref()) != Some(text) {
            return Err("输入内容未能精确核对，未点击发送；请检查手机草稿".into());
        }
        fs::write(
            folder.join("visual-before-send.json"),
            serde_json::to_vec_pretty(&before).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::copy(
            self.folder.join("visual-last.png"),
            folder.join("visual-before-send.png"),
        )
        .map_err(|e| e.to_string())?;
        if self.dry_run {
            history::log(
                folder,
                0,
                "draft_verified",
                "演练通过：输入内容已核对，未点击发送",
            )?;
            self.ensure_unchanged(
                &fs::read(self.folder.join("visual-last.png")).map_err(|e| e.to_string())?,
                &before.editor.as_ref().unwrap().point,
                true,
            )?;
            let mut keys = vec!["input", "keyevent", "KEYCODE_MOVE_END"];
            keys.extend(std::iter::repeat_n(
                "KEYCODE_DEL",
                text.encode_utf16().count(),
            ));
            self.shell(&keys)?;
            thread::sleep(Duration::from_millis(500));
            let cleared = self.observe()?;
            cleared.check_chat(&chat.title)?;
            fs::write(
                folder.join("visual-after-draft.json"),
                serde_json::to_vec_pretty(&cleared).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            if cleared.editor.as_ref().and_then(|e| e.text.as_deref()) != Some("") {
                return Err("演练草稿清理未能确认，未点击发送；请检查手机草稿".into());
            }
            return Ok("演练通过：草稿已核对并清理，未点击发送".into());
        }
        let send = before.unique("send")?;
        let editor = before.editor.as_ref().unwrap();
        if send.text != "发送"
            || send.point.0[1].abs_diff(editor.point.0[1]) > 120
            || send.point.0[0] <= editor.point.0[0]
        {
            return Err("发送按钮与输入框位置不符，未点击".into());
        }
        (self.check)("核对完成，即将点击一次发送")?;
        self.ensure_unchanged(
            &fs::read(self.folder.join("visual-last.png")).map_err(|e| e.to_string())?,
            &editor.point,
            true,
        )?;
        history::log(
            folder,
            0,
            "send_requested",
            &format!("视觉模式：即将向「{}」发送：{text}", chat.title),
        )?;
        self.click(&send.point)
            .map_err(|e| format!("发送结果不明：{e}；未自动重试"))?;
        let verified: Result<String, String> = (|| {
            for _ in 0..3 {
                thread::sleep(Duration::from_millis(900));
                let after = self.observe()?;
                after.check_chat(&chat.title)?;
                fs::write(
                    folder.join("visual-after-send.json"),
                    serde_json::to_vec_pretty(&after).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                fs::copy(
                    self.folder.join("visual-last.png"),
                    folder.join("visual-after-send.png"),
                )
                .map_err(|e| e.to_string())?;
                if observed_send(&before, &after, text) {
                    history::log(
                        folder,
                        0,
                        "send_observed",
                        "输入框已清空，看到新增右侧消息且无可见发送错误；未验证网络送达",
                    )?;
                    return Ok(
                        "视觉模式：已点击一次发送并看到新增右侧消息（未验证网络送达）".into(),
                    );
                }
            }
            Err("视觉证据不足以确认新增消息".into())
        })();
        verified.map_err(|e| {
            format!("已点击一次发送，后续核对未完成：{e}；发送结果待核对，不会自动重发")
        })
    }
    fn tap_selector(
        &mut self,
        selector: &Selector,
        skip: &[Selector],
        recover: u8,
    ) -> Result<(), String> {
        for attempt in 0..=recover {
            let screen = self.observe_for("Inspect navigation controls. On the Me page, the profile entry must include the visible 微信号： field starting on its own line, separate from the nickname. On the profile page include the exact page title and each visible field label/value.")?;
            let matches = |s: &Selector, i: &Item| {
                i.complete
                    && i.matches_text(s)
                    && (!s.bottom || (i.role == "tab" && i.point.0[1] > 750))
                    && s.peers
                        .iter()
                        .all(|p| screen.items.iter().any(|i| i.text == *p))
            };
            if skip.iter().any(|s| {
                screen.items.iter().any(|i| matches(s, i)) || s.text.contains(&screen.title)
            }) {
                return Ok(());
            }
            let items: Vec<_> = screen
                .items
                .iter()
                .filter(|i| {
                    matches(selector, i)
                        && !["send", "chat", "group", "new_chat"].contains(&i.role.as_str())
                })
                .collect();
            if items.len() == 1 {
                return self.click(&items[0].point);
            }
            if items.len() > 1 {
                return Err("视觉选择器匹配多个控件，未点击".into());
            }
            if attempt < recover {
                self.back()?;
            }
        }
        Err("未能根据工作流选择器确认目标控件".into())
    }
}

fn observed_send(before: &Screen, after: &Screen, text: &str) -> bool {
    let count = |s: &Screen| s.outgoing.iter().filter(|b| b.text == text).count();
    after.editor.as_ref().and_then(|e| e.text.as_deref()) == Some("")
        && after
            .outgoing
            .last()
            .is_some_and(|b| b.text == text && !b.failed && !b.pending)
        && count(after) > count(before)
}

fn miniapp_drawer(screen: &Screen) -> bool {
    screen.page == "other"
        && screen.title == "最近"
        && screen
            .items
            .iter()
            .any(|i| i.complete && i.text == "搜索小程序")
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}
enum ClipboardStage {
    Poll,
    BeforePaste,
}
fn clipboard_input(
    adb: &Path,
    serial: &str,
    text: &str,
    mut check: impl FnMut(ClipboardStage) -> Result<(), String>,
) -> Result<(), String> {
    check(ClipboardStage::Poll)?;
    let installed = android::text(
        adb,
        &["-s", serial, "shell", "pm", "path", "org.autojs.autojs6"],
    )?;
    if !installed.starts_with("package:") {
        return Err("视觉模式的中文输入需要先安装 AutoJs6（无需开启无障碍），未输入或发送".into());
    }
    let marker = format!(
        "/sdcard/Android/data/org.autojs.autojs6/files/.por-input-{}",
        uuid::Uuid::new_v4()
    );
    let value = STANDARD.encode(text);
    activate_autojs(adb, serial)?;
    // Keep the original ClipData only in phone memory; restore it without reading it into desktop logs.
    let script = format!(
        r#"context.getExternalFilesDir(null);var p={marker:?},v=String(new java.lang.String(android.util.Base64.decode({value:?},0),'UTF-8')),c=context.getSystemService(android.content.Context.CLIPBOARD_SERVICE),old=null,changed=false,status='restored';
try {{old=c.getPrimaryClip();var clip=android.content.ClipData.newPlainText('Por Auto',v);if(android.os.Build.VERSION.SDK_INT>=24){{var extras=new android.os.PersistableBundle();extras.putBoolean('android.content.extra.IS_SENSITIVE',true);clip.getDescription().setExtras(extras);}}c.setPrimaryClip(clip);changed=true;files.write(p+'.ready','ready');var end=Date.now()+180000;while(Date.now()<end&&!files.exists(p+'.done'))sleep(100);}}
catch(e){{files.write(p+'.ready','error');}}
finally{{try{{var now=c.getPrimaryClip();if(changed&&now&&now.getItemCount()==1&&String(now.getDescription().getLabel())=='Por Auto'&&String(now.getItemAt(0).coerceToText(context))==v){{if(old)c.setPrimaryClip(old);else if(android.os.Build.VERSION.SDK_INT>=28)c.clearPrimaryClip();else c.setPrimaryClip(android.content.ClipData.newPlainText('',''));}}else if(changed)status=now?'changed':'error';}}catch(e){{status='error';}}files.write(p+'.restored',status);files.remove(p+'.ready');files.remove(p+'.done');}}"#
    );
    let command=format!("am start -n org.autojs.autojs6/org.autojs.autojs.external.open.RunIntentActivity --es script {}",quote(&script));
    android::text(adb, &["-s", serial, "shell", &command])?;
    let result: Result<(), String> = (|| {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            check(ClipboardStage::Poll)?;
            let state = android::text(
                adb,
                &[
                    "-s",
                    serial,
                    "shell",
                    &format!("cat {} 2>/dev/null", quote(&format!("{marker}.ready"))),
                ],
            )
            .unwrap_or_default();
            if state == "ready" {
                break;
            }
            if state == "error" || Instant::now() > deadline {
                return Err("AutoJs6 未能准备文字输入；未更改无障碍或输入法设置".into());
            }
            thread::sleep(Duration::from_millis(200));
        }
        android::text(
            adb,
            &[
                "-s",
                serial,
                "shell",
                "am",
                "start",
                "-n",
                "com.tencent.mm/com.tencent.mm.ui.LauncherUI",
            ],
        )?;
        thread::sleep(Duration::from_millis(800));
        let windows = android::text(
            adb,
            &["-s", serial, "shell", "dumpsys", "window", "windows"],
        )?;
        if android::focused_package(&windows) != Some(PACKAGE) {
            return Err("文字输入时微信未恢复前台，未粘贴".into());
        }
        check(ClipboardStage::BeforePaste)?;
        let state = android::text(
            adb,
            &[
                "-s",
                serial,
                "shell",
                &format!("cat {} 2>/dev/null", quote(&format!("{marker}.ready"))),
            ],
        )
        .unwrap_or_default();
        if state != "ready" {
            return Err("文字输入组件已超时或退出，未粘贴剪贴板内容".into());
        }
        android::text(
            adb,
            &["-s", serial, "shell", "input", "keyevent", "KEYCODE_PASTE"],
        )?;
        thread::sleep(Duration::from_millis(300));
        Ok(())
    })();
    // Android 10+ only allows clipboard reads while this app has input focus.
    let restore = activate_autojs(adb, serial).and_then(|_| {
        android::text(
            adb,
            &[
                "-s",
                serial,
                "shell",
                &format!("touch {}", quote(&format!("{marker}.done"))),
            ],
        )
    });
    let restored = restore.and_then(|_| {
        let deadline = Instant::now() + Duration::from_secs(4);
        loop {
            let state = android::text(
                adb,
                &[
                    "-s",
                    serial,
                    "shell",
                    &format!("cat {} 2>/dev/null", quote(&format!("{marker}.restored"))),
                ],
            )
            .unwrap_or_default();
            if ["restored", "changed"].contains(&state.as_str()) {
                return Ok(());
            }
            if state == "error" || Instant::now() > deadline {
                return Err("文字输入后未能核对剪贴板恢复，已停止；请检查手机草稿与剪贴板".into());
            }
            thread::sleep(Duration::from_millis(150));
        }
    });
    let returned = android::text(
        adb,
        &[
            "-s",
            serial,
            "shell",
            "am",
            "start",
            "-n",
            "com.tencent.mm/com.tencent.mm.ui.LauncherUI",
        ],
    );
    let _ = android::text(
        adb,
        &[
            "-s",
            serial,
            "shell",
            &format!(
                "rm -f {} {} {}",
                quote(&format!("{marker}.ready")),
                quote(&format!("{marker}.done")),
                quote(&format!("{marker}.restored"))
            ),
        ],
    );
    result?;
    restored?;
    returned?;
    thread::sleep(Duration::from_millis(1000));
    Ok(())
}

fn activate_autojs(adb: &Path, serial: &str) -> Result<(), String> {
    let resolved = android::text(
        adb,
        &[
            "-s",
            serial,
            "shell",
            "cmd",
            "package",
            "resolve-activity",
            "--brief",
            "-a",
            "android.intent.action.MAIN",
            "-c",
            "android.intent.category.LAUNCHER",
            "-p",
            "org.autojs.autojs6",
        ],
    )?;
    let component = android::launcher_component(&resolved, "org.autojs.autojs6")?;
    let result = android::text(
        adb,
        &["-s", serial, "shell", "am", "start", "-n", component],
    )?;
    if result.contains("Error:") || result.contains("Exception") {
        return Err("无法启动 AutoJs6 中文输入组件，未更改系统权限或输入法".into());
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let windows = android::text(
            adb,
            &["-s", serial, "shell", "dumpsys", "window", "windows"],
        )?;
        if android::focused_package(&windows) == Some("org.autojs.autojs6") {
            return Ok(());
        }
        if Instant::now() > deadline {
            return Err("无法打开 AutoJs6 准备中文输入；未更改系统权限或输入法".into());
        }
        thread::sleep(Duration::from_millis(150));
    }
}

pub fn execute(
    root: &Path,
    workflow: &Workflow,
    input: Option<&SendInput>,
    dry_run: bool,
    adb: &Path,
    serial: &str,
    folder: &Path,
    report: impl Fn(usize, usize, &str, &str) -> Result<(), String>,
) -> Result<BTreeMap<String, String>, String> {
    workflow.validate_run(dry_run)?;
    if workflow.package != PACKAGE {
        return Err("当前视觉执行器仅支持微信工作流".into());
    }
    workflow.validate_input(input)?;
    let mut outputs = BTreeMap::new();
    let mut chat = None;
    let current_step = Cell::new(0);
    let mut check =
        |message: &str| report(current_step.get(), workflow.steps.len(), message, "started");
    let mut device = Session::start(root, adb, serial, folder, dry_run, &mut check)?;
    for (index, step) in workflow.steps.iter().enumerate() {
        current_step.set(index + 1);
        (device.check)(&format!(
            "{}/{} · {}",
            index + 1,
            workflow.steps.len(),
            step.name
        ))?;
        match &step.action {
            Action::Wake => {
                device.shell(&["input", "keyevent", "KEYCODE_WAKEUP"])?;
            }
            Action::Launch { activity } => {
                let result = device.shell(&[
                    "am",
                    "start",
                    "-n",
                    &format!("{}/{activity}", workflow.package),
                ])?;
                if result.contains("Error") || result.contains("Exception") {
                    return Err("无法打开微信".into());
                }
                thread::sleep(Duration::from_millis(650));
            }
            Action::Wait { ms } => thread::sleep(Duration::from_millis(*ms)),
            Action::Back => device.back()?,
            Action::WechatHome => {
                device.home()?;
                chat = None;
            }
            Action::WechatFirstChat { output } => {
                let target = device.open_first()?;
                outputs.insert(output.clone(), target.title.clone());
                chat = Some(target);
            }
            Action::WechatOpenChat { target, output } => {
                let target = device.open_named(target)?;
                outputs.insert(output.clone(), target.title.clone());
                chat = Some(target);
            }
            Action::WechatSendText { text } => {
                let target = chat.as_ref().ok_or("尚未核对目标会话，未发送")?;
                let status = device.send(target, text, folder)?;
                outputs.insert("message".into(), text.clone());
                outputs.insert("send_status".into(), status);
            }
            Action::Tap {
                selector,
                skip_if,
                recover_back,
            } => device.tap_selector(selector, skip_if, *recover_back)?,
            Action::ReadRow {
                page,
                labels,
                output,
            } => {
                let screen = device.observe()?;
                if screen.page != "profile"
                    || ![page.as_str(), "个人信息", "个人资料"].contains(&screen.title.as_str())
                {
                    return Err("视觉页面未能确认个人信息页，未读取昵称".into());
                }
                let rows: Vec<_> = screen
                    .items
                    .iter()
                    .filter(|i| i.role == "row" && i.complete && labels.contains(&i.text))
                    .collect();
                if rows.len() != 1 {
                    return Err("昵称所在行无法唯一识别".into());
                }
                let value = rows[0]
                    .value
                    .as_ref()
                    .filter(|v| !v.trim().is_empty())
                    .ok_or("昵称内容无法完整读取")?;
                outputs.insert(output.clone(), value.clone());
            }
            Action::WechatBroadcast => {
                let input = input.ok_or("缺少消息配置")?;
                fs::write(
                    folder.join("input.json"),
                    serde_json::to_vec_pretty(&input.redacted()).map_err(|e| e.to_string())?,
                )
                .map_err(|e| e.to_string())?;
                let context = json!({"workflow":{"id":workflow.id,"name":workflow.name,"version":workflow.version},"device":{"serial":serial},"run":{"id":folder.file_name().unwrap_or_default().to_string_lossy(),"status":"running","mode":if dry_run {"rehearsal"} else {"send"}}});
                let frozen = if input.refresh_each() {
                    None
                } else {
                    Some(input.message_for(&context)?)
                };
                let list = device.discover(input.recipients.scope)?;
                let mut resolved = input.clone();
                if resolved.recipients.mode == crate::send_input::Selection::Selected {
                    for name in &mut resolved.recipients.names {
                        let matches: Vec<_> = list
                            .items
                            .iter()
                            .filter(|c| name_key(&c.title) == name_key(name))
                            .collect();
                        if matches.len() != 1 {
                            return Err(format!("指定会话「{name}」未能唯一匹配，已停止"));
                        }
                        *name = matches[0].title.clone();
                    }
                }
                // Both execution modes share HTTP timing, recipient selection and durable delivery records.
                let result = wechat::broadcast_to(
                    folder,
                    &resolved,
                    &context,
                    list,
                    frozen,
                    dry_run,
                    |message| report(current_step.get(), workflow.steps.len(), message, "started"),
                    |action| match action {
                        wechat::TargetAction::Open(target, _) => {
                            if input.recipients.scope == Scope::Groups {
                                device.open_group(&target.title)?;
                            } else {
                                device.open_named(&target.title)?;
                            }
                            Ok(())
                        }
                        wechat::TargetAction::Send(target, text, child) => {
                            device.send(target, text, child).map(|_| ())
                        }
                    },
                )?;
                outputs.extend(result);
                device.home()?;
            }
        }
        history::log_step(
            folder,
            index + 1,
            step.id.as_deref(),
            "completed",
            &step.name,
        )?;
    }
    outputs.insert("execution_mode".into(), "视觉 AI".into());
    Ok(outputs)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn screen() -> Screen {
        Screen {
            page: "chat".into(),
            title: "文件传输助手".into(),
            certain: true,
            items: vec![],
            editor: Some(Editor {
                point: Point([500, 900]),
                text: Some("1".into()),
            }),
            outgoing: vec![],
            list_empty: false,
        }
    }
    #[test]
    fn send_requires_exact_draft_target_new_outgoing_bubble_and_no_error() {
        let before = screen();
        let mut after = before.clone();
        after.editor.as_mut().unwrap().text = Some("".into());
        assert!(!observed_send(&before, &after, "1"));
        after.outgoing.push(Bubble {
            text: "1".into(),
            pending: false,
            failed: false,
        });
        assert!(observed_send(&before, &after, "1"));
        after.outgoing[0].failed = true;
        assert!(!observed_send(&before, &after, "1"));
        assert!(before.check_chat("另一个人").is_err());
        assert!(same_title("测试群（123）", "测试群"));
        assert!(!same_title("测试群聊（123）", "测试群"));
        assert!(group_title("测试群（123）", "测试群"));
        assert!(group_title("测试群(2)(123)", "测试群(2)"));
        assert!(!group_title("测试群", "测试群"));
        assert!(!group_title("测试群(abc)", "测试群"));
        assert!(Point([1001, 1]).pixels(1080, 2280).is_err());
        let mut unreadable = before;
        unreadable.certain = false;
        assert!(unreadable.validate().is_err());
        unreadable.certain = true;
        unreadable.title.clear();
        assert!(unreadable.validate().is_err());
    }
    #[test]
    fn miniapp_boundary_requires_both_page_title_and_search_label() {
        let mut page = screen();
        page.page = "other".into();
        page.title = "最近".into();
        assert!(!miniapp_drawer(&page));
        page.items.push(Item {
            role: "row".into(),
            text: "搜索小程序".into(),
            value: None,
            point: Point([500, 140]),
            complete: true,
        });
        assert!(miniapp_drawer(&page));
        page.page = "search".into();
        assert!(!miniapp_drawer(&page));
    }
    #[test]
    fn verification_screen_is_a_stop_condition_not_a_chat_with_the_same_name() {
        let mut page = screen();
        page.page = "other".into();
        page.title = "安全保护中".into();
        assert!(page.protected());
        page.page = "chat".into();
        assert!(!page.protected());
    }
    #[test]
    fn missing_send_location_does_not_discard_the_page_or_skip_a_recipient() {
        let mut value = serde_json::to_value(screen()).unwrap();
        value["items"] =
            json!([{"role":"send","text":"","value":null,"point":null,"complete":true}]);
        let page = parse_screen(value.clone()).unwrap();
        page.validate().unwrap();
        assert!(page.unique("send").is_err());
        value["items"][0]["role"] = json!("group");
        assert!(parse_screen(value).is_err());
    }
    #[test]
    fn pixel_coordinates_and_incomplete_protocol_are_rejected_before_any_action() {
        let mut page = screen();
        page.items.push(Item {
            role: "group".into(),
            text: "测试群".into(),
            value: None,
            point: Point([500, 1177]),
            complete: true,
        });
        assert!(page.validate().is_err());
        page.items[0].point = Point([500, 600]);
        assert!(page.validate().is_ok());
        let mut value = serde_json::to_value(&page).unwrap();
        value.as_object_mut().unwrap().remove("certain");
        assert!(serde_json::from_value::<Screen>(value).is_err());
    }
    #[test]
    fn existing_group_entry_is_matched_by_its_observed_label_without_accepting_nearby_actions() {
        let mut screen = screen();
        screen.page = "new_chat".into();
        for text in ["创建新群聊", "面对面建群", "选择一个已有的群"] {
            screen.items.push(Item {
                role: "row".into(),
                text: text.into(),
                value: None,
                point: Point([500, 200]),
                complete: true,
            });
        }
        assert_eq!(
            screen.unique("choose_group").unwrap().text,
            "选择一个已有的群"
        );
        screen.page = "groups".into();
        assert!(screen.unique("choose_group").is_err());
    }
    #[test]
    fn profile_prefix_can_match_its_wechat_id_line_without_matching_other_rows() {
        let mut item = Item {
            role: "profile".into(),
            text: "示例昵称\n微信号：example".into(),
            value: None,
            point: Point([500, 200]),
            complete: true,
        };
        let selector: Selector =
            serde_json::from_value(json!({"prefix":["微信号：", "微信号:"]})).unwrap();
        assert!(item.matches_text(&selector));
        item.text = "示例昵称 微信号：example".into();
        assert!(item.matches_text(&selector));
        item.role = "row".into();
        assert!(!item.matches_text(&selector));
        item.role = "profile".into();
        item.text = "某人说微信号：example".into();
        assert!(!item.matches_text(&selector));
    }
    #[test]
    fn visual_names_tolerate_spacing_and_bar_variants_without_merging_ambiguous_targets() {
        assert!(same_title("示例 （讨论）(114)", "示例(讨论)"));
        assert_eq!(name_key("群 | 测试"), name_key("群丨测试"));
        let mut names = vec!["A".into(), "群 | 测试".into()];
        merge_names(&mut names, &["群｜测试".into(), "B".into()]).unwrap();
        assert_eq!(names.len(), 3);
        assert!(merge_names(&mut names, &["X".into(), "X ".into()]).is_err());
        assert_eq!(
            name_set(&["A".into(), "B".into()]),
            name_set(&["B".into(), "A".into()])
        );
    }
    #[test]
    #[ignore = "requires an explicitly selected local vision provider and authorized real phone"]
    fn real_device_visual_workflow() {
        let root =
            std::path::PathBuf::from(std::env::var("POR_VISUAL_ROOT").expect("POR_VISUAL_ROOT"));
        let adb =
            std::path::PathBuf::from(std::env::var("POR_VISUAL_ADB").expect("POR_VISUAL_ADB"));
        let serial = std::env::var("POR_VISUAL_SERIAL").expect("POR_VISUAL_SERIAL");
        let id = std::env::var("POR_VISUAL_WORKFLOW").expect("POR_VISUAL_WORKFLOW");
        let dry_run = std::env::var("POR_VISUAL_DRY_RUN").as_deref() == Ok("1");
        if crate::provider::load(&root)
            .unwrap()
            .is_some_and(|c| c.credential.is_some())
        {
            assert!(
                std::env::var_os("POR_VISUAL_API_KEY").is_some(),
                "真机调试请通过 POR_VISUAL_API_KEY 提供本次会话密钥；调试不会读取系统钥匙串"
            );
        }
        if let Ok(image) = std::env::var("POR_VISUAL_IMAGE") {
            let image = std::path::PathBuf::from(image);
            if let Ok(target) = std::env::var("POR_VISUAL_GROUND_TARGET") {
                let frame = crate::markers::Frame::new(&fs::read(&image).unwrap()).unwrap();
                let page =
                    std::env::var("POR_VISUAL_GROUND_PAGE").unwrap_or_else(|_| "search".into());
                let approximate: Point = serde_json::from_str(
                    &std::env::var("POR_VISUAL_GROUND_POINT")
                        .unwrap_or_else(|_| "[500,500]".into()),
                )
                .unwrap();
                let client = VisionClient::for_phone(&root).unwrap();
                let mut matched = None;
                for candidate in frame.candidates(approximate.0).unwrap() {
                    fs::write(image.with_extension("candidate.png"), &candidate.png).unwrap();
                    let selection: crate::markers::Selection = client
                        .observe(
                            &candidate.png,
                            &crate::markers::instruction(&target, &page, candidate.id),
                        )
                        .unwrap();
                    if selection.found {
                        assert_eq!(selection.marker, Some(candidate.id));
                        matched = Some(selection);
                        break;
                    }
                }
                let selection = matched.expect("no candidate row matched the requested full name");
                fs::write(
                    image.with_extension("grounding.json"),
                    serde_json::to_vec_pretty(&selection).unwrap(),
                )
                .unwrap();
                assert!(selection.found && name_key(&selection.text) == name_key(&target));
                let point = frame.selected(&selection).unwrap();
                if let Ok(range) = std::env::var("POR_VISUAL_GROUND_Y_RANGE") {
                    let (min, max) = range.split_once(':').unwrap();
                    assert!(
                        (min.parse::<u16>().unwrap()..=max.parse::<u16>().unwrap())
                            .contains(&point[1]),
                        "selected marker is outside the expected target row"
                    );
                }
                return;
            }
            let value: serde_json::Value = VisionClient::for_phone(&root)
                .unwrap()
                .observe(&fs::read(&image).unwrap(), PROTOCOL)
                .unwrap();
            fs::write(
                image.with_extension("response.json"),
                serde_json::to_vec_pretty(&value).unwrap(),
            )
            .unwrap();
            parse_screen(value).unwrap().validate().unwrap();
            return;
        }
        assert!(crate::schedule::valid_serial(&serial));
        let workflow = crate::workflow::BUNDLED_WORKFLOWS
            .iter()
            .map(|s| Workflow::parse(s.as_bytes()).unwrap())
            .find(|w| w.id == id)
            .expect("known bundled workflow");
        let input = if workflow.configurable() {
            Some(SendInput {
                message: crate::send_input::Message::Manual { text: "Ok".into() },
                recipients: crate::send_input::Recipients {
                    scope: Scope::Groups,
                    mode: crate::send_input::Selection::All,
                    names: vec![],
                },
                interval_ms: 1000,
            })
        } else {
            None
        };
        if !dry_run
            && workflow.steps.iter().any(|s| {
                matches!(
                    s.action,
                    Action::WechatSendText { .. } | Action::WechatBroadcast
                )
            })
        {
            assert_eq!(
                std::env::var("POR_VISUAL_ALLOW_SEND").as_deref(),
                Ok("user-authorized-1-and-Ok")
            );
        }
        let (_, folder) = history::create_folder(&root.join("runs")).unwrap();
        let mut awake = crate::awake::ScreenAwake::start(&adb, &serial).unwrap();
        let result = execute(
            &root,
            &workflow,
            input.as_ref(),
            dry_run,
            &adb,
            &serial,
            &folder,
            |_, _, message, _| {
                eprintln!("{message}");
                Ok(())
            },
        );
        let wake_cleanup = awake.restore();
        fs::write(
            folder.join("test-outcome.json"),
            serde_json::to_vec_pretty(&json!({"workflow":workflow.id,"dryRun":dry_run,"ok":result.is_ok(),"error":result.as_ref().err(),"outputs":result.as_ref().ok(),"wakeCleanupError":wake_cleanup.as_ref().err()}))
                .unwrap(),
        )
        .unwrap();
        assert!(
            wake_cleanup.is_ok(),
            "{}",
            wake_cleanup.err().unwrap_or_default()
        );
        assert!(result.is_ok(), "{}", result.err().unwrap_or_default());
        if dry_run && workflow.sends_messages() {
            let mut evidence = fs::read_to_string(folder.join("events.jsonl")).unwrap();
            if let Ok(targets) = fs::read_to_string(folder.join("targets.json")) {
                let targets: Vec<wechat::Delivery> = serde_json::from_str(&targets).unwrap();
                assert!(!targets.is_empty());
                assert!(targets.iter().all(|t| t.status == "rehearsed"));
                for (index, _) in targets.iter().enumerate() {
                    evidence.push_str(
                        &fs::read_to_string(
                            folder.join(format!("target-{:04}/events.jsonl", index + 1)),
                        )
                        .unwrap(),
                    );
                }
            }
            assert!(evidence.contains("draft_verified"));
            assert!(!evidence.contains("send_requested"));
            assert!(!evidence.contains("send_observed"));
        }
    }
}
