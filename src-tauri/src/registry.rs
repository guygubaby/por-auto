use crate::workflow::{valid_id, Workflow, BUNDLED_WORKFLOWS};
use reqwest::{blocking::Client, header, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::Path,
    time::{Duration, Instant},
};

pub const DEFAULT_URL: &str = "https://github.com/guygubaby/por-auto";
const INDEX_PATH: &str = "workflows/registry.json";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub url: String,
    pub reference: String,
    pub name: String,
    pub commit: String,
    pub workflows: Vec<Workflow>,
    #[serde(default)]
    pub bundled_ids: BTreeSet<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub key: String,
    pub registry_url: String,
    pub reference: String,
    pub commit: String,
    pub workflow: Workflow,
    #[serde(default)]
    pub input: Option<crate::send_input::SendInput>,
    #[serde(default)]
    pub hooks: crate::send_input::Hooks,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub schema_version: u32,
    pub registries: Vec<Registry>,
    pub installed: Vec<Installed>,
    #[serde(default)]
    pub uninstalled_keys: BTreeSet<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Index {
    schema_version: u32,
    name: String,
    workflows: Vec<Entry>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    id: String,
    path: String,
    sha256: String,
}

pub fn key(url: &str, reference: &str, id: &str) -> String {
    format!("{:x}", Sha256::digest(format!("{url}\n{reference}\n{id}")))
}

pub fn repository(value: &str) -> Result<(String, String, String), String> {
    let url = Url::parse(value.trim()).map_err(|_| "请输入 GitHub 仓库的 HTTPS 地址")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("仅支持 https://github.com/作者/仓库 形式的地址".into());
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if parts.len() != 2 {
        return Err("请填写仓库根地址，分支在单独的输入框填写".into());
    }
    let (owner, repo) = (parts[0], parts[1].strip_suffix(".git").unwrap_or(parts[1]));
    if [owner, repo].iter().any(|v| {
        v.is_empty()
            || v.len() > 100
            || *v == "."
            || *v == ".."
            || !v
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
    }) {
        return Err("GitHub 仓库地址无效".into());
    }
    Ok((
        format!("https://github.com/{owner}/{repo}"),
        owner.into(),
        repo.into(),
    ))
}

pub fn valid_path(path: &str, id: &str) -> bool {
    valid_id(id) && path == format!("workflows/{id}/workflow.json")
}

fn keep_official_first(store: &mut Store) -> Result<(), String> {
    let official = if let Some(index) = store
        .registries
        .iter()
        .position(|r| r.url.eq_ignore_ascii_case(DEFAULT_URL) && r.reference == "main")
    {
        store.registries.remove(index)
    } else {
        Registry {
            url: DEFAULT_URL.into(),
            reference: "main".into(),
            name: "Por Auto 官方工作流".into(),
            commit: "bundled".into(),
            workflows: bundled_workflows()?,
            bundled_ids: BTreeSet::new(),
        }
    };
    let mut official = official;
    for workflow in bundled_workflows()? {
        if official.commit == "bundled" {
            if let Some(index) = official.workflows.iter().position(|w| w.id == workflow.id) {
                official.workflows[index] = workflow.clone();
            }
        }
        if !official.workflows.iter().any(|w| w.id == workflow.id) {
            official.bundled_ids.insert(workflow.id.clone());
            official.workflows.push(workflow.clone());
        }
        // Add new bundled examples without replacing user-installed snapshots.
        if !store
            .uninstalled_keys
            .contains(&key(DEFAULT_URL, "main", &workflow.id))
            && !store
                .installed
                .iter()
                .any(|w| w.key == key(DEFAULT_URL, "main", &workflow.id))
        {
            store.installed.push(Installed {
                key: key(DEFAULT_URL, "main", &workflow.id),
                registry_url: DEFAULT_URL.into(),
                reference: "main".into(),
                commit: "bundled".into(),
                workflow,
                input: None,
                hooks: Default::default(),
            });
        }
    }
    store.registries.insert(0, official);
    Ok(())
}

pub fn load(directory: &Path) -> Result<Store, String> {
    let path = directory.join("workflow-store.json");
    if path.exists() {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let mut store: Store = serde_json::from_slice(&bytes)
            .map_err(|_| "本地工作流配置无法读取，请保留文件并联系开发者")?;
        if store.schema_version != 1 {
            return Err("本地工作流配置版本不兼容".into());
        }
        for item in &store.installed {
            item.workflow.validate()?;
        }
        keep_official_first(&mut store)?;
        return Ok(store);
    }
    let mut store = Store {
        schema_version: 1,
        registries: vec![],
        installed: vec![],
        uninstalled_keys: BTreeSet::new(),
    };
    keep_official_first(&mut store)?;
    Ok(store)
}

fn bundled_workflows() -> Result<Vec<Workflow>, String> {
    BUNDLED_WORKFLOWS
        .iter()
        .map(|source| Workflow::parse(source.as_bytes()))
        .collect()
}

pub fn save(directory: &Path, store: &Store) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let temporary = directory.join("workflow-store.next.json");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(temporary, directory.join("workflow-store.json"))
        .map_err(|e| format!("保存工作流配置失败：{e}"))
}

fn api_url(owner: &str, repo: &str, rest: &[&str]) -> Url {
    let mut url = Url::parse("https://api.github.com").unwrap();
    url.path_segments_mut()
        .unwrap()
        .extend(["repos", owner, repo])
        .extend(rest);
    url
}

fn download(client: &Client, url: Url, token: &str, limit: u64) -> Result<Vec<u8>, String> {
    let mut request = client
        .get(url)
        .header(header::ACCEPT, "application/vnd.github.raw+json")
        .header("X-GitHub-Api-Version", "2022-11-28");
    if !token.is_empty() {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .map_err(|_| "连接 GitHub 失败，请检查网络后重试")?;
    let status = response.status();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 => "GitHub 令牌无效或已过期".into(),
            403 | 429 => {
                "GitHub 权限不足或请求次数受限，请检查 Contents 只读权限，或稍后重试".into()
            }
            404 => "仓库、分支或工作流文件不存在；私有仓库请填写有权限的 GitHub 令牌".into(),
            _ => format!(
                "GitHub 返回 HTTP {}，本地已安装工作流保持不变",
                status.as_u16()
            ),
        });
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "GitHub 文件下载中断，请重试")?;
    if bytes.len() as u64 > limit {
        return Err("工作流文件超过大小限制".into());
    }
    Ok(bytes)
}

pub fn sync(
    directory: &Path,
    input_url: &str,
    reference: &str,
    token: &str,
) -> Result<Store, String> {
    let (url, owner, repo) = repository(input_url)?;
    let reference = reference.trim();
    if reference.is_empty()
        || reference.len() > 200
        || reference.chars().any(char::is_control)
        || token.len() > 500
        || token.chars().any(char::is_whitespace)
    {
        return Err("分支或 GitHub 令牌格式无效".into());
    }
    let mut store = load(directory)?;
    if store.registries.len() >= 20
        && !store
            .registries
            .iter()
            .any(|r| r.url == url && r.reference == reference)
    {
        return Err("最多可添加 20 个工作流仓库".into());
    }
    let client = Client::builder()
        .user_agent("por-auto/0.1.0")
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法创建 GitHub 连接")?;
    let started = Instant::now();
    #[derive(Deserialize)]
    struct Commit {
        sha: String,
    }
    let commit: Commit = serde_json::from_slice(&download(
        &client,
        api_url(&owner, &repo, &["commits", reference]),
        token,
        1_048_576,
    )?)
    .map_err(|_| "无法解析 GitHub 提交信息")?;
    if commit.sha.len() != 40 || !commit.sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("GitHub 提交标识无效".into());
    }
    let fetch_file = |path: &str, limit| {
        if started.elapsed() > Duration::from_secs(60) {
            return Err("工作流同步超时，请重试".into());
        }
        let mut api = api_url(&owner, &repo, &["contents"]);
        api.path_segments_mut().unwrap().extend(path.split('/'));
        api.query_pairs_mut().append_pair("ref", &commit.sha);
        download(&client, api, token, limit)
    };
    let index: Index = serde_json::from_slice(&fetch_file(INDEX_PATH, 131072)?)
        .map_err(|e| format!("workflows/registry.json 格式错误：{e}"))?;
    if index.schema_version != 1
        || index.name.is_empty()
        || index.name.len() > 200
        || index.workflows.len() > 32
    {
        return Err("仓库索引版本、名称或工作流数量无效".into());
    }
    let mut ids = BTreeSet::new();
    let mut workflows = Vec::new();
    for entry in index.workflows {
        if !valid_path(&entry.path, &entry.id) || !ids.insert(entry.id.clone()) {
            return Err("工作流索引包含重复标识或非标准路径".into());
        }
        let bytes = fetch_file(&entry.path, 262144)?;
        if entry.sha256 != format!("{:x}", Sha256::digest(&bytes)) {
            return Err(format!(
                "工作流 {} 校验失败，请联系仓库作者重新生成索引",
                entry.id
            ));
        }
        let workflow = Workflow::parse(&bytes)?;
        if workflow.id != entry.id {
            return Err("工作流标识与索引不一致".into());
        }
        workflows.push(workflow);
    }
    let registry = Registry {
        url: url.clone(),
        reference: reference.into(),
        name: index.name,
        commit: commit.sha,
        workflows,
        bundled_ids: BTreeSet::new(),
    };
    store
        .registries
        .retain(|r| r.url != url || r.reference != reference);
    store.registries.push(registry);
    keep_official_first(&mut store)?;
    save(directory, &store)?;
    Ok(store)
}

pub fn remove(directory: &Path, input_url: &str, reference: &str) -> Result<Store, String> {
    let (url, _, _) = repository(input_url)?;
    if url.eq_ignore_ascii_case(DEFAULT_URL) && reference == "main" {
        return Err("官方工作流来源常驻，无法移除".into());
    }
    let mut store = load(directory)?;
    let count = store.registries.len();
    store
        .registries
        .retain(|r| r.url != url || r.reference != reference);
    if store.registries.len() == count {
        return Err("此工作流来源不存在，请刷新后重试".into());
    }
    save(directory, &store)?;
    Ok(store)
}

pub fn install(directory: &Path, url: &str, reference: &str, id: &str) -> Result<Store, String> {
    let mut store = load(directory)?;
    let registry = store
        .registries
        .iter()
        .find(|r| r.url == url && r.reference == reference)
        .ok_or("请先同步工作流仓库")?;
    let workflow = registry
        .workflows
        .iter()
        .find(|w| w.id == id)
        .ok_or("该工作流不在已同步的仓库中")?
        .clone();
    workflow.validate()?;
    let item_key = key(url, reference, id);
    let input = store
        .installed
        .iter()
        .find(|w| w.key == item_key)
        .and_then(|w| w.input.clone());
    let hooks = store
        .installed
        .iter()
        .find(|w| w.key == item_key)
        .map(|w| w.hooks.clone())
        .unwrap_or_default();
    let item = Installed {
        key: item_key,
        registry_url: url.into(),
        reference: reference.into(),
        commit: if registry.bundled_ids.contains(id) {
            "bundled".into()
        } else {
            registry.commit.clone()
        },
        workflow,
        input,
        hooks,
    };
    store.uninstalled_keys.remove(&item.key);
    store.installed.retain(|w| w.key != item.key);
    store.installed.push(item);
    save(directory, &store)?;
    Ok(store)
}

pub fn uninstall(directory: &Path, installed_key: &str) -> Result<Store, String> {
    let mut store = load(directory)?;
    if !store.installed.iter().any(|w| w.key == installed_key) {
        return Err("工作流尚未安装".into());
    }
    store.installed.retain(|w| w.key != installed_key);
    store.uninstalled_keys.insert(installed_key.into());
    save(directory, &store)?;
    Ok(store)
}

pub fn configure(
    directory: &Path,
    installed_key: &str,
    mut input: Option<crate::send_input::SendInput>,
    mut hooks: crate::send_input::Hooks,
    secrets: &std::collections::BTreeMap<String, String>,
) -> Result<Store, String> {
    hooks.validate()?;
    if let Some(input) = &input {
        input.validate()?;
    }
    if input
        .as_ref()
        .is_some_and(|v| matches!(v.message, crate::send_input::Message::BeforeRun))
        && hooks
            .before_run
            .as_ref()
            .is_none_or(|h| matches!(h.response, crate::send_input::Response::Ignore))
    {
        return Err("请配置前置 Hook，并解析为文本或 JSON 字符串".into());
    }
    let mut store = load(directory)?;
    let item = store
        .installed
        .iter_mut()
        .find(|w| w.key == installed_key)
        .ok_or("请先安装工作流")?;
    if item.workflow.configurable() != input.is_some() {
        return Err("此工作流的发送参数缺失或不适用".into());
    }
    if let Some(input) = &mut input {
        input.save_secret(secrets.get("message").map(String::as_str))?;
    }
    hooks.save_secrets(secrets)?;
    item.input = input;
    item.hooks = hooks;
    save(directory, &store)?;
    Ok(store)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_published_workflow_matches_the_registry_and_native_contract() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let index: Index =
            serde_json::from_slice(&fs::read(root.join(INDEX_PATH)).unwrap()).unwrap();
        assert_eq!(index.schema_version, 1);
        let mut ids = BTreeSet::new();
        for entry in index.workflows {
            assert!(valid_path(&entry.path, &entry.id) && ids.insert(entry.id.clone()));
            let bytes = fs::read(root.join(&entry.path)).unwrap();
            assert_eq!(entry.sha256, format!("{:x}", Sha256::digest(&bytes)));
            assert_eq!(Workflow::parse(&bytes).unwrap().id, entry.id);
        }
        assert!(ids.contains("wechat-broadcast"));
    }

    #[test]
    fn input_and_hooks_belong_to_installation_and_survive_updates() {
        use crate::send_input::*;
        let dir = std::env::temp_dir().join(format!("por-inputs-{}", uuid::Uuid::new_v4()));
        let store = load(&dir).unwrap();
        let item = store
            .installed
            .iter()
            .find(|i| i.workflow.id == "wechat-broadcast")
            .unwrap();
        let input = SendInput {
            message: Message::Manual { text: "Ok".into() },
            recipients: Recipients {
                scope: Scope::Conversations,
                mode: Selection::Selected,
                names: vec!["文件传输助手".into()],
            },
            interval_ms: 1000,
        };
        let request = Request {
            url: "https://example.com/hook".into(),
            method: "POST".into(),
            query: vec![],
            headers: vec![],
            auth: Auth::None,
            body: Some(serde_json::json!({"status":"{{run.status}}"})),
            response: Response::Ignore,
            timeout_seconds: 5,
        };
        configure(
            &dir,
            &item.key,
            Some(input.clone()),
            Hooks {
                before_run: None,
                after_run: Some(request.clone()),
            },
            &Default::default(),
        )
        .unwrap();
        let installed = install(&dir, DEFAULT_URL, "main", "wechat-broadcast").unwrap();
        let updated = installed
            .installed
            .iter()
            .find(|i| i.key == item.key)
            .unwrap();
        assert_eq!(updated.input, Some(input));
        assert_eq!(updated.hooks.after_run, Some(request));
        assert!(!serde_json::to_string(&installed.registries)
            .unwrap()
            .contains("example.com/hook"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn uninstall_survives_reload_and_reinstall_clears_tombstone() {
        let dir = std::env::temp_dir().join(format!("por-uninstall-{}", uuid::Uuid::new_v4()));
        let original = load(&dir).unwrap();
        let key = original.installed[0].key.clone();
        let id = original.installed[0].workflow.id.clone();
        uninstall(&dir, &key).unwrap();
        assert!(!load(&dir).unwrap().installed.iter().any(|w| w.key == key));
        let mut store = load(&dir).unwrap();
        keep_official_first(&mut store).unwrap();
        save(&dir, &store).unwrap();
        assert!(!load(&dir).unwrap().installed.iter().any(|w| w.key == key));
        assert!(install(&dir, DEFAULT_URL, "main", &id)
            .unwrap()
            .installed
            .iter()
            .any(|w| w.key == key));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn official_registry_is_pinned_and_custom_removal_preserves_installed_workflows() {
        let dir = std::env::temp_dir().join(format!(
            "por-auto-registry-removal-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let mut store = load(&dir).unwrap();
        let mut custom = store.registries[0].clone();
        custom.url = "https://github.com/example/workflows".into();
        custom.name = "Custom workflows".into();
        store.registries.insert(0, custom.clone());
        save(&dir, &store).unwrap();
        assert_eq!(load(&dir).unwrap().registries[0].url, DEFAULT_URL);

        install(&dir, &custom.url, "main", "wechat-nickname").unwrap();
        let before = fs::read(dir.join("workflow-store.json")).unwrap();
        for url in [DEFAULT_URL, "https://github.com/GuyGuBaby/POR-AUTO.git"] {
            assert!(remove(&dir, url, "main").is_err());
        }
        assert_eq!(fs::read(dir.join("workflow-store.json")).unwrap(), before);
        let removed = remove(&dir, &custom.url, "main").unwrap();
        assert_eq!(removed.registries.len(), 1);
        assert_eq!(removed.registries[0].url, DEFAULT_URL);
        assert_eq!(removed.installed.len(), BUNDLED_WORKFLOWS.len() + 1);
        assert!(load(&dir)
            .unwrap()
            .installed
            .iter()
            .any(|w| w.registry_url == custom.url));

        let mut missing = load(&dir).unwrap();
        missing.registries.clear();
        save(&dir, &missing).unwrap();
        assert_eq!(load(&dir).unwrap().registries[0].url, DEFAULT_URL);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    #[ignore = "requires an authorized GitHub token and the published default registry"]
    fn private_github_registry_round_trip() {
        let token = std::env::var("POR_AUTO_GITHUB_TOKEN").expect("missing test credential");
        let directory =
            std::env::temp_dir().join(format!("por-auto-network-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let store = sync(&directory, DEFAULT_URL, "main", &token).unwrap();
        let remote = store
            .registries
            .iter()
            .find(|r| r.url == DEFAULT_URL)
            .unwrap();
        assert_eq!(remote.commit.len(), 40);
        assert!(remote.workflows.iter().any(|w| w.id == "wechat-open"));
        let installed = install(&directory, DEFAULT_URL, "main", "wechat-open").unwrap();
        assert_eq!(installed.installed.len(), BUNDLED_WORKFLOWS.len());
        let persisted = fs::read_to_string(directory.join("workflow-store.json")).unwrap();
        assert!(!persisted.contains(&token));
        assert!(load(&directory)
            .unwrap()
            .installed
            .iter()
            .any(|w| w.workflow.id == "wechat-open"));
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn only_github_root_addresses_are_accepted() {
        assert_eq!(
            repository("https://github.com/guygubaby/por-auto.git")
                .unwrap()
                .0,
            DEFAULT_URL
        );
        for url in [
            "https://github.com.evil.com/a/b",
            "https://token@github.com/a/b",
            "http://github.com/a/b",
            "https://github.com/a/b?token=x",
            "https://github.com/a/b/tree/main",
            "https://github.com/a/..",
        ] {
            assert!(repository(url).is_err(), "{url}");
        }
        assert!(!valid_path("workflows/../secret", "secret"));
        assert!(valid_path("workflows/demo/workflow.json", "demo"));
    }

    #[test]
    fn bundled_workflow_installs_offline_and_updates_without_replacing_others() {
        let dir =
            std::env::temp_dir().join(format!("por-auto-registry-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let mut store = load(&dir).unwrap();
        let original = store.installed[0].clone();
        store.registries[0].workflows[0].version = "1.0.1".into();
        store.registries[0].commit = "a".repeat(40);
        save(&dir, &store).unwrap();
        assert_eq!(
            load(&dir).unwrap().installed[0].workflow.version,
            original.workflow.version
        );
        let updated = install(&dir, DEFAULT_URL, "main", "wechat-nickname").unwrap();
        let updated_item = updated
            .installed
            .iter()
            .find(|w| w.key == original.key)
            .unwrap();
        assert_eq!(updated_item.workflow.version, "1.0.1");
        assert_eq!(updated.installed.len(), BUNDLED_WORKFLOWS.len());
        // A previous one-workflow installation gains examples without changing its pinned version.
        let mut legacy = updated;
        legacy.installed.retain(|w| w.key == original.key);
        legacy.registries[0].workflows.truncate(1);
        save(&dir, &legacy).unwrap();
        let migrated = load(&dir).unwrap();
        assert_eq!(migrated.installed.len(), BUNDLED_WORKFLOWS.len());
        assert_eq!(
            migrated
                .installed
                .iter()
                .find(|w| w.key == original.key)
                .unwrap()
                .workflow
                .version,
            "1.0.1"
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
