//go:build devicetest

package automation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestLiveRecipientInventory(t *testing.T) {
	serial, root := os.Getenv("POR_DEVICE_SERIAL"), os.Getenv("POR_DEVICE_ROOT")
	if !ValidSerial(serial) || root == "" {
		t.Skip("explicit authorized phone inventory only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	e := NewEngine(root, nil)
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err := e.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	pkg := os.Getenv("POR_INVENTORY_PACKAGE")
	if pkg == "" {
		pkg = "com.tencent.wework"
	}
	mode := "native"
	report := []any{}
	for _, scope := range []string{"groups", "conversations"} {
		value, err := e.Call(ctx, "list_wecom_targets", Object{"serial": serial, "package": pkg, "scope": scope, "executionMode": mode})
		if err != nil {
			t.Fatal(err)
		}
		inventory := object(value)
		if inventory["complete"] != true || len(list(inventory["items"])) == 0 {
			t.Fatal("recipient inventory was incomplete or unexpectedly empty")
		}
		seen := map[string]bool{}
		for _, item := range list(inventory["items"]) {
			title := str(object(item)["title"])
			if title == "" || seen[title] {
				t.Fatal("recipient inventory contained an empty or duplicate title")
			}
			seen[title] = true
		}
		if err := atomicJSON(e.path("inventory-"+scope+".json"), inventory); err != nil {
			t.Fatal(err)
		}
		report = append(report, Object{"scope": scope, "count": len(seen), "complete": true, "noMessages": true})
		t.Logf("PASS full %s inventory; count=%d; no messages", scope, len(seen))
	}
	if err := atomicJSON(e.path("inventory-acceptance.json"), report); err != nil {
		t.Fatal(err)
	}
}

func TestLiveWeComFormalGroupSend(t *testing.T) {
	serial, root := os.Getenv("POR_DEVICE_SERIAL"), os.Getenv("POR_DEVICE_ROOT")
	message := strings.TrimSpace(os.Getenv("POR_DEVICE_SEND_MESSAGE"))
	if os.Getenv("POR_DEVICE_SEND") != "1" || !ValidSerial(serial) || root == "" || message == "" {
		t.Skip("explicit authorized WeCom group send requires device, root and message")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	e := NewEngine(root, nil)
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err := e.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	store, err := e.Store()
	if err != nil {
		t.Fatal(err)
	}
	var snapshot Object
	for _, value := range list(store["installed"]) {
		if object(object(value)["workflow"])["id"] == "wecom-broadcast" {
			snapshot = clone(object(value))
		}
	}
	if snapshot == nil {
		t.Fatal("bundled WeCom broadcast workflow missing")
	}
	snapshot["dryRun"] = false
	snapshot["executionMode"] = "native"
	snapshot["hooks"] = Object{}
	snapshot["input"] = Object{
		"message":    Object{"type": "manual", "text": message},
		"recipients": Object{"direct": false, "groups": true},
		"intervalMs": 1000,
	}
	result, err := e.Run(ctx, serial, snapshot, false)
	if err != nil {
		t.Fatal(err)
	}
	if result["error"] != nil {
		t.Fatalf("formal send failed: %v", result["error"])
	}
	outputs := object(result["outputs"])
	if outputs["message_status"] != "observed" {
		t.Fatalf("send observation was not confirmed: %v", outputs)
	}
	folder := str(result["folder"])
	details, err := e.RunDetails(str(result["id"]))
	if err != nil {
		t.Fatal(err)
	}
	targets := list(details["targets"])
	if len(targets) != 0 || outputs["completed_count"] != outputs["target_count"] || outputs["target_count"] == "0" {
		t.Fatal("group send did not complete every target")
	}
	report := Object{"ok": true, "message": message, "targets": targets, "folder": folder, "messageStatus": outputs["message_status"]}
	if err = atomicJSON(e.path("wecom-formal-send.json"), report); err != nil {
		t.Fatal(err)
	}
	t.Logf("PASS WeCom formal group send; targets=%d; folder=%s", len(targets), folder)
}

func TestLiveWeComSentMessageReadback(t *testing.T) {
	serial, root := os.Getenv("POR_DEVICE_SERIAL"), os.Getenv("POR_DEVICE_ROOT")
	title, message := os.Getenv("POR_DEVICE_CHAT_TITLE"), os.Getenv("POR_DEVICE_SENT_MESSAGE")
	if !ValidSerial(serial) || root == "" || title == "" || message == "" {
		t.Skip("read-only sent-message verification requires device, chat title and message")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	e := NewEngine(root, nil)
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err := e.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	path, err := e.adbPath()
	if err != nil {
		t.Fatal(err)
	}
	a := ADB{Path: path, Serial: serial}
	jar, err := e.Asset("u2.jar")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.Asset("u2-hint.dex"); err != nil {
		t.Fatal(err)
	}
	folder := e.path("sent-message-readback")
	if err = os.MkdirAll(folder, 0700); err != nil {
		t.Fatal(err)
	}
	u2, err := StartU2(ctx, a, filepath.Dir(jar), folder)
	if err != nil {
		t.Fatal(err)
	}
	defer u2.Close()
	d := &DeviceIO{Ctx: ctx, ADB: a, Package: "com.tencent.wework", Width: 1080, Height: 2280, Folder: folder, RunID: "sent-message-readback", U2: u2}
	d.Runtime = NewRuntime(ctx, e.Credentials)
	screen, err := d.observe("只读确认真实发送后的群标题、空输入框和消息正文")
	if err != nil {
		t.Fatal(err)
	}
	if screen.Page != "chat" || !sameTitle(screen.Title, title) || screen.Editor == nil || screen.Editor.Text != "" {
		t.Fatalf("sent-message page state mismatch: %+v", screen)
	}
	found := false
	for _, value := range screen.Outgoing {
		if str(object(value)["text"]) == message && object(value)["pending"] != true && object(value)["failed"] != true {
			found = true
		}
	}
	if !found {
		t.Fatalf("sent message was not read back from native nodes: %v", screen.Outgoing)
	}
	if err = atomicJSON(e.path("sent-message-readback.json"), Object{"ok": true, "title": title, "message": message, "editorEmpty": true, "outgoing": screen.Outgoing}); err != nil {
		t.Fatal(err)
	}
	t.Logf("PASS sent message readback; title=%s", title)
}

func TestLiveStopAndHistory(t *testing.T) {
	serial, root := os.Getenv("POR_DEVICE_SERIAL"), os.Getenv("POR_DEVICE_ROOT")
	if !ValidSerial(serial) || root == "" {
		t.Skip("explicit authorized read-only cancellation check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	stopped := false
	var e *Engine
	e = NewEngine(root, func(name string, value any) {
		if name == "workflow-progress" && num(object(value)["step"]) == 3 && !stopped {
			stopped = true
			if _, err := e.Call(ctx, "cancel_device_tasks", Object{"serials": []any{serial}}); err != nil {
				t.Error(err)
			}
		}
	})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err := e.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	store, err := e.Store()
	if err != nil {
		t.Fatal(err)
	}
	var item Object
	for _, value := range list(store["installed"]) {
		if object(object(value)["workflow"])["id"] == "wecom-open" {
			item = clone(value)
		}
	}
	if item == nil {
		t.Fatal("read-only bundled workflow missing")
	}
	item["dryRun"], item["executionMode"], item["hooks"] = false, "native", Object{}
	result, err := e.Run(ctx, serial, item, false)
	if err != nil || !stopped || result["error"] == nil {
		t.Fatal("live stop did not interrupt the workflow", err)
	}
	active, err := e.Call(ctx, "active_runs", Object{})
	if err != nil || len(object(active)) != 0 {
		t.Fatal("stopped device remained queued")
	}
	finished, err := e.Run(ctx, serial, item, false)
	if err != nil || finished["error"] != nil {
		t.Fatal("device queue could not run again after stop", err)
	}
	records, err := e.ListRuns()
	if err != nil || len(records) != 2 {
		t.Fatal("stop and subsequent completion were not both recorded")
	}
	exported := []any{}
	for _, record := range records {
		detail, err := e.RunDetails(str(object(record)["id"]))
		if err != nil || len(list(detail["logs"])) == 0 {
			t.Fatal("run details were missing", err)
		}
		exported = append(exported, detail)
	}
	if err := atomicJSON(e.path("history-export.json"), exported); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Call(ctx, "delete_runs", Object{"ids": []any{result["id"]}}); err != nil {
		t.Fatal(err)
	}
	remaining, err := e.ListRuns()
	if err != nil || len(remaining) != 1 || object(remaining[0])["id"] != finished["id"] {
		t.Fatal("isolated history deletion changed another record")
	}
	if err := atomicJSON(e.path("stop-history-acceptance.json"), Object{"ok": true, "stop": true, "queueReleased": true, "subsequentRun": true, "historyExport": true, "isolatedDeletion": true, "noSends": true}); err != nil {
		t.Fatal(err)
	}
	t.Log("PASS live stop, queue reuse, history details, JSON export and isolated deletion")
}

func TestLiveMinuteCronAndHTTP(t *testing.T) {
	if os.Getenv("POR_DEVICE_SERIAL") == "" || os.Getenv("POR_DEVICE_ROOT") == "" {
		t.Skip("explicit authorized phone acceptance only")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	finished := make(chan struct{}, 4)
	e := NewEngine(filepath.Join(os.Getenv("POR_DEVICE_ROOT"), "cron-"+uuid.NewString()), func(name string, value any) {
		if name == "schedules-changed" && object(value)["status"] != "running" {
			select {
			case finished <- struct{}{}:
			default:
			}
		}
	})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err := e.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	path, err := e.adbPath()
	if err != nil {
		t.Fatal(err)
	}
	a := ADB{Path: path, Serial: os.Getenv("POR_DEVICE_SERIAL")}
	ime, err := a.Shell(ctx, "settings", "get", "secure", "default_input_method")
	if err != nil {
		t.Fatal(err)
	}
	restore, err := a.WakeSession(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer restore()
	var mu sync.Mutex
	calls := []Object{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body Object
		if r.Method == "POST" {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		mu.Lock()
		calls = append(calls, Object{"method": r.Method, "path": r.URL.Path, "mode": r.URL.Query().Get("mode"), "authenticated": r.Header.Get("Authorization") == "Bearer fixture-only", "body": body})
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"message":"Cron fixture"}}`))
	}))
	defer server.Close()
	store, err := e.Store()
	if err != nil {
		t.Fatal(err)
	}
	var item Object
	for _, v := range list(store["installed"]) {
		if object(object(v)["workflow"])["id"] == "wecom-open" {
			item = object(v)
		}
	}
	if item == nil {
		t.Fatal("bundled open workflow missing")
	}
	id := uuid.NewString()
	endpoint := server.URL + "/after"
	e.Credentials.Bind(id, endpoint)
	e.Credentials.cache["http:"+id+":"+endpoint] = credentialValue{Value: "fixture-only"}
	before := Object{"url": server.URL + "/before", "method": "GET", "query": []any{}, "headers": []any{}, "auth": Object{"type": "none"}, "body": nil, "response": Object{"type": "json", "pointer": "/data/message"}, "timeoutSeconds": 5}
	after := Object{"url": endpoint, "method": "POST", "query": []any{Object{"name": "mode", "value": "{{run.mode}}"}}, "headers": []any{}, "auth": Object{"type": "bearer", "credential": id}, "body": Object{"status": "{{run.status}}", "mode": "{{run.mode}}", "device": "{{device.serial}}", "runId": "{{run.id}}"}, "response": Object{"type": "ignore"}, "timeoutSeconds": 5}
	item["dryRun"], item["executionMode"], item["hooks"] = false, "native", Object{"beforeRun": before, "afterRun": after}
	if err = e.saveStore(store); err != nil {
		t.Fatal(err)
	}
	task, err := e.scheduler.Save(Object{"name": "Go 真机分钟 Cron", "cron": "* * * * *", "timezone": "Asia/Shanghai", "enabled": true, "workflowKey": item["key"], "serials": []any{a.Serial}})
	if err != nil {
		t.Fatal(err)
	}
	// Later edits must not change the hooks captured by the scheduled snapshot.
	item["hooks"] = Object{}
	if err = e.saveStore(store); err != nil {
		t.Fatal(err)
	}
	t.Logf("waiting for actual minute boundary %v", task["nextRunAt"])
	complete := false
	for !complete {
		select {
		case <-ctx.Done():
			t.Fatal("actual Cron run did not complete before the acceptance deadline")
		case <-finished:
		}
		for _, v := range list(e.scheduler.View()["tasks"]) {
			task = object(v)
			if task["lastStatus"] == "completed" {
				complete = true
			} else if task["lastStatus"] == "failed" {
				t.Fatalf("Cron failed: %v", task["lastMessage"])
			}
		}
	}
	enabled := false
	if err = e.scheduler.Change(str(task["id"]), &enabled, false); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	observed := append([]Object{}, calls...)
	mu.Unlock()
	if len(observed) != 2 || observed[0]["method"] != "GET" || observed[1]["method"] != "POST" || observed[1]["authenticated"] != true || observed[1]["mode"] != "send" || object(observed[1]["body"])["status"] != "completed" || object(observed[1]["body"])["runId"] == item["key"] {
		t.Fatal("pinned HTTP hooks or run context changed")
	}
	currentIME, _ := a.Shell(context.Background(), "settings", "get", "secure", "default_input_method")
	if currentIME != ime {
		t.Fatal("keyboard changed during Cron")
	}
	if err = atomicJSON(e.path("cron-acceptance.json"), Object{"ok": true, "workflow": "wecom-open", "trigger": "cron", "snapshotPreserved": true, "authenticatedHTTP": true, "noSends": true, "keyboardRestored": true, "calls": observed}); err != nil {
		t.Fatal(err)
	}
	t.Log("PASS actual minute Cron, pinned hooks, authenticated POST, formal context and keyboard")
}

func TestLiveReadOnlyDeviceFlows(t *testing.T) {
	serial, root := os.Getenv("POR_DEVICE_SERIAL"), os.Getenv("POR_DEVICE_ROOT")
	if serial == "" || root == "" {
		t.Skip("set POR_DEVICE_SERIAL and POR_DEVICE_ROOT for an authorized read-only phone check")
	}
	if !ValidSerial(serial) {
		t.Fatal("invalid device serial")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	e := NewEngine(root, func(name string, value any) {
		if name == "workflow-progress" {
			t.Logf("STEP %d/%d %s", int(num(object(value)["step"])), int(num(object(value)["total"])), str(object(value)["message"]))
		}
	})
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err := e.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	adb, err := e.adbPath()
	if err != nil {
		t.Fatal(err)
	}
	a := ADB{Path: adb, Serial: serial}
	model, err := a.Shell(ctx, "getprop", "ro.product.model")
	if err != nil || model != "vivo X21" {
		t.Fatal("expected authorized vivo X21 is not connected")
	}
	originalIME, err := a.Shell(ctx, "settings", "get", "secure", "default_input_method")
	if err != nil {
		t.Fatal(err)
	}
	originalWake, err := a.Shell(ctx, "settings", "get", "global", "stay_on_while_plugged_in")
	if err != nil {
		t.Fatal(err)
	}
	store, err := e.Store()
	if err != nil {
		t.Fatal(err)
	}
	selected := os.Getenv("POR_DEVICE_CASES")
	if selected == "" {
		selected = "wecom-open"
	}
	report := []any{}
	for _, id := range strings.Split(selected, ",") {
		var snapshot Object
		for _, item := range list(store["installed"]) {
			if object(object(item)["workflow"])["id"] == id {
				snapshot = clone(item)
			}
		}
		allowed := map[string]bool{"wecom-open": true, "wecom-nickname": true, "wecom-first-chat": true}
		if !allowed[id] || snapshot == nil {
			t.Fatal("only bundled read-only workflows are allowed")
		}
		snapshot["dryRun"], snapshot["hooks"] = false, Object{}
		snapshot["executionMode"] = "native"
		if sends(object(snapshot["workflow"])) {
			t.Fatal("sender workflows require TestLiveWeComFormalGroupSend with explicit authorization")
		}
		started := time.Now()
		result, runErr := e.Run(ctx, serial, snapshot, false)
		if runErr == nil && result["error"] != nil {
			runErr = errf(str(result["error"]))
		}
		ime, _ := a.Shell(context.Background(), "settings", "get", "secure", "default_input_method")
		wake, _ := a.Shell(context.Background(), "settings", "get", "global", "stay_on_while_plugged_in")
		verdict := Object{"workflow": id, "dryRun": false, "ok": runErr == nil, "keyboardRestored": ime == originalIME, "wakeRestored": wake == originalWake, "seconds": time.Since(started).Seconds()}
		if result != nil {
			verdict["folder"] = result["folder"]
			events, _ := os.ReadFile(filepath.Join(str(result["folder"]), "events.jsonl"))
			if strings.Contains(string(events), `"status":"send_requested"`) || strings.Contains(string(events), `"status":"send_observed"`) {
				t.Fatal("read-only workflow contained a send intent")
			}
		}
		if runErr != nil {
			verdict["error"] = runErr.Error()
		}
		report = append(report, verdict)
		if err = atomicJSON(e.path("device-acceptance.json"), report); err != nil {
			t.Fatal(err)
		}
		if ime != originalIME || wake != originalWake {
			t.Fatal("phone settings were not restored; inspect the phone before continuing")
		}
		if runErr != nil {
			t.Fatalf("%s failed: %v", id, runErr)
		}
		if id == "wecom-nickname" && strings.TrimSpace(str(object(result["outputs"])["nickname"])) == "" {
			t.Fatal("nickname was empty")
		}
		t.Logf("PASS %s; keyboard restored; wake restored; no sends", id)
	}
}
