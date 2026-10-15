use crate::workflow::{valid_id, Workflow, BUNDLED};
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
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub key: String,
    pub registry_url: String,
    pub reference: String,
    pub commit: String,
    pub workflow: Workflow,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub schema_version: u32,
    pub registries: Vec<Registry>,
    pub installed: Vec<Installed>,
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

pub fn load(directory: &Path) -> Result<Store, String> {
    let path = directory.join("workflow-store.json");
    if path.exists() {
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let store: Store = serde_json::from_slice(&bytes)
            .map_err(|_| "本地工作流配置无法读取，请保留文件并联系开发者")?;
        if store.schema_version != 1 {
            return Err("本地工作流配置版本不兼容".into());
        }
        for item in &store.installed {
            item.workflow.validate()?;
        }
        return Ok(store);
    }
    let workflow = Workflow::parse(BUNDLED.as_bytes())?;
    Ok(Store {
        schema_version: 1,
        registries: vec![Registry {
            url: DEFAULT_URL.into(),
            reference: "main".into(),
            name: "Por Auto 官方工作流".into(),
            commit: "bundled".into(),
            workflows: vec![workflow.clone()],
        }],
        installed: vec![Installed {
            key: key(DEFAULT_URL, "main", &workflow.id),
            registry_url: DEFAULT_URL.into(),
            reference: "main".into(),
            commit: "bundled".into(),
            workflow,
        }],
    })
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
    };
    store
        .registries
        .retain(|r| r.url != url || r.reference != reference);
    store.registries.push(registry);
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
    let item = Installed {
        key: key(url, reference, id),
        registry_url: url.into(),
        reference: reference.into(),
        commit: registry.commit.clone(),
        workflow,
    };
    store.installed.retain(|w| w.key != item.key);
    store.installed.push(item);
    save(directory, &store)?;
    Ok(store)
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(installed.installed.len(), 2);
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
        assert_eq!(load(&dir).unwrap().installed[0].workflow.version, "1.0.0");
        let updated = install(&dir, DEFAULT_URL, "main", "wechat-nickname").unwrap();
        assert_eq!(updated.installed[0].workflow.version, "1.0.1");
        assert_eq!(updated.installed[0].key, original.key);
        assert_eq!(updated.installed.len(), 1);
        fs::remove_dir_all(dir).unwrap();
    }
}
