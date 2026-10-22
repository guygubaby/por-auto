package automation

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestSchedulePersistenceFailureDoesNotDispatchOrLoseTask(t *testing.T) {
	for _, operation := range []string{"run", "delete", "disable", "uninstall"} {
		t.Run(operation, func(t *testing.T) {
			root := t.TempDir()
			e := NewEngine(root, nil)
			store, err := e.Store()
			if err != nil {
				t.Fatal(err)
			}
			snapshot := object(list(store["installed"])[0])
			task := Object{"id": "task", "enabled": true, "lastStatus": "completed", "lastRunAt": 12, "snapshot": snapshot}
			s := &Scheduler{engine: e, tasks: []any{task}, running: map[string]bool{}}
			// A directory at the target path makes atomic replacement fail on every OS.
			if err := os.Mkdir(e.path("schedules.json"), 0700); err != nil {
				t.Fatal(err)
			}
			switch operation {
			case "run":
				err = s.RunNow("task")
			case "delete":
				err = s.Change("task", nil, true)
			case "disable":
				enabled := false
				err = s.Change("task", &enabled, false)
			case "uninstall":
				err = s.PauseWorkflow(str(snapshot["key"]))
			}
			if err == nil || len(s.running) != 0 {
				t.Fatal("failed persistence dispatched a task or left it running")
			}
			if len(s.tasks) != 1 || object(s.tasks[0])["enabled"] != true || object(s.tasks[0])["lastStatus"] != "completed" {
				t.Fatalf("task was changed after failed save: %v", s.tasks)
			}
			if s.View()["error"] == nil {
				t.Fatal("persistence failure was hidden from UI")
			}
		})
	}
}

func TestUninstalledWorkflowCannotRunThroughFrozenSchedule(t *testing.T) {
	for _, operation := range []string{"enable", "run", "edit", "cron", "restart", "engine"} {
		t.Run(operation, func(t *testing.T) {
			e := NewEngine(t.TempDir(), nil)
			s := &Scheduler{engine: e, running: map[string]bool{}}
			e.scheduler = s
			store, err := e.Store()
			if err != nil {
				t.Fatal(err)
			}
			var snapshot Object
			for _, value := range list(store["installed"]) {
				if object(object(value)["workflow"])["id"] == "wecom-open" {
					snapshot = object(value)
				}
			}
			input := Object{"name": "Pinned", "cron": "0 9 * * *", "timezone": "Asia/Shanghai", "enabled": false, "workflowKey": snapshot["key"], "serials": []any{"OFFLINE"}}
			task, err := s.Save(input)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = e.Call(context.Background(), "uninstall_workflow", Object{"key": snapshot["key"]}); err != nil {
				t.Fatal(err)
			}
			id := str(task["id"])
			switch operation {
			case "enable":
				enabled := true
				err = s.Change(id, &enabled, false)
			case "run":
				err = s.RunNow(id)
			case "edit":
				input["id"], input["enabled"] = id, true
				_, err = s.Save(input)
			case "cron", "restart":
				task["enabled"], task["nextRunAt"] = true, now()-1
				if operation == "cron" {
					s.tick(now())
				} else {
					if err = s.persist(); err != nil {
						t.Fatal(err)
					}
					reopened, openErr := NewScheduler(e)
					if openErr != nil {
						t.Fatal(openErr)
					}
					defer reopened.Close()
					task = object(list(reopened.View()["tasks"])[0])
				}
				if task["enabled"] != false || task["nextRunAt"] != nil {
					t.Fatal("uninstalled task remained enabled")
				}
			case "engine":
				_, err = e.Run(context.Background(), "OFFLINE", snapshot, true)
			}
			if operation != "cron" && operation != "restart" && err == nil {
				t.Fatal("uninstalled workflow was accepted")
			}
			if len(s.running) != 0 {
				t.Fatal("uninstalled task was dispatched")
			}
			history, err := e.ListRuns()
			if err != nil || len(history) != 0 {
				t.Fatalf("uninstalled task reached execution: %v %v", history, err)
			}
		})
	}
}

func TestScheduledOfflineDevicesKeepBatchAndIndividualHistory(t *testing.T) {
	feedback := make(chan Object, 2)
	e := NewEngine(t.TempDir(), func(name string, value any) {
		if name == "schedules-changed" {
			select {
			case feedback <- object(value):
			default:
			}
		}
	})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	store, err := e.Store()
	if err != nil {
		t.Fatal(err)
	}
	var key any
	for _, item := range list(store["installed"]) {
		if object(object(item)["workflow"])["id"] == "wecom-open" {
			key = object(item)["key"]
		}
	}
	task, err := e.scheduler.Save(Object{"name": "离线回归", "cron": "0 9 * * *", "timezone": "Asia/Shanghai", "enabled": false, "workflowKey": key, "serials": []any{"A", "B", "C", "D"}})
	if err != nil {
		t.Fatal(err)
	}
	if err = e.scheduler.RunNow(str(task["id"])); err != nil {
		t.Fatal(err)
	}
	var batchID any
	for _, status := range []string{"running", "failed"} {
		select {
		case event := <-feedback:
			if event["status"] != status || event["name"] != "离线回归" || str(event["message"]) == "" {
				t.Fatalf("incorrect run feedback: %v", event)
			}
			if status == "running" {
				batchID = event["id"]
			} else if batchID == nil || event["id"] != batchID {
				t.Fatal("completion did not update the running batch notification")
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("offline task did not report %s", status)
		}
	}
	history, err := e.ListRuns()
	if err != nil || len(history) != 5 {
		t.Fatalf("batch or device history missing: %v %v", history, err)
	}
	found := false
	for _, value := range history {
		summary := object(value)
		if summary["schedule_id"] != task["id"] || summary["status"] != "failed" {
			t.Fatalf("schedule metadata or failed device result lost: %v", summary)
		}
		details, er := e.RunDetails(str(summary["id"]))
		if er != nil {
			t.Fatal(er)
		}
		if batch := object(details["batch"]); len(list(batch["devices"])) == 4 {
			found = true
		}
	}
	if !found {
		t.Fatal("batch has no linked individual results")
	}
	if active, _ := e.Call(context.Background(), "active_runs", nil); len(object(active)) != 0 {
		t.Fatal("failed offline tasks left busy devices")
	}
}

func TestClaimedScheduledBatchBlocksUninstallBeforeDeviceStarts(t *testing.T) {
	e := NewEngine(t.TempDir(), nil)
	s := &Scheduler{engine: e, running: map[string]bool{"claimed": true}}
	e.scheduler = s
	store, err := e.Store()
	if err != nil {
		t.Fatal(err)
	}
	snapshot := object(list(store["installed"])[0])
	s.tasks = []any{Object{"id": "claimed", "snapshot": snapshot}}
	if _, err = e.Call(context.Background(), "uninstall_workflow", Object{"key": snapshot["key"]}); err == nil {
		t.Fatal("claimed batch allowed its workflow to be uninstalled")
	}
	if _, err = e.installed(str(snapshot["key"])); err != nil {
		t.Fatal("failed uninstall removed installed workflow")
	}
}

func TestWeChatWorkflowsAreRemovedAndTheirSchedulesArePaused(t *testing.T) {
	root := t.TempDir()
	engine := NewEngine(root, nil)
	wechat := Object{
		"schemaVersion": 1,
		"minEngine":     3,
		"id":            "wechat-broadcast",
		"name":          "微信批量发送消息",
		"version":       "1.0.0",
		"package":       "com.tencent.mm",
		"steps": []any{
			Object{"id": "send", "name": "发送", "action": Object{"type": "wechat_broadcast"}},
		},
	}
	key := storeKey(OfficialURL, "main", "wechat-broadcast")
	if err := engine.saveStore(Object{
		"schemaVersion": 1,
		"registries": []any{
			Object{"url": OfficialURL, "reference": "main", "name": "旧目录", "commit": "old", "workflows": []any{wechat}},
		},
		"installed": []any{
			Object{"key": key, "registryUrl": OfficialURL, "reference": "main", "commit": "old", "workflow": wechat, "dryRun": true, "hooks": Object{}},
		},
		"uninstalledKeys": []any{},
	}); err != nil {
		t.Fatal(err)
	}
	task := Object{
		"id":        "11111111-1111-4111-8111-111111111111",
		"name":      "旧微信任务",
		"enabled":   true,
		"cron":      "0 9 * * *",
		"timezone":  "Asia/Shanghai",
		"serials":   []any{"ABC123"},
		"nextRunAt": now() + 1000,
		"snapshot": Object{
			"key":           key,
			"registryUrl":   OfficialURL,
			"reference":     "main",
			"commit":        "old",
			"workflow":      wechat,
			"dryRun":        true,
			"executionMode": "native",
			"hooks":         Object{},
		},
	}
	if err := atomicJSON(engine.path("schedules.json"), Object{"schemaVersion": 1, "tasks": []any{task}}); err != nil {
		t.Fatal(err)
	}
	if err := engine.Start(); err != nil {
		t.Fatal(err)
	}
	defer engine.Close()

	store, err := engine.Store()
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range list(store["installed"]) {
		if !supportedWorkflow(object(object(value)["workflow"])) {
			t.Fatalf("removed target remained installed: %v", value)
		}
	}
	tasks := list(engine.scheduler.View()["tasks"])
	if len(tasks) != 1 || object(tasks[0])["enabled"] != false {
		t.Fatalf("removed workflow schedule was not paused: %v", tasks)
	}
	if !strings.Contains(str(object(tasks[0])["lastMessage"]), "已移除") {
		t.Fatalf("paused schedule did not explain the migration: %v", tasks[0])
	}
}
