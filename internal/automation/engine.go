package automation

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"por-auto/assets"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const OfficialURL = "https://github.com/guygubaby/por-auto"
const Version = "0.4.0"

type Engine struct {
	Root        string
	Emit        func(string, any)
	Credentials *Credentials
	mu          sync.Mutex
	assetsMu    sync.Mutex
	maintenance bool
	closing     bool
	active      map[string]context.CancelFunc
	progress    map[string]Object
	slots       chan struct{}
	scheduler   *Scheduler
	lanes       map[string][]*queuedJob
	wg          sync.WaitGroup
}

func NewEngine(root string, emit func(string, any)) *Engine {
	return &Engine{Root: root, Emit: emit, Credentials: NewCredentials(), active: map[string]context.CancelFunc{}, progress: map[string]Object{}, slots: make(chan struct{}, 4), lanes: map[string][]*queuedJob{}}
}
func (e *Engine) Start() error {
	if err := os.MkdirAll(e.Root, 0700); err != nil {
		return err
	}
	s, err := NewScheduler(e)
	if err != nil {
		return err
	}
	e.scheduler = s
	return nil
}
func (e *Engine) Close() {
	e.mu.Lock()
	e.closing = true
	for _, cancel := range e.active {
		cancel()
	}
	e.mu.Unlock()
	if e.scheduler != nil {
		e.scheduler.Close()
	}
	e.wg.Wait()
}
func (e *Engine) path(s string) string { return filepath.Join(e.Root, s) }
func loadFile(path string, fallback any) (any, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return fallback, nil
	}
	if err != nil {
		return nil, err
	}
	var v any
	if err = json.Unmarshal(b, &v); err != nil {
		return nil, fmt.Errorf("本地文件 %s 无法解析，已保留原文件", filepath.Base(path))
	}
	return v, nil
}
func (e *Engine) Asset(name string) (string, error) {
	e.assetsMu.Lock()
	defer e.assetsMu.Unlock()
	b, err := assets.Files.ReadFile(name)
	if err != nil {
		return "", err
	}
	p := e.path("components/" + name)
	if err = os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return "", err
	}
	if old, _ := os.ReadFile(p); !bytes.Equal(old, b) {
		if err = os.WriteFile(p, b, 0600); err != nil {
			return "", err
		}
	}
	return p, nil
}
func (e *Engine) adbPath() (string, error) {
	exe := "adb"
	if runtime.GOOS == "windows" {
		exe = "adb.exe"
	}
	p := e.path("components/platform-tools-37.0.1/" + exe)
	if _, err := os.Stat(p); err != nil {
		return "", errf("请先初始化连接组件")
	}
	return p, nil
}
func (e *Engine) Environment(ctx context.Context) (Object, error) {
	p, err := e.adbPath()
	if err != nil {
		return Object{"ready": false, "version": "37.0.1", "platform": runtime.GOOS, "devices": []Device{}, "automation_version": "0.4.0"}, nil
	}
	a := ADB{Path: p}
	v, err := a.Text(ctx, "version")
	if err != nil || !strings.Contains(v, "Android Debug Bridge") {
		return nil, errf("连接组件不可用，请重新初始化")
	}
	devices, err := a.Text(ctx, "devices", "-l")
	if err != nil {
		return nil, err
	}
	return Object{"ready": true, "version": "37.0.1", "platform": runtime.GOOS, "devices": ParseDevices(devices), "automation_version": "0.4.0"}, nil
}
func (e *Engine) Initialize(ctx context.Context) (Object, error) {
	e.mu.Lock()
	if len(e.active) > 0 || e.maintenance {
		e.mu.Unlock()
		return nil, errf("请等待当前任务完成")
	}
	e.maintenance = true
	e.mu.Unlock()
	defer func() { e.mu.Lock(); e.maintenance = false; e.mu.Unlock() }()
	b, err := assets.Files.ReadFile("platform-tools.zip")
	if err != nil {
		return nil, err
	}
	metaB, _ := assets.Files.ReadFile("adb-manifest.json")
	var meta Object
	_ = json.Unmarshal(metaB, &meta)
	expected := "macos"
	if runtime.GOOS == "windows" {
		expected = "windows"
	}
	if meta["platform"] != expected {
		return nil, errf("安装包连接组件与当前系统不匹配")
	}
	h := sha256.Sum256(b)
	if hex.EncodeToString(h[:]) != meta["sha256"] {
		return nil, errf("连接组件摘要校验失败")
	}
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, err
	}
	dest := e.path("components/platform-tools-37.0.1")
	if err = os.MkdirAll(dest, 0700); err != nil {
		return nil, err
	}
	for _, f := range z.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if f.FileInfo().Mode()&os.ModeSymlink != 0 || f.UncompressedSize64 > 100*1024*1024 {
			return nil, errf("连接组件包含无效文件")
		}
		name := strings.TrimPrefix(f.Name, "platform-tools/")
		if name == f.Name || filepath.IsAbs(name) || strings.Contains(name, "..") || strings.Contains(name, "\\") {
			return nil, errf("连接组件路径无效")
		}
		target := filepath.Join(dest, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return nil, err
		}
		r, er := f.Open()
		if er != nil {
			return nil, er
		}
		data, er := io.ReadAll(io.LimitReader(r, 100*1024*1024+1))
		r.Close()
		if er != nil || len(data) > 100*1024*1024 {
			return nil, errf("连接组件解压失败")
		}
		mode := os.FileMode(0600)
		if name == "adb" {
			mode = 0700
		}
		if err = os.WriteFile(target, data, mode); err != nil {
			return nil, err
		}
	}
	for _, name := range []string{"u2.jar", "u2-hint.dex"} {
		if _, err = e.Asset(name); err != nil {
			return nil, err
		}
	}
	return e.Environment(ctx)
}
func storeKey(u, ref, id string) string {
	h := sha256.Sum256([]byte(u + "\n" + ref + "\n" + id))
	return hex.EncodeToString(h[:])
}
func bundled() ([]any, error) {
	files, err := assets.Files.ReadDir("workflows")
	if err != nil {
		return nil, err
	}
	result := []any{}
	for _, f := range files {
		b, err := assets.Files.ReadFile("workflows/" + f.Name())
		if err != nil {
			return nil, err
		}
		var w Object
		if err = json.Unmarshal(b, &w); err != nil {
			return nil, err
		}
		result = append(result, w)
	}
	return result, nil
}
func supportedWorkflow(w Object) bool {
	return str(w["package"]) == "com.tencent.wework"
}
func supportedWorkflows(values []any) []any {
	result := []any{}
	for _, value := range values {
		if supportedWorkflow(object(value)) {
			result = append(result, value)
		}
	}
	return result
}
func validateWorkflow(w Object) error {
	_, err := NewRuntime(context.Background(), nil).Call("core", "validateWorkflow", w)
	return err
}
func (e *Engine) Store() (Object, error) {
	v, err := loadFile(e.path("workflow-store.json"), nil)
	if err != nil {
		return nil, err
	}
	if v == nil {
		v, err = loadFile(e.path("registry.json"), nil)
		if err != nil {
			return nil, err
		}
	}
	var store Object
	if v == nil {
		store = Object{"schemaVersion": 1, "registries": []any{}, "installed": []any{}, "uninstalledKeys": []any{}}
	} else {
		store = object(v)
		if num(store["schemaVersion"]) != 1 {
			return nil, errf("本地工作流配置版本不兼容，已保留原文件")
		}
	}
	ws, err := bundled()
	if err != nil {
		return nil, err
	}
	regs := list(store["registries"])
	installed := []any{}
	for _, value := range list(store["installed"]) {
		if supportedWorkflow(object(object(value)["workflow"])) {
			installed = append(installed, value)
		}
	}
	blocked := map[string]bool{}
	for _, v := range list(store["uninstalledKeys"]) {
		blocked[str(v)] = true
	}
	official := Object{"url": OfficialURL, "reference": "main", "name": "Por Auto 官方工作流", "commit": "bundled", "workflows": []any{}}
	other := []any{}
	for _, r := range regs {
		object(r)["workflows"] = supportedWorkflows(list(object(r)["workflows"]))
		if strings.EqualFold(str(object(r)["url"]), OfficialURL) && object(r)["reference"] == "main" {
			official = object(r)
		} else {
			other = append(other, r)
		}
	}
	catalog := list(official["workflows"])
	for _, w := range ws {
		found := false
		for i, prior := range catalog {
			if object(prior)["id"] == object(w)["id"] {
				found = true
				if official["commit"] == "bundled" {
					catalog[i] = w
				}
			}
		}
		if !found {
			catalog = append(catalog, w)
		}
	}
	official["workflows"] = catalog
	regs = append([]any{official}, other...)
	for _, w := range ws {
		id := str(object(w)["id"])
		key := storeKey(OfficialURL, "main", id)
		exists := false
		for _, i := range installed {
			if object(i)["key"] == key {
				exists = true
			}
		}
		if !exists && !blocked[key] {
			installed = append(installed, Object{"key": key, "registryUrl": OfficialURL, "reference": "main", "commit": "bundled", "workflow": w, "executionMode": "native", "dryRun": sends(object(w)), "hooks": Object{}})
		}
	}
	store["registries"] = regs
	store["installed"] = installed
	for _, v := range installed {
		if err = validateWorkflow(object(object(v)["workflow"])); err != nil {
			return nil, err
		}
		object(v)["executionMode"] = "native"
		e.Credentials.BindConfig(object(v))
	}
	return store, nil
}
func sends(w Object) bool {
	for _, s := range list(w["steps"]) {
		if strings.Contains("|chat_send_text|chat_broadcast|", "|"+str(object(object(s)["action"])["type"])+"|") {
			return true
		}
	}
	return false
}
func (e *Engine) saveStore(store Object) error {
	return atomicJSON(e.path("workflow-store.json"), store)
}
func (e *Engine) installed(key string) (Object, error) {
	s, err := e.Store()
	if err != nil {
		return nil, err
	}
	for _, v := range list(s["installed"]) {
		if object(v)["key"] == key {
			return clone(v), nil
		}
	}
	return nil, errf("工作流尚未安装")
}
func validOrigin(input, ref string) (string, string, error) {
	u, err := url.Parse(input)
	if err != nil || u.Scheme != "https" || u.Host != "github.com" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", "", errf("仅支持 GitHub HTTPS 仓库根地址")
	}
	p := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(p) != 2 {
		return "", "", errf("请填写 GitHub 仓库根地址")
	}
	valid := regexp.MustCompile(`^[a-zA-Z0-9_.-]{1,100}$`)
	if !valid.MatchString(p[0]) || !valid.MatchString(p[1]) || strings.Contains(p[0], "..") || strings.Contains(p[1], "..") {
		return "", "", errf("仓库地址无效")
	}
	if ref == "" || len(ref) > 160 || strings.Contains(ref, "..") || !regexp.MustCompile(`^[a-zA-Z0-9_./-]+$`).MatchString(ref) {
		return "", "", errf("分支名称无效")
	}
	return p[0], strings.TrimSuffix(p[1], ".git"), nil
}
func githubGet(ctx context.Context, path, token string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/"+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.raw+json")
	req.Header.Set("User-Agent", "PorAuto/"+Version)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := &http.Client{Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errf("GitHub 请求失败，请检查网络")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errf("GitHub 文件过大或不可读")
	}
	return b, nil
}
func (e *Engine) syncRegistry(ctx context.Context, arg Object) (Object, error) {
	u, ref, token := str(arg["url"]), str(arg["reference"]), str(arg["token"])
	owner, repo, err := validOrigin(u, ref)
	if err != nil {
		return nil, err
	}
	prefix := owner + "/" + repo
	raw, err := githubGet(ctx, prefix+"/commits?sha="+url.QueryEscape(ref)+"&per_page=1", token, 524288)
	if err != nil {
		return nil, err
	}
	var commits []Object
	if json.Unmarshal(raw, &commits) != nil || len(commits) != 1 {
		return nil, errf("GitHub 提交无法读取")
	}
	sha := str(commits[0]["sha"])
	if !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(sha) {
		return nil, errf("提交标识无效")
	}
	raw, err = githubGet(ctx, prefix+"/contents/workflows/registry.json?ref="+sha, token, 262144)
	if err != nil {
		return nil, err
	}
	var index Object
	if json.Unmarshal(raw, &index) != nil || num(index["schemaVersion"]) != 1 {
		return nil, errf("Registry 格式无效")
	}
	entries := list(index["workflows"])
	if len(entries) < 1 || len(entries) > 100 {
		return nil, errf("Registry 数量无效")
	}
	var workflows []any
	for _, v := range entries {
		entry := object(v)
		id := str(entry["id"])
		p := str(entry["path"])
		if p != "workflows/"+id+"/workflow.json" || !regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`).MatchString(id) {
			return nil, errf("工作流路径无效")
		}
		raw, err = githubGet(ctx, prefix+"/contents/"+p+"?ref="+sha, token, 262144)
		if err != nil {
			return nil, err
		}
		h := sha256.Sum256(raw)
		if hex.EncodeToString(h[:]) != entry["sha256"] {
			return nil, errf("工作流完整性校验失败")
		}
		var w Object
		if json.Unmarshal(raw, &w) != nil {
			return nil, errf("工作流 JSON 无效")
		}
		if w["id"] != id {
			return nil, errf("工作流标识与目录索引不一致")
		}
		if err = validateWorkflow(w); err != nil {
			return nil, err
		}
		workflows = append(workflows, w)
	}
	store, err := e.Store()
	if err != nil {
		return nil, err
	}
	regs := []any{}
	for _, v := range list(store["registries"]) {
		r := object(v)
		if r["url"] != u || r["reference"] != ref {
			regs = append(regs, r)
		}
	}
	regs = append(regs, Object{"url": u, "reference": ref, "name": index["name"], "commit": sha, "workflows": workflows})
	store["registries"] = regs
	return store, e.saveStore(store)
}
func (e *Engine) Provider() (Object, error) {
	v, err := loadFile(e.path("vision-provider.json"), nil)
	if err != nil || v == nil {
		return nil, err
	}
	c := object(v)
	if id := str(c["credential"]); id != "" {
		e.Credentials.Bind(id, str(c["baseUrl"]))
	}
	return c, nil
}
func ValidateProvider(c Object) error {
	endpoint := str(c["baseUrl"])
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return errf("请填写有效的 HTTP 或 HTTPS 模型接口根地址，不在地址中包含鉴权、查询参数或片段")
	}
	if str(c["model"]) == "" || num(c["timeoutSeconds"]) < 5 || num(c["timeoutSeconds"]) > 600 {
		return errf("请填写模型名称和 5～600 秒超时")
	}
	return nil
}
func (e *Engine) newRunFolder() (string, string, error) {
	id := fmt.Sprint(now())
	folder := e.path("runs/" + id)
	for n := 0; ; n++ {
		err := os.Mkdir(folder, 0700)
		if os.IsNotExist(err) {
			if er := os.MkdirAll(e.path("runs"), 0700); er != nil {
				return "", "", er
			}
			continue
		}
		if os.IsExist(err) {
			id = fmt.Sprint(now() + int64(n) + 1)
			folder = e.path("runs/" + id)
			continue
		}
		if err != nil {
			return "", "", err
		}
		break
	}
	return id, folder, nil
}
func (e *Engine) Run(ctx context.Context, serial string, snapshot Object, scheduled bool) (Object, error) {
	if !ValidSerial(serial) {
		return nil, errf("手机标识无效")
	}
	runCtx, release, err := e.acquire(ctx, serial)
	if err != nil {
		return nil, err
	}
	defer release()
	e.mu.Lock()
	_, err = e.installed(str(snapshot["key"]))
	e.mu.Unlock()
	if err != nil {
		return nil, err
	}
	w := object(snapshot["workflow"])
	if err := validateWorkflow(w); err != nil {
		return nil, err
	}
	if snapshot["executionMode"] != nil && snapshot["executionMode"] != "native" && snapshot["executionMode"] != "visual" {
		return nil, errf("执行方式无效")
	}
	snapshot = clone(snapshot)
	snapshot["executionMode"] = "native"
	if err := NewRuntime(runCtx, e.Credentials).ValidateConfig(snapshot); err != nil {
		return nil, err
	}
	id, folder, err := e.newRunFolder()
	if err != nil {
		return nil, err
	}
	meta := Object{"id": id, "workflow_name": w["name"], "workflow_version": w["version"], "serial": serial, "timestamp": now(), "status": "running", "dry_run": snapshot["dryRun"] == true}
	if err := atomicJSON(filepath.Join(folder, "meta.json"), meta); err != nil {
		return nil, err
	}
	if err := atomicJSON(filepath.Join(folder, "workflow.json"), w); err != nil {
		return nil, err
	}
	if err := atomicJSON(filepath.Join(folder, "input.json"), snapshot); err != nil {
		return nil, err
	}
	result := Object{"id": id, "nickname": nil, "outputs": Object{}, "workflow_name": w["name"], "workflow_version": w["version"], "workflow_key": snapshot["key"], "commit": snapshot["commit"], "serial": serial, "timestamp": now(), "screenshot": nil, "error": nil, "warning": nil, "folder": folder}
	runErr := func() error {
		adb, err := e.adbPath()
		if err != nil {
			return err
		}
		a := ADB{Path: adb, Serial: serial}
		restore, err := a.WakeSession(runCtx)
		if err != nil {
			return err
		}
		defer func() {
			if er := restore(); er != nil {
				result["warning"] = er.Error()
			}
		}()
		config := clone(snapshot)
		config["dryRun"] = snapshot["dryRun"] == true
		if config["hooks"] == nil {
			config["hooks"] = Object{}
		}
		if config["input"] == nil {
			config["input"] = Object{"message": Object{"type": "manual", "text": ""}, "recipients": Object{"direct": false, "groups": true}, "intervalMs": 1000}
		}
		d := &DeviceIO{Ctx: runCtx, ADB: a, Package: str(w["package"]), Folder: folder, RunID: id, WorkflowKey: str(snapshot["key"]), Scope: "conversations", Total: len(list(w["steps"]))}
		d.Emit = func(name string, v any) {
			p := object(v)
			p["scheduled"] = scheduled
			e.mu.Lock()
			e.progress[serial] = clone(p)
			e.mu.Unlock()
			if e.Emit != nil {
				e.Emit(name, p)
			}
		}
		jar, err := e.Asset("u2.jar")
		if err != nil {
			return err
		}
		if _, err = e.Asset("u2-hint.dex"); err != nil {
			return err
		}
		d.U2, err = StartU2(runCtx, a, filepath.Dir(jar), folder)
		if err != nil {
			return err
		}
		defer d.U2.Close()
		r := NewRuntime(runCtx, e.Credentials)
		outputs, err := r.Run(w, config, d)
		if outputs != nil {
			result["outputs"] = outputs
			result["nickname"] = outputs["nickname"]
		}
		return err
	}()
	if runErr != nil {
		result["error"] = runErr.Error()
		meta["error"] = runErr.Error()
		meta["status"] = "failed"
	} else {
		meta["status"] = "completed"
	}
	if err := atomicJSON(filepath.Join(folder, "meta.json"), meta); err != nil {
		return nil, err
	}
	if err := atomicJSON(filepath.Join(folder, "desktop-result.json"), result); err != nil {
		return nil, err
	}
	if e.Emit != nil {
		e.Emit("history-changed", nil)
	}
	return result, nil
}
func (e *Engine) ListRuns() ([]any, error) {
	entries, err := os.ReadDir(e.path("runs"))
	if os.IsNotExist(err) {
		return []any{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []any{}
	for _, f := range entries {
		if f.Type()&os.ModeSymlink != 0 || !f.IsDir() || !regexp.MustCompile(`^\d{1,20}$`).MatchString(f.Name()) {
			continue
		}
		v, err := loadFile(e.path("runs/"+f.Name()+"/meta.json"), nil)
		if err != nil {
			return nil, err
		}
		if v != nil {
			m := object(v)
			if m["status"] == "running" {
				serial := str(m["serial"])
				e.mu.Lock()
				active := e.active[serial] != nil
				e.mu.Unlock()
				if schedule := str(m["schedule_id"]); schedule != "" && e.scheduler != nil {
					e.scheduler.mu.Lock()
					active = e.scheduler.running[schedule]
					e.scheduler.mu.Unlock()
				}
				if !active {
					m["status"] = "interrupted"
					m["error"] = "执行已中断，未自动重试"
				}
			}
			out = append(out, m)
		}
	}
	sort.Slice(out, func(i, j int) bool { return num(object(out[i])["timestamp"]) > num(object(out[j])["timestamp"]) })
	return out, nil
}
func (e *Engine) RunDetails(id string) (Object, error) {
	if !regexp.MustCompile(`^\d{1,20}$`).MatchString(id) {
		return nil, errf("运行记录标识无效")
	}
	folder := e.path("runs/" + id)
	info, err := os.Lstat(folder)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errf("运行记录不存在")
	}
	summary, err := loadFile(filepath.Join(folder, "meta.json"), nil)
	if err != nil {
		return nil, err
	}
	result, err := loadFile(filepath.Join(folder, "desktop-result.json"), nil)
	if err != nil {
		return nil, err
	}
	if result == nil {
		result, err = loadFile(filepath.Join(folder, "result.json"), nil)
		if err != nil {
			return nil, err
		}
	}
	targets, err := loadFile(filepath.Join(folder, "targets.json"), []any{})
	if err != nil {
		return nil, err
	}
	for _, t := range list(targets) {
		m := object(t)
		if m["status"] == "sending" {
			m["status"] = "uncertain"
			m["error"] = "运行中断，发送结果待核对，未自动重发"
		}
		if m["status"] == "rehearsing" {
			m["status"] = "skipped"
			m["error"] = "预演中断，未触发发送；请在手机核对是否留有本轮草稿"
		}
	}
	logs := []any{}
	raw, _ := os.ReadFile(filepath.Join(folder, "events.jsonl"))
	for _, line := range strings.Split(string(raw), "\n") {
		var v any
		if json.Unmarshal([]byte(line), &v) == nil {
			logs = append(logs, v)
		} else if strings.TrimSpace(line) != "" {
			logs = append(logs, Object{"timestamp": now(), "status": "incomplete", "message": "日志末尾未写完，可能因进程中断"})
		}
	}
	details := Object{"summary": summary, "result": result, "events": logs, "logs": logs, "targets": targets, "folder": folder}
	for _, name := range []string{"workflow", "input", "batch"} {
		value, err := loadFile(filepath.Join(folder, name+".json"), nil)
		if err != nil {
			return nil, err
		}
		details[name] = value
	}
	diagnostics := Object{}
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		textEvidence := ext == ".xml" || ext == ".log" || (ext == ".json" || ext == ".txt") && (strings.Contains(name, "observation") || strings.HasPrefix(name, "visual-"))
		if entry.Type()&os.ModeSymlink != 0 || entry.IsDir() || !textEvidence {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		if info.Size() > 1<<20 {
			diagnostics[name] = "[证据超过 1 MiB，请查看本机目录]"
			continue
		}
		b, err := os.ReadFile(filepath.Join(folder, name))
		if err != nil {
			return nil, err
		}
		diagnostics[name] = string(b)
	}
	if details["batch"] == nil && object(summary)["schedule_id"] != nil {
		details["batch"] = result
	}
	details["diagnostics"] = diagnostics
	return details, nil
}
