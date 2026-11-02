package automation

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHistoryKeepsTwoHundredAndProtectsActiveRun(t *testing.T) {
	e := NewEngine(t.TempDir(), nil)
	e.active["live"] = func() {}
	for index := 1; index <= 205; index++ {
		folder := e.path(fmt.Sprintf("runs/%d", index))
		meta := Object{"id": "../outside", "timestamp": index, "status": "completed"}
		if index == 1 {
			meta["status"], meta["serial"] = "running", "live"
		}
		if err := atomicJSON(filepath.Join(folder, "meta.json"), meta); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(folder, "old-heavy-file.log"), []byte("old"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	outside := e.path("outside")
	if err := os.WriteFile(outside, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	rows, err := e.ListRuns()
	if err != nil || len(rows) != 200 || object(rows[len(rows)-1])["id"] != "1" {
		t.Fatalf("retention lost the active run: count=%d err=%v", len(rows), err)
	}
	for index := 2; index <= 6; index++ {
		if _, err := os.Stat(e.path(fmt.Sprintf("runs/%d", index))); !os.IsNotExist(err) {
			t.Fatalf("old run %d was not removed completely: %v", index, err)
		}
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("retention trusted a metadata path instead of its run directory")
	}
	restarted := NewEngine(e.Root, nil)
	rows, err = restarted.ListRuns()
	if err != nil || object(rows[len(rows)-1])["status"] != "interrupted" {
		t.Fatal("stale running history was not recognized after restart", err)
	}
}

func TestDiagnosticsStayInMemoryUntilFailureAndRemainSmall(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := NewRuntime(ctx, NewCredentials())
	d := &DeviceIO{Ctx: ctx, Folder: t.TempDir(), Total: 2, CurrentStep: "打开会话", LastHierarchy: strings.Repeat("x", 65536)}
	_ = r.VM.Set("io", d.Bind(r))
	if _, err := r.VM.RunString(`for(var n=0;n<100;n++)io.log('wait',{name:'控件'});`); err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir(d.Folder)
	if err != nil || len(files) != 0 || len(d.Events) != 32 {
		t.Fatal("routine reads wrote logs to disk or grew without a bound", err)
	}
	cancel()
	if _, err = r.VM.RunString(`io.record({status:'failed',targets:[{title:'群甲',status:'uncertain'}]});`); err != nil {
		t.Fatal("manual stop blocked saving the final result", err)
	}
	if err = d.saveFailure(errors.New("manual stop")); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(d.Folder, "hierarchy.xml"))
	if err != nil || info.Size() != 32*1024 {
		t.Fatal("failure page evidence was not bounded", err)
	}
	if _, err = os.Stat(filepath.Join(d.Folder, "targets.json")); !os.IsNotExist(err) {
		t.Fatal("recipient evidence was duplicated")
	}
}

func TestCorruptHistoryCannotBlockStartup(t *testing.T) {
	e := NewEngine(t.TempDir(), nil)
	for index, raw := range []string{"{broken", "[]", "null"} {
		folder := e.path(fmt.Sprintf("runs/%d", index+1))
		if err := os.MkdirAll(folder, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(folder, "meta.json"), []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := e.Start(); err != nil {
		t.Fatal("damaged diagnostic history prevented tasks from starting", err)
	}
	defer e.Close()
	rows, err := e.ListRuns()
	if err != nil || len(rows) != 3 {
		t.Fatalf("damaged records were hidden or not isolated: %v %v", rows, err)
	}
}
