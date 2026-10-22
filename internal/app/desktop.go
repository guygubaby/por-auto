package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/egoist/mygo"
	"os"
	"path/filepath"
	"por-auto/assets"
	"por-auto/internal/automation"
	"runtime"
	"sync"
	"time"
)

var Changed = mygo.NewEvent[map[string]any]("desktop-changed")

type Desktop struct {
	engine       *automation.Engine
	mu           sync.Mutex
	update       *mygo.Update
	updateStatus map[string]any
	root         string
	started      bool
	stop         chan struct{}
}

func New() *Desktop {
	return &Desktop{updateStatus: map[string]any{"phase": "idle", "currentVersion": automation.Version, "autoCheck": true, "downloaded": 0}}
}
func DataDir() (string, error) {
	return dataDir(runtime.GOOS)
}
func dataDir(platform string) (string, error) {
	if override := os.Getenv("POR_AUTO_DATA_DIR"); override != "" {
		return filepath.Abs(override)
	}
	// Keep the former client's LocalAppData location on Windows.
	if platform == "windows" {
		if root := os.Getenv("LOCALAPPDATA"); root != "" {
			return filepath.Join(root, "com.por.wechatreader"), nil
		}
		return "", errors.New("无法确定 Windows 本地应用数据目录")
	}
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "com.por.wechatreader"), nil
}
func (d *Desktop) start() error {
	root, err := DataDir()
	if err != nil {
		return err
	}
	d.root = root
	mygo.App.SetPath(mygo.PathUserData, root)
	d.engine = automation.NewEngine(root, func(name string, value any) { _ = Changed.Broadcast(map[string]any{"name": name, "payload": value}) })
	if err = d.engine.Start(); err != nil {
		return err
	}
	d.started = true
	d.stop = make(chan struct{})
	go d.updateLoop()
	settings := d.readSettings()
	theme, _ := settings["theme"].(string)
	if theme == "light" {
		mygo.Theme.SetSource(mygo.ThemeLight)
	} else if theme == "dark" {
		mygo.Theme.SetSource(mygo.ThemeDark)
	} else {
		mygo.Theme.SetSource(mygo.ThemeSystem)
	}
	return nil
}
func (d *Desktop) readSettings() map[string]any {
	v := map[string]any{"theme": "system", "autoCheck": true}
	b, err := os.ReadFile(filepath.Join(d.root, "ui-settings.json"))
	if os.IsNotExist(err) {
		b, err = os.ReadFile(filepath.Join(d.root, "update-settings.json"))
	}
	if err == nil {
		if json.Unmarshal(b, &v) != nil || v == nil {
			v = map[string]any{"theme": "system", "autoCheck": true}
		}
	}
	if v["theme"] != "light" && v["theme"] != "dark" && v["theme"] != "system" {
		v["theme"] = "system"
	}
	if _, ok := v["autoCheck"].(bool); !ok {
		v["autoCheck"] = true
	}
	return v
}
func (d *Desktop) Call(ctx context.Context, command string, args map[string]any) (any, error) {
	if !d.started {
		return nil, errors.New("桌面服务正在启动")
	}
	switch command {
	case "ui_settings":
		d.mu.Lock()
		defer d.mu.Unlock()
		return d.readSettings(), nil
	case "set_theme":
		theme, _ := args["theme"].(string)
		if theme != "system" && theme != "light" && theme != "dark" {
			return nil, errors.New("主题只支持浅色、深色或跟随系统")
		}
		d.mu.Lock()
		defer d.mu.Unlock()
		settings := d.readSettings()
		settings["theme"] = theme
		if err := automation.SaveJSON(filepath.Join(d.root, "ui-settings.json"), settings); err != nil {
			return nil, err
		}
		mygo.Theme.SetSource(mygo.ThemeSource(theme))
		return settings, nil
	case "open_results":
		if err := os.MkdirAll(filepath.Join(d.root, "runs"), 0700); err != nil {
			return nil, err
		}
		return nil, mygo.Shell.OpenPath(filepath.Join(d.root, "runs"))
	case "export_runs":
		ids, _ := args["ids"].([]any)
		if len(ids) == 0 || len(ids) > 100 {
			return nil, errors.New("每次请选择 1 至 100 条记录导出")
		}
		records := []any{}
		size := 0
		for _, id := range ids {
			value, err := d.engine.RunDetails(fmt.Sprint(id))
			if err != nil {
				return nil, err
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				return nil, err
			}
			size += len(encoded)
			if size > 64*1024*1024 {
				return nil, errors.New("所选记录超过 64 MiB，请分批导出")
			}
			records = append(records, value)
		}
		path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "导出运行记录", DefaultPath: "PorAuto-results.json", Filters: []mygo.FileFilter{{Name: "JSON", Extensions: []string{"json"}}}})
		if err != nil || path == "" {
			return nil, err
		}
		return path, automation.SaveJSON(path, map[string]any{"schemaVersion": 1, "appVersion": automation.Version, "exportedAt": time.Now().UnixMilli(), "records": records})
	case "open_mobile_runtime":
		return nil, mygo.Shell.OpenExternal("https://github.com/SuperMonster003/AutoJs6/releases")
	case "export_mobile_scripts":
		kind, _ := args["kind"].(string)
		mapping := map[string][2]string{"launcher": {"mobile/bootstrap.js", "PorAuto-AutoJs6-bootstrap.js"}, "workflows": {"mobile/offline-bundle.json", "PorAuto-mobile-scripts.json"}, "input": {"por-input.apk", "PorAuto-input.apk"}}
		pair, ok := mapping[kind]
		if !ok {
			return nil, errors.New("导出类型无效")
		}
		b, err := assets.Files.ReadFile(pair[0])
		if err != nil {
			return nil, err
		}
		path, err := mygo.Dialog.Save(mygo.SaveDialogOptions{Parent: mygo.CallerWindow(ctx), Title: "保存手机组件", DefaultPath: pair[1]})
		if err != nil || path == "" {
			return nil, err
		}
		if err = os.WriteFile(path, b, 0600); err != nil {
			return nil, err
		}
		return path, nil
	case "update_status":
		d.mu.Lock()
		defer d.mu.Unlock()
		return d.statusCopy(), nil
	case "set_auto_update_check":
		d.mu.Lock()
		defer d.mu.Unlock()
		settings := d.readSettings()
		settings["autoCheck"] = args["enabled"] == true
		if err := automation.SaveJSON(filepath.Join(d.root, "ui-settings.json"), settings); err != nil {
			return nil, err
		}
		d.updateStatus["autoCheck"] = settings["autoCheck"]
		return d.statusCopy(), nil
	case "check_for_updates":
		return d.checkUpdates(ctx)
	case "install_app_update":
		if active, err := d.engine.Call(ctx, "active_runs", nil); err != nil || len(active.(map[string]any)) > 0 {
			return nil, errors.New("请等待设备任务完成后安装更新")
		}
		d.mu.Lock()
		update := d.update
		d.mu.Unlock()
		if update == nil {
			return nil, errors.New("请先检查可用更新")
		}
		err := d.engine.Maintain(func() error {
			return update.Install(ctx, func(downloaded, total int64) {
				d.mu.Lock()
				d.updateStatus["phase"] = "downloading"
				d.updateStatus["downloaded"] = downloaded
				d.updateStatus["total"] = total
				v := map[string]any{}
				for k, x := range d.updateStatus {
					v[k] = x
				}
				d.mu.Unlock()
				_ = Changed.Broadcast(map[string]any{"name": "app-update-status", "payload": v})
			})
		})
		if err != nil {
			d.mu.Lock()
			d.updateStatus["phase"] = "error"
			d.updateStatus["error"] = err.Error()
			d.mu.Unlock()
			return nil, err
		}
		mygo.App.Relaunch()
		return nil, nil
	}
	return d.engine.Call(ctx, command, args)
}
func (d *Desktop) checkUpdates(ctx context.Context) (any, error) {
	d.mu.Lock()
	if d.updateStatus["phase"] == "checking" || d.updateStatus["phase"] == "downloading" {
		v := d.statusCopy()
		d.mu.Unlock()
		return v, nil
	}
	d.updateStatus["phase"] = "checking"
	d.mu.Unlock()
	up, err := mygo.Updater.Check(ctx)
	d.mu.Lock()
	defer d.mu.Unlock()
	d.updateStatus["checkedAt"] = time.Now().UnixMilli()
	if err != nil {
		d.updateStatus["phase"] = "error"
		d.updateStatus["error"] = err.Error()
		return d.statusCopy(), nil
	}
	delete(d.updateStatus, "error")
	d.update = up
	if up == nil {
		d.updateStatus["phase"] = "up_to_date"
		delete(d.updateStatus, "version")
		delete(d.updateStatus, "notes")
	} else {
		d.updateStatus["phase"] = "available"
		d.updateStatus["version"] = up.Version
		d.updateStatus["notes"] = up.Notes
	}
	return d.statusCopy(), nil
}
func Run() {
	d := New()
	mygo.BindAs("Desktop", d)
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	mygo.App.WhenReady(func() {
		if err := d.start(); err != nil {
			mygo.Dialog.Message(mygo.MessageOptions{Title: "Por Auto 无法启动", Message: err.Error()})
			return
		}
		win := mygo.NewWindow(mygo.WindowOptions{Title: "Por Auto", URL: "/", Width: 1240, Height: 840, MinWidth: 860, MinHeight: 620, StateKey: "main", BackgroundColor: "light-dark(#ffffff, #0a0a0a)"})
		acceptance(win, d)
		mygo.App.OnSecondInstance(func([]string, string) { win.Show(); win.Focus() })
		mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { close(d.stop); d.engine.Close() })
	})
	if err := mygo.App.Run(); err != nil {
		panic(err)
	}
}

func (d *Desktop) statusCopy() map[string]any {
	v := map[string]any{}
	for k, value := range d.updateStatus {
		v[k] = value
	}
	return v
}
func (d *Desktop) updateLoop() {
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	for {
		select {
		case <-d.stop:
			return
		case <-timer.C:
			d.mu.Lock()
			settings := d.readSettings()
			enabled := settings["autoCheck"] != false
			d.updateStatus["autoCheck"] = enabled
			d.mu.Unlock()
			if enabled {
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				v, _ := d.checkUpdates(ctx)
				cancel()
				_ = Changed.Broadcast(map[string]any{"name": "app-update-status", "payload": v})
			}
			timer.Reset(6 * time.Hour)
		}
	}
}
