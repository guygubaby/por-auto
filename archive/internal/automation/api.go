package automation

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"github.com/google/uuid"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"time"
)

func (e *Engine) Call(ctx context.Context, command string, arg Object) (any, error) {
	switch command {
	case "check_environment":
		return e.Environment(ctx)
	case "initialize_environment":
		return e.Initialize(ctx)
	case "workflow_store":
		e.mu.Lock()
		defer e.mu.Unlock()
		return e.Store()
	case "active_runs":
		e.mu.Lock()
		defer e.mu.Unlock()
		view := map[string]any{}
		for serial := range e.active {
			if p, ok := e.progress[serial]; ok {
				view[serial] = clone(p)
			} else {
				view[serial] = Object{"serial": serial, "message": "等待执行", "step": 0, "total": 1}
			}
		}
		return view, nil
	case "run_workflow":
		e.mu.Lock()
		snapshot, err := e.installed(str(arg["workflowKey"]))
		e.mu.Unlock()
		if err != nil {
			return nil, err
		}
		// A page reload must not cancel a device mutation; explicit stop and app shutdown still do.
		return e.Run(context.WithoutCancel(ctx), str(arg["serial"]), snapshot, false)
	case "cancel_device_tasks":
		e.mu.Lock()
		defer e.mu.Unlock()
		for _, serial := range list(arg["serials"]) {
			if cancel := e.active[str(serial)]; cancel != nil {
				cancel()
			}
		}
		return nil, nil
	case "list_runs":
		return e.ListRuns()
	case "run_details":
		return e.RunDetails(str(arg["id"]))
	case "delete_runs":
		e.mu.Lock()
		if len(e.active) > 0 {
			e.mu.Unlock()
			return nil, errf("运行中不能删除记录")
		}
		e.mu.Unlock()
		for _, id := range list(arg["ids"]) {
			v := str(id)
			if _, err := e.RunDetails(v); err != nil {
				return nil, err
			}
			if err := os.RemoveAll(e.path("runs/" + v)); err != nil {
				return nil, err
			}
		}
		if e.Emit != nil {
			e.Emit("history-changed", nil)
		}
		return nil, nil
	case "vision_provider":
		return e.Provider()
	case "save_vision_provider":
		e.mu.Lock()
		defer e.mu.Unlock()
		if len(e.active) > 0 {
			return nil, errf("请等待任务完成再修改模型")
		}
		c := clone(arg["config"])
		if err := ValidateProvider(c); err != nil {
			return nil, err
		}
		if secret := str(arg["secret"]); secret != "" {
			id, err := e.Credentials.Save("vision", str(c["baseUrl"]), secret)
			if err != nil {
				return nil, err
			}
			c["credential"] = id
		} else if id := str(c["credential"]); id != "" {
			prior, err := e.Provider()
			if err != nil {
				return nil, err
			}
			if prior["credential"] != id || prior["baseUrl"] != c["baseUrl"] {
				return nil, errf("模型地址改变，请重新保存 API Key")
			}
		}
		return c, atomicJSON(e.path("vision-provider.json"), c)
	case "test_vision_provider":
		c := clone(arg["config"])
		if err := ValidateProvider(c); err != nil {
			return nil, err
		}
		c["allowScreenshots"] = true
		if str(arg["secret"]) != "" {
			id := uuid.NewString()
			e.Credentials.mu.Lock()
			e.Credentials.bindings[id] = str(c["baseUrl"])
			e.Credentials.cache["vision:"+id+":"+str(c["baseUrl"])] = credentialValue{Value: str(arg["secret"])}
			e.Credentials.mu.Unlock()
			c["credential"] = id
		}
		img := image.NewRGBA(image.Rect(0, 0, 32, 32))
		for y := 0; y < 32; y++ {
			for x := 0; x < 32; x++ {
				img.Set(x, y, color.RGBA{40, 160, 140, 255})
			}
		}
		var b bytes.Buffer
		_ = png.Encode(&b, img)
		started := now()
		vision := Vision{Config: c, Credentials: e.Credentials}
		if err := vision.CheckCapabilities(ctx); err != nil {
			return nil, err
		}
		v, err := vision.Observe(ctx, b.Bytes(), "This is a connection test. Return JSON {\"ok\":true}.")
		if err != nil {
			return nil, err
		}
		return Object{"ok": true, "elapsedMs": now() - started, "response": v}, nil
	case "test_http_request":
		r := NewRuntime(ctx, e.Credentials)
		spec := clone(arg["request"])
		if secret := str(arg["secret"]); secret != "" {
			a := object(spec["auth"])
			id := uuid.NewString()
			e.Credentials.mu.Lock()
			e.Credentials.bindings[id] = str(spec["url"])
			e.Credentials.cache["http:"+id+":"+str(spec["url"])] = credentialValue{Value: secret}
			e.Credentials.mu.Unlock()
			a["credential"] = id
		}
		return r.Call("request", "preview", spec, Object{"run": Object{"id": "preview", "status": "completed", "error": nil, "mode": "preview"}, "workflow": Object{"id": "test-workflow", "name": "测试工作流", "version": "1.0.0"}, "device": Object{"serial": "test-device"}, "recipient": Object{"title": "测试会话", "index": 1, "total": 1}, "outputs": Object{"nickname": "测试昵称"}}, r.IO())
	case "parse_http_response":
		raw := str(arg["raw"])
		if len(raw) > 1<<20 {
			return nil, errf("解析样本最多 1 MiB")
		}
		r := NewRuntime(ctx, e.Credentials)
		return r.Call("request", "parse", raw, object(arg["response"]), r.IO())
	case "list_schedules":
		if e.scheduler == nil {
			return nil, errf("定时服务未就绪")
		}
		return e.scheduler.View(), nil
	case "preview_cron":
		return Upcoming(str(arg["cron"]), str(arg["timezone"]), now(), 3)
	case "save_schedule":
		_, err := e.scheduler.Save(object(arg["input"]))
		if err != nil {
			return nil, err
		}
		return e.scheduler.View(), nil
	case "set_schedule_enabled":
		enabled := arg["enabled"] == true
		if err := e.scheduler.Change(str(arg["id"]), &enabled, false); err != nil {
			return nil, err
		}
		return e.scheduler.View(), nil
	case "delete_schedule":
		if err := e.scheduler.Change(str(arg["id"]), nil, true); err != nil {
			return nil, err
		}
		return e.scheduler.View(), nil
	case "run_schedule_now":
		if err := e.scheduler.RunNow(str(arg["id"])); err != nil {
			return nil, err
		}
		return e.scheduler.View(), nil
	case "list_wecom_targets":
		return e.scan(ctx, arg)
	case "sync_registry", "remove_registry", "install_workflow", "uninstall_workflow", "configure_workflow":
		return e.changeStore(ctx, command, arg)
	}
	return nil, fmt.Errorf("未知操作 %s", command)
}
func (e *Engine) changeStore(ctx context.Context, command string, arg Object) (any, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if len(e.active) > 0 || e.maintenance {
		return nil, errf("请等待设备任务或维护完成")
	}
	if command == "sync_registry" {
		return e.syncRegistry(ctx, arg)
	}
	store, err := e.Store()
	if err != nil {
		return nil, err
	}
	installed := list(store["installed"])
	key := str(arg["key"])
	switch command {
	case "remove_registry":
		if arg["url"] == OfficialURL && arg["reference"] == "main" {
			return nil, errf("官方来源不能移除")
		}
		regs := []any{}
		for _, r := range list(store["registries"]) {
			v := object(r)
			if v["url"] != arg["url"] || v["reference"] != arg["reference"] {
				regs = append(regs, v)
			}
		}
		store["registries"] = regs
	case "install_workflow":
		var entry Object
		for _, r := range list(store["registries"]) {
			reg := object(r)
			if reg["url"] != arg["url"] || reg["reference"] != arg["reference"] {
				continue
			}
			for _, v := range list(reg["workflows"]) {
				w := object(v)
				if w["id"] == arg["id"] {
					key = storeKey(str(reg["url"]), str(reg["reference"]), str(w["id"]))
					entry = Object{"key": key, "registryUrl": reg["url"], "reference": reg["reference"], "commit": reg["commit"], "workflow": w, "executionMode": "native", "dryRun": false, "hooks": Object{}}
				}
			}
		}
		if entry == nil {
			return nil, errf("来源中不存在此工作流")
		}
		if err = validateWorkflow(object(entry["workflow"])); err != nil {
			return nil, err
		}
		out := []any{}
		for _, v := range installed {
			old := object(v)
			if old["key"] != key {
				out = append(out, old)
			} else {
				for _, k := range []string{"input", "hooks", "executionMode"} {
					entry[k] = old[k]
				}
			}
		}
		store["installed"] = append(out, entry)
		blocked := []any{}
		for _, v := range list(store["uninstalledKeys"]) {
			if v != key {
				blocked = append(blocked, v)
			}
		}
		store["uninstalledKeys"] = blocked
	case "uninstall_workflow":
		if e.scheduler != nil {
			if err = e.scheduler.PauseWorkflow(key); err != nil {
				return nil, err
			}
		}
		out := []any{}
		for _, v := range installed {
			if object(v)["key"] != key {
				out = append(out, v)
			}
		}
		store["installed"] = out
		store["uninstalledKeys"] = append(list(store["uninstalledKeys"]), key)
	case "configure_workflow":
		found := false
		for _, v := range installed {
			item := object(v)
			if item["key"] != key {
				continue
			}
			found = true
			if arg["executionMode"] != "native" {
				return nil, errf("工作流仅使用原生无障碍控件")
			}
			item["input"] = arg["input"]
			item["hooks"] = arg["hooks"]
			item["dryRun"] = false
			item["executionMode"] = "native"
			secrets := object(arg["secrets"])
			save := func(spec Object, name string) error {
				if spec == nil {
					return nil
				}
				auth := object(spec["auth"])
				if auth["type"] == "none" {
					return nil
				}
				if secret := str(secrets[name]); secret != "" {
					id, err := e.Credentials.Save("http", str(spec["url"]), secret)
					if err != nil {
						return err
					}
					auth["credential"] = id
				} else {
					if _, err := e.Credentials.Read("http", str(auth["credential"]), str(spec["url"])); err != nil {
						return err
					}
				}
				return nil
			}
			if message := object(object(item["input"])["message"]); message["type"] == "http" {
				if err = save(object(message["request"]), "message"); err != nil {
					return nil, err
				}
			}
			for k, v := range object(item["hooks"]) {
				name := "before"
				if k == "afterRun" {
					name = "after"
				}
				if err = save(object(v), name); err != nil {
					return nil, err
				}
			}
			if err = NewRuntime(ctx, e.Credentials).ValidateConfig(item); err != nil {
				return nil, err
			}
		}
		if !found {
			return nil, errf("工作流不存在")
		}
	}
	if err = e.saveStore(store); err != nil {
		return nil, err
	}
	return store, nil
}
func (e *Engine) scan(ctx context.Context, arg Object) (any, error) {
	serial := str(arg["serial"])
	if !ValidSerial(serial) {
		return nil, errf("手机标识无效")
	}
	ctx, release, err := e.acquire(ctx, serial)
	if err != nil {
		return nil, err
	}
	defer release()
	adb, err := e.adbPath()
	if err != nil {
		return nil, err
	}
	a := ADB{Path: adb, Serial: serial}
	folder := e.path("recipient-scan/" + uuid.NewString())
	if err = os.MkdirAll(folder, 0700); err != nil {
		return nil, err
	}
	pkg := str(arg["package"])
	if pkg == "" {
		pkg = "com.tencent.wework"
	}
	if pkg != "com.tencent.wework" {
		return nil, errf("不支持的应用")
	}
	if arg["executionMode"] != nil && arg["executionMode"] != "native" {
		return nil, errf("工作流仅使用原生无障碍控件")
	}
	restore, err := a.WakeSession(ctx)
	if err != nil {
		return nil, err
	}
	defer restore()
	_, err = a.Shell(ctx, "input", "keyevent", "KEYCODE_WAKEUP")
	if err != nil {
		return nil, err
	}
	if _, err = a.Launch(ctx, pkg, ".launch.LaunchSplashActivity"); err != nil {
		return nil, err
	}
	_ = sleep(ctx, 1600*time.Millisecond)
	d := &DeviceIO{Ctx: ctx, ADB: a, Package: pkg, Folder: folder, RunID: "recipient-scan", Scope: "conversations"}
	jar, err := e.Asset("u2.jar")
	if err != nil {
		return nil, err
	}
	if _, err = e.Asset("u2-hint.dex"); err != nil {
		return nil, err
	}
	d.U2, err = StartU2(ctx, a, filepath.Dir(jar), folder)
	if err != nil {
		return nil, err
	}
	defer d.U2.Close()
	names, err := NewRuntime(ctx, e.Credentials).Discover(str(arg["scope"]), d)
	if err != nil {
		return nil, err
	}
	items := []any{}
	for _, n := range list(names) {
		items = append(items, Object{"title": n})
	}
	return Object{"items": items, "source": "当前手机会话列表", "scannedAt": now(), "complete": true}, nil
}
func Encode64(b []byte) string       { return base64.StdEncoding.EncodeToString(b) }
func SaveJSON(p string, v any) error { return atomicJSON(p, v) }
