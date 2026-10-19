use crate::history;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{
    blocking::Client,
    header::{HeaderName, HeaderValue},
    redirect::Policy,
    Url,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Read,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendInput {
    pub message: Message,
    pub recipients: Recipients,
    #[serde(default = "interval")]
    pub interval_ms: u64,
}
fn interval() -> u64 {
    1000
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Message {
    Manual { text: String },
    BeforeRun,
    Http { request: Request, refresh: Refresh },
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Refresh {
    Run,
    Recipient,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recipients {
    pub scope: Scope,
    pub mode: Selection,
    #[serde(default)]
    pub names: Vec<String>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    Groups,
    Conversations,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Selection {
    All,
    Selected,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Pair {
    pub name: String,
    pub value: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub query: Vec<Pair>,
    #[serde(default)]
    pub headers: Vec<Pair>,
    pub auth: Auth,
    pub body: Option<Value>,
    pub response: Response,
    #[serde(default = "timeout")]
    pub timeout_seconds: u64,
}
fn timeout() -> u64 {
    20
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Auth {
    None,
    Bearer {
        credential: String,
    },
    Basic {
        username: String,
        credential: String,
    },
    ApiKey {
        name: String,
        location: String,
        credential: String,
    },
}
impl Auth {
    fn credential(&self) -> Option<&str> {
        match self {
            Self::None => None,
            Self::Bearer { credential }
            | Self::Basic { credential, .. }
            | Self::ApiKey { credential, .. } => Some(credential),
        }
    }
    fn set_credential(&mut self, id: String) {
        match self {
            Self::None => {}
            Self::Bearer { credential }
            | Self::Basic { credential, .. }
            | Self::ApiKey { credential, .. } => *credential = id,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Response {
    Text,
    Json { pointer: String },
    Ignore,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hooks {
    pub before_run: Option<Request>,
    pub after_run: Option<Request>,
}
impl Hooks {
    pub fn validate(&self) -> Result<(), String> {
        for request in [&self.before_run, &self.after_run].into_iter().flatten() {
            request.validate()?;
        }
        Ok(())
    }
    pub fn save_secrets(
        &mut self,
        secrets: &std::collections::BTreeMap<String, String>,
    ) -> Result<(), String> {
        for (name, hook) in [
            ("before", &mut self.before_run),
            ("after", &mut self.after_run),
        ] {
            if let Some(request) = hook {
                request.save_secret(secrets.get(name).map(String::as_str))?;
            }
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub status: u16,
    pub elapsed_ms: u64,
    pub fetched_at: u64,
    pub raw: String,
    pub message: String,
    pub parse_error: Option<String>,
}

pub fn validate_message(text: &str) -> Result<(), String> {
    if text.trim().is_empty()
        || text.len() > 4000
        || text
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err("消息不能为空，且不能超过 4000 字节或包含控制字符".into());
    }
    Ok(())
}

impl Request {
    pub fn save_secret(&mut self, secret: Option<&str>) -> Result<(), String> {
        if matches!(self.auth, Auth::None) {
            return Ok(());
        }
        if let Some(secret) = secret.filter(|s| !s.is_empty()) {
            if secret.len() > 2000 || secret.chars().any(char::is_control) {
                return Err("鉴权值过长或包含控制字符".into());
            }
            let id = uuid::Uuid::new_v4().to_string();
            credential(&id)?
                .set_password(secret)
                .map_err(|_| "保存系统凭据失败，配置未更新")?;
            self.auth.set_credential(id);
        } else {
            credential(self.auth.credential().unwrap_or(""))?
                .get_password()
                .map_err(|_| "请填写鉴权值")?;
        }
        Ok(())
    }
    pub fn with_context(&self, context: &Value) -> Result<Self, String> {
        fn expand(value: &mut Value, context: &Value) -> Result<(), String> {
            match value {
                Value::String(text) => {
                    let mut result = String::new();
                    let mut rest = text.as_str();
                    while let Some(start) = rest.find("{{") {
                        result.push_str(&rest[..start]);
                        rest = &rest[start + 2..];
                        let end = rest.find("}}").ok_or("Hook 变量缺少 }}")?;
                        let name = rest[..end].trim();
                        if name.is_empty()
                            || !name.split('.').all(|s| {
                                !s.is_empty()
                                    && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                            })
                        {
                            return Err("Hook 变量名称无效".into());
                        }
                        let resolved = name
                            .split('.')
                            .try_fold(context, |v, k| v.get(k))
                            .ok_or_else(|| format!("Hook 变量 {name} 在当前时机不存在"))?;
                        result.push_str(
                            &resolved
                                .as_str()
                                .map(str::to_owned)
                                .unwrap_or_else(|| resolved.to_string()),
                        );
                        rest = &rest[end + 2..];
                    }
                    result.push_str(rest);
                    *text = result;
                }
                Value::Array(items) => {
                    for item in items {
                        expand(item, context)?;
                    }
                }
                Value::Object(items) => {
                    for item in items.values_mut() {
                        expand(item, context)?;
                    }
                }
                _ => {}
            }
            Ok(())
        }
        let mut value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        // Only data fields accept variables; URL, parser and credentials remain literal.
        for name in ["query", "headers", "body"] {
            if let Some(field) = value.get_mut(name) {
                expand(field, context)?;
            }
        }
        serde_json::from_value(value).map_err(|_| "Hook 请求格式无效".into())
    }
    pub fn validate(&self) -> Result<(), String> {
        let url = Url::parse(&self.url).map_err(|_| "请求地址无效")?;
        if !["http", "https"].contains(&url.scheme())
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || self.url.len() > 4000
        {
            return Err("请求地址需要为 HTTP / HTTPS，鉴权请在独立区域设置".into());
        }
        if !["GET", "POST"].contains(&self.method.as_str())
            || !(1..=60).contains(&self.timeout_seconds)
            || (self.method == "GET" && self.body.is_some())
        {
            return Err("请求仅支持 GET / POST，超时为 1～60 秒，GET 不支持请求体".into());
        }
        if self.query.len() > 30
            || self.headers.len() > 30
            || self
                .body
                .as_ref()
                .is_some_and(|v| v.to_string().len() > 65536)
        {
            return Err("请求参数、请求头或请求体超出限制".into());
        }
        for pair in &self.query {
            if pair.name.trim().is_empty()
                || pair.name.len() > 200
                || pair.value.len() > 4000
                || pair.name.chars().any(char::is_control)
            {
                return Err("查询参数格式无效".into());
            }
        }
        for pair in &self.headers {
            if pair.value.len() > 4000
                || HeaderName::from_bytes(pair.name.as_bytes()).is_err()
                || HeaderValue::from_str(&pair.value).is_err()
            {
                return Err("请求头格式无效".into());
            }
            if [
                "authorization",
                "proxy-authorization",
                "cookie",
                "host",
                "content-length",
            ]
            .contains(&pair.name.to_ascii_lowercase().as_str())
            {
                return Err("鉴权请使用鉴权区域；不支持覆盖 Cookie、Host 或 Content-Length".into());
            }
        }
        match &self.auth {
            Auth::Basic { username, .. }
                if username.len() > 200
                    || username.contains(':')
                    || username.chars().any(char::is_control) =>
            {
                return Err("Basic 用户名无效".into())
            }
            Auth::ApiKey { name, location, .. }
                if name.is_empty()
                    || name.len() > 200
                    || !["header", "query"].contains(&location.as_str())
                    || (location == "header"
                        && HeaderName::from_bytes(name.as_bytes()).is_err()) =>
            {
                return Err("API Key 参数名或位置无效".into())
            }
            _ => {}
        }
        if let Response::Json { pointer } = &self.response {
            if pointer.len() > 1000
                || (!pointer.is_empty() && !pointer.starts_with('/'))
                || pointer
                    .as_bytes()
                    .windows(2)
                    .any(|w| w[0] == b'~' && ![b'0', b'1'].contains(&w[1]))
                || pointer.ends_with('~')
            {
                return Err(
                    "请输入 JSON Pointer，例如 /data/message；对象字段中的 / 写作 ~1，~ 写作 ~0"
                        .into(),
                );
            }
        }
        Ok(())
    }

    pub fn fetch(&self, supplied_secret: Option<&str>) -> Result<Preview, String> {
        self.fetch_response(supplied_secret, false)
    }
    pub fn preview(&self, supplied_secret: Option<&str>) -> Result<Preview, String> {
        self.fetch_response(supplied_secret, true)
    }
    fn fetch_response(
        &self,
        supplied_secret: Option<&str>,
        preview: bool,
    ) -> Result<Preview, String> {
        self.validate()?;
        let stored;
        let secret = if let Some(value) = supplied_secret {
            value
        } else if let Some(id) = self.auth.credential() {
            if id.is_empty() {
                return Err("请先填写并保存鉴权信息".into());
            }
            stored = credential(id)?
                .get_password()
                .map_err(|_| "无法读取系统凭据，请重新保存鉴权信息")?;
            &stored
        } else {
            ""
        };
        if !matches!(self.auth, Auth::None)
            && (secret.is_empty() || secret.len() > 2000 || secret.chars().any(char::is_control))
        {
            return Err("鉴权信息为空、过长或包含控制字符".into());
        }
        let client = Client::builder()
            .redirect(Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(self.timeout_seconds))
            .build()
            .map_err(|_| "无法创建 HTTP 连接")?;
        let mut url = Url::parse(&self.url).map_err(|_| "请求地址无效")?;
        {
            let mut pairs = url.query_pairs_mut();
            for p in &self.query {
                pairs.append_pair(&p.name, &p.value);
            }
            if let Auth::ApiKey { name, location, .. } = &self.auth {
                if location == "query" {
                    pairs.append_pair(name, secret);
                }
            }
        }
        let mut request = client.request(
            if self.method == "GET" {
                reqwest::Method::GET
            } else {
                reqwest::Method::POST
            },
            url,
        );
        for p in &self.headers {
            request = request.header(&p.name, &p.value);
        }
        request = match &self.auth {
            Auth::None => request,
            Auth::Bearer { .. } => request.bearer_auth(secret),
            Auth::Basic { username, .. } => request.basic_auth(username, Some(secret)),
            Auth::ApiKey { name, location, .. } => {
                if location == "header" {
                    request.header(name, secret)
                } else {
                    request
                }
            }
        };
        if let Some(body) = &self.body {
            request = request.json(body);
        }
        let started = Instant::now();
        // Do not include reqwest's URL-bearing error in logs (queries can contain credentials).
        let response = request.send().map_err(|e| {
            if e.is_timeout() {
                "HTTP 请求超时"
            } else {
                "HTTP 请求失败，请检查地址、网络或证书"
            }
        })?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) && !preview {
            return Err(format!("HTTP {status}；未获取消息，未操作发送"));
        }
        let mut bytes = Vec::new();
        response
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .map_err(|_| "读取 HTTP 响应失败")?;
        if bytes.len() > 1_048_576 {
            return Err("HTTP 响应超过 1 MiB".into());
        }
        let raw = String::from_utf8(bytes).map_err(|_| "HTTP 响应需要为 UTF-8 文本")?;
        let parsed = if (200..300).contains(&status) {
            parse(&raw, &self.response)
        } else {
            Err(format!("HTTP {status}；未获取消息，未操作发送"))
        };
        let (message, parse_error) = match parsed {
            Ok(message) => (message, None),
            Err(error) if preview => (String::new(), Some(error)),
            Err(error) => return Err(error),
        };
        let mut safe_raw = raw;
        if !secret.is_empty() {
            safe_raw = safe_raw.replace(secret, "[已隐藏凭据]");
            if let Auth::Basic { username, .. } = &self.auth {
                safe_raw = safe_raw.replace(
                    &STANDARD.encode(format!("{username}:{secret}")),
                    "[已隐藏凭据]",
                );
            }
            if message.contains(secret) {
                return Err("解析后的消息包含鉴权值，已停止；请检查响应解析字段".into());
            }
        }
        Ok(Preview {
            status,
            elapsed_ms: started.elapsed().as_millis() as u64,
            fetched_at: history::now(),
            raw: safe_raw,
            message,
            parse_error,
        })
    }
}

pub fn parse(raw: &str, response: &Response) -> Result<String, String> {
    let text = match response {
        Response::Ignore => return Ok(String::new()),
        Response::Text => raw.to_owned(),
        Response::Json { pointer } => serde_json::from_str::<Value>(raw)
            .map_err(|_| "响应不是有效 JSON")?
            .pointer(pointer)
            .and_then(Value::as_str)
            .ok_or("解析路径不存在或结果不是字符串，请在预览中检查 JSON Pointer")?
            .to_owned(),
    };
    validate_message(&text)?;
    Ok(text)
}
fn credential(id: &str) -> Result<keyring::Entry, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "鉴权引用无效")?;
    keyring::Entry::new("com.por.wechatreader.http", id).map_err(|_| "系统凭据存储不可用".into())
}
impl SendInput {
    pub fn validate(&self) -> Result<(), String> {
        match &self.message {
            Message::Manual { text } => validate_message(text)?,
            Message::BeforeRun => {}
            Message::Http { request, .. } => {
                request.validate()?;
                if matches!(request.response, Response::Ignore) {
                    return Err("获取消息必须选择文本或 JSON 字符串解析".into());
                }
            }
        };
        if !(500..=60000).contains(&self.interval_ms)
            || self.recipients.names.len() > 2000
            || self
                .recipients
                .names
                .iter()
                .any(|n| n.trim().is_empty() || n.len() > 500 || n.chars().any(char::is_control))
            || (self.recipients.mode == Selection::Selected && self.recipients.names.is_empty())
        {
            return Err("请选择接收会话，并设置 0.5～60 秒的发送间隔".into());
        }
        let mut names = self.recipients.names.clone();
        names.sort();
        names.dedup();
        if names.len() != self.recipients.names.len() {
            return Err("接收会话不能重复".into());
        }
        Ok(())
    }
    pub fn save_secret(&mut self, secret: Option<&str>) -> Result<(), String> {
        if let Message::Http { request, .. } = &mut self.message {
            request.save_secret(secret)?;
        }
        Ok(())
    }
    pub fn message_for(&self, context: &Value) -> Result<String, String> {
        match &self.message {
            Message::BeforeRun => Err("前置 Hook 数据尚未解析".into()),
            Message::Manual { text } => {
                validate_message(text)?;
                Ok(text.clone())
            }
            Message::Http { request, .. } => {
                Ok(request.with_context(context)?.fetch(None)?.message)
            }
        }
    }
    pub fn refresh_each(&self) -> bool {
        matches!(
            self.message,
            Message::Http {
                refresh: Refresh::Recipient,
                ..
            }
        )
    }
    pub fn redacted(&self) -> Value {
        let mut value = serde_json::to_value(self).unwrap_or(Value::Null);
        if let Some(message) = value
            .get_mut("message")
            .filter(|_| matches!(self.message, Message::Http { .. }))
        {
            *message = json!({"type":"http","refresh": if self.refresh_each(){"recipient"}else{"run"},"request":"[请求参数与鉴权配置不写入运行记录]"});
        }
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    #[test]
    #[ignore = "requires the desktop OS credential store"]
    fn desktop_credentials_are_not_serialized_and_remain_readable_by_reference() {
        let secret = format!("por-auto-test-{}", uuid::Uuid::new_v4());
        let mut request = Request {
            url: "https://example.com".into(),
            method: "GET".into(),
            query: vec![],
            headers: vec![],
            auth: Auth::Bearer {
                credential: "".into(),
            },
            body: None,
            response: Response::Text,
            timeout_seconds: 5,
        };
        request.save_secret(Some(&secret)).unwrap();
        let id = request.auth.credential().unwrap().to_owned();
        let stored = credential(&id).unwrap();
        let result = stored.get_password();
        stored.delete_credential().unwrap();
        assert_eq!(result.unwrap(), secret);
        assert!(!serde_json::to_string(&request).unwrap().contains(&secret));
    }
    #[test]
    fn lifecycle_context_is_explicit_and_does_not_expand_urls_or_credentials() {
        let request = Request {
            url: "https://example.com/hook".into(),
            method: "POST".into(),
            query: vec![Pair {
                name: "status".into(),
                value: "{{run.status}}".into(),
            }],
            headers: vec![],
            auth: Auth::None,
            body: Some(json!({"device":"{{device.serial}}","name":"{{outputs.nickname}}"})),
            response: Response::Ignore,
            timeout_seconds: 5,
        };
        let context = json!({"run":{"status":"failed"},"device":{"serial":"test-device"},"outputs":{"nickname":"测试"}});
        let expanded = request.with_context(&context).unwrap();
        assert_eq!(expanded.query[0].value, "failed");
        assert_eq!(expanded.body.unwrap()["name"], "测试");
        assert!(request.with_context(&json!({})).is_err());
        assert_eq!(parse("", &Response::Ignore).unwrap(), "");
        let input = SendInput {
            message: Message::Http {
                request,
                refresh: Refresh::Run,
            },
            recipients: Recipients {
                scope: Scope::Groups,
                mode: Selection::All,
                names: vec![],
            },
            interval_ms: 1000,
        };
        assert!(input.validate().is_err());
        assert!(!input.redacted().to_string().contains("example.com"));
    }
    #[test]
    fn http_test_covers_query_auth_post_and_parsing_without_sending() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = server.local_addr().unwrap();
        let worker = thread::spawn(move || {
            for _ in 0..3 {
                let (mut stream, _) = server.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut data = [0; 8192];
                let mut raw = String::new();
                loop {
                    let n = stream.read(&mut data).unwrap();
                    raw.push_str(std::str::from_utf8(&data[..n]).unwrap());
                    if raw.contains("\r\n\r\n") && raw.contains("\"kind\":\"daily\"") {
                        break;
                    }
                }
                assert!(raw.starts_with("POST /message?lang=zh"));
                assert!(raw
                    .to_lowercase()
                    .contains("authorization: bearer test-secret"));
                let body = r#"{"data":{"message":"Ok"}}"#;
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            }
        });
        let r = Request {
            url: format!("http://{address}/message"),
            method: "POST".into(),
            query: vec![Pair {
                name: "lang".into(),
                value: "zh".into(),
            }],
            headers: vec![],
            auth: Auth::Bearer {
                credential: "".into(),
            },
            body: Some(json!({"kind":"daily"})),
            response: Response::Json {
                pointer: "/data/message".into(),
            },
            timeout_seconds: 5,
        };
        let preview = r.fetch(Some("test-secret")).unwrap();
        assert_eq!(preview.message, "Ok");
        assert_eq!(preview.status, 200);
        let mut bad_path = r.clone();
        bad_path.response = Response::Json {
            pointer: "/missing".into(),
        };
        let preview = bad_path.preview(Some("test-secret")).unwrap();
        assert!(preview.parse_error.is_some());
        assert!(preview.raw.contains("message"));
        assert!(preview.message.is_empty());
        assert!(bad_path.fetch(Some("test-secret")).is_err());
        worker.join().unwrap();
        assert!(parse(
            r#"{"data":12}"#,
            &Response::Json {
                pointer: "/data".into()
            }
        )
        .is_err());
        assert!(parse(" ", &Response::Text).is_err());
        assert!(parse(
            "not json",
            &Response::Json {
                pointer: "/data".into()
            }
        )
        .is_err());
        let mut invalid = r;
        invalid.url = "https://user:password@example.com".into();
        assert!(invalid.validate().is_err());
    }
}
