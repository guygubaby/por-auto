package automation

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"github.com/robfig/cron/v3"
	"path/filepath"
	"regexp"
	"sync"
	"time"
	_ "time/tzdata"
)

type Scheduler struct {
	engine    *Engine
	mu        sync.Mutex
	tasks     []any
	running   map[string]bool
	stop      chan struct{}
	lastError any
}

func Upcoming(expression, zone string, after int64, count int) ([]int64, error) {
	if len(expression) > 200 || len(regexp.MustCompile(`\s+`).Split(expression, -1)) != 5 || !regexp.MustCompile(`^[A-Za-z0-9* ,/\-]+$`).MatchString(expression) {
		return nil, errf("Cron 只支持标准五段表达式")
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return nil, errf("时区无效，请使用 Asia/Shanghai 等 IANA 时区")
	}
	parser := cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	spec, e := parser.Parse(expression)
	if e != nil {
		return nil, errf("Cron 表达式无效")
	}
	cursor := time.UnixMilli(after).In(loc)
	result := []int64{}
	for len(result) < count {
		next := spec.Next(cursor)
		if next.IsZero() {
			return nil, errf("Cron 没有可用的下一次执行时间")
		}
		cursor = next
		prev := next.Add(-time.Hour)
		if next.In(loc).Format("2006-01-02 15:04") == prev.In(loc).Format("2006-01-02 15:04") {
			continue
		}
		result = append(result, next.UnixMilli())
	}
	return result, nil
}
func NewScheduler(e *Engine) (*Scheduler, error) {
	v, err := loadFile(e.path("schedules.json"), Object{"schemaVersion": 1, "tasks": []any{}})
	if err != nil {
		return nil, err
	}
	state := object(v)
	if num(state["schemaVersion"]) != 1 || len(list(state["tasks"])) > 100 {
		return nil, errf("定时任务配置版本或数量无效")
	}
	s := &Scheduler{engine: e, tasks: list(state["tasks"]), running: map[string]bool{}, stop: make(chan struct{})}
	seen := map[string]bool{}
	for _, v := range s.tasks {
		t := object(v)
		id := str(t["id"])
		if _, err = uuid.Parse(id); err != nil || seen[id] {
			return nil, errf("定时任务标识无效或重复")
		}
		seen[id] = true
		for _, serial := range list(t["serials"]) {
			if !ValidSerial(str(serial)) {
				return nil, errf("定时任务手机标识无效")
			}
		}
		if t["lastStatus"] == "running" {
			t["lastStatus"] = "interrupted"
			t["lastMessage"] = "应用关闭导致运行中断，未重试"
		}
		if !supportedWorkflow(object(object(t["snapshot"])["workflow"])) {
			t["enabled"] = false
			t["nextRunAt"] = nil
			t["lastMessage"] = "微信工作流已移除，任务已暂停；历史记录保留"
			continue
		}
		if err = validateWorkflow(object(object(t["snapshot"])["workflow"])); err != nil {
			return nil, err
		}
		e.Credentials.BindConfig(object(t["snapshot"]))
		times, err := Upcoming(str(t["cron"]), str(t["timezone"]), now(), 1)
		if err != nil {
			return nil, err
		}
		if t["enabled"] == true {
			if err = s.runnable(object(t["snapshot"])); err != nil {
				t["enabled"], t["nextRunAt"], t["lastMessage"] = false, nil, err.Error()
				continue
			}
			t["nextRunAt"] = times[0]
		} else {
			t["nextRunAt"] = nil
		}
	}
	if err = s.persist(); err != nil {
		return nil, err
	}
	go s.loop()
	return s, nil
}
func (s *Scheduler) persist() error {
	err := atomicJSON(s.engine.path("schedules.json"), Object{"schemaVersion": 1, "tasks": s.tasks})
	s.lastError = nil
	if err != nil {
		s.lastError = "定时任务保存失败：" + err.Error()
	}
	return err
}
func (s *Scheduler) View() Object {
	s.mu.Lock()
	defer s.mu.Unlock()
	ids := []string{}
	for id := range s.running {
		ids = append(ids, id)
	}
	return Object{"tasks": clone(Object{"values": s.tasks})["values"], "runningIds": ids, "error": s.lastError}
}

// Callers hold engine.mu before scheduler.mu when the service is running.
func (s *Scheduler) runnable(snapshot Object) error {
	if !supportedWorkflow(object(snapshot["workflow"])) {
		return errf("微信工作流已移除，任务不能运行")
	}
	_, err := s.engine.installed(str(snapshot["key"]))
	return err
}
func (s *Scheduler) Save(input Object) (Object, error) {
	s.engine.mu.Lock()
	defer s.engine.mu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.tasks) >= 100 && str(input["id"]) == "" {
		return nil, errf("定时任务最多 100 个")
	}
	name := str(input["name"])
	if name == "" || len(name) > 100 || (len(list(input["serials"])) == 0 || len(list(input["serials"])) > 1000) {
		return nil, errf("请填写任务名称并选择手机")
	}
	seen := map[string]bool{}
	for _, serial := range list(input["serials"]) {
		v := str(serial)
		if !ValidSerial(v) || seen[v] {
			return nil, errf("手机列表无效或重复")
		}
		seen[v] = true
	}
	times, err := Upcoming(str(input["cron"]), str(input["timezone"]), now(), 1)
	if err != nil {
		return nil, err
	}
	id := str(input["id"])
	var prior Object
	index := -1
	for i, v := range s.tasks {
		if object(v)["id"] == id {
			prior = object(v)
			index = i
		}
	}
	if id != "" && index < 0 {
		return nil, errf("定时任务不存在")
	}
	if s.running[id] {
		return nil, errf("任务正在执行，不能编辑")
	}
	snapshot := object(nil)
	if prior != nil && object(prior["snapshot"])["key"] == input["workflowKey"] && input["updateWorkflow"] != true {
		snapshot = clone(prior["snapshot"])
	} else {
		snapshot, err = s.engine.installed(str(input["workflowKey"]))
		if err != nil {
			return nil, err
		}
	}
	if id == "" {
		id = uuid.NewString()
	}
	t := Object{"id": id, "name": name, "enabled": input["enabled"] == true, "cron": input["cron"], "timezone": input["timezone"], "serials": input["serials"], "snapshot": snapshot, "nextRunAt": nil}
	if t["enabled"] == true {
		t["nextRunAt"] = times[0]
	}
	if prior != nil {
		for _, k := range []string{"lastRunAt", "lastStatus", "lastMessage"} {
			t[k] = prior[k]
		}
	}
	if t["enabled"] == true {
		if err = s.runnable(snapshot); err != nil {
			return nil, err
		}
	}
	before := append([]any{}, s.tasks...)
	if index >= 0 {
		s.tasks[index] = t
	} else {
		s.tasks = append(s.tasks, t)
	}
	if err = s.persist(); err != nil {
		s.tasks = before
		return nil, err
	}
	return t, nil
}
func (s *Scheduler) Change(id string, enabled *bool, remove bool) error {
	s.engine.mu.Lock()
	defer s.engine.mu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running[id] {
		return errf("任务正在执行，不能编辑或删除")
	}
	for i, v := range s.tasks {
		t := object(v)
		if t["id"] != id {
			continue
		}
		before := list(clone(Object{"tasks": s.tasks})["tasks"])
		if remove {
			s.tasks = append(s.tasks[:i], s.tasks[i+1:]...)
		} else {
			if *enabled {
				if err := s.runnable(object(t["snapshot"])); err != nil {
					return err
				}
			}
			t["enabled"] = *enabled
			t["nextRunAt"] = nil
			if *enabled {
				times, err := Upcoming(str(t["cron"]), str(t["timezone"]), now(), 1)
				if err != nil {
					s.tasks = before
					return err
				}
				t["nextRunAt"] = times[0]
			}
		}
		if err := s.persist(); err != nil {
			s.tasks = before
			return err
		}
		return nil
	}
	return errf("定时任务不存在")
}
func (s *Scheduler) PauseWorkflow(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, v := range s.tasks {
		if object(object(v)["snapshot"])["key"] == key && s.running[str(object(v)["id"])] {
			return errf("此工作流有定时任务正在运行，请结束后卸载")
		}
	}
	before := list(clone(Object{"tasks": s.tasks})["tasks"])
	for _, v := range s.tasks {
		t := object(v)
		if object(t["snapshot"])["key"] == key {
			t["enabled"] = false
			t["nextRunAt"] = nil
		}
	}
	if err := s.persist(); err != nil {
		s.tasks = before
		return err
	}
	return nil
}
func (s *Scheduler) RunNow(id string) error {
	s.engine.mu.Lock()
	defer s.engine.mu.Unlock()
	s.mu.Lock()
	for _, v := range s.tasks {
		if object(v)["id"] == id {
			if err := s.runnable(object(object(v)["snapshot"])); err != nil {
				s.mu.Unlock()
				return err
			}
			if s.running[id] {
				s.mu.Unlock()
				return errf("任务已经运行中")
			}
			t := clone(v)
			t["scheduledAt"] = now()
			s.running[id] = true
			object(v)["lastStatus"] = "running"
			object(v)["lastRunAt"] = now()
			err := s.persist()
			if err != nil {
				object(v)["lastStatus"] = t["lastStatus"]
				object(v)["lastRunAt"] = t["lastRunAt"]
				delete(s.running, id)
				s.mu.Unlock()
				return err
			}
			s.mu.Unlock()
			go s.execute(t, "manual")
			return nil
		}
	}
	s.mu.Unlock()
	return errf("任务不存在")
}
func (s *Scheduler) loop() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			s.tick(now())
		}
	}
}
func (s *Scheduler) tick(at int64) {
	s.engine.mu.Lock()
	s.mu.Lock()
	var due []Object
	var skipped []Object
	changed := false
	for _, v := range s.tasks {
		t := object(v)
		next := int64(num(t["nextRunAt"]))
		if t["enabled"] != true || next <= 0 || next > at {
			continue
		}
		changed = true
		if err := s.runnable(object(t["snapshot"])); err != nil {
			t["enabled"], t["nextRunAt"], t["lastStatus"], t["lastMessage"] = false, nil, "failed", err.Error()
			continue
		}
		times, err := Upcoming(str(t["cron"]), str(t["timezone"]), at, 1)
		if err != nil {
			t["enabled"] = false
			t["lastMessage"] = err.Error()
			continue
		}
		t["nextRunAt"] = times[0]
		id := str(t["id"])
		if s.running[id] || at-next > 10000 {
			t["lastStatus"] = "skipped"
			t["lastMessage"] = "错过执行时间或任务仍在运行，未补跑"
			dispatch := clone(t)
			dispatch["scheduledAt"] = next
			skipped = append(skipped, dispatch)
			continue
		}
		s.running[id] = true
		t["lastStatus"] = "running"
		t["lastRunAt"] = at
		dispatch := clone(t)
		dispatch["scheduledAt"] = next
		due = append(due, dispatch)
	}
	if changed {
		if err := s.persist(); err != nil {
			for _, t := range due {
				delete(s.running, str(t["id"]))
			}
			for _, v := range s.tasks {
				t := object(v)
				if t["lastStatus"] == "running" && !s.running[str(t["id"])] {
					t["lastStatus"] = "failed"
					t["lastMessage"] = s.lastError
				}
			}
			due = nil
			skipped = nil
		}
	}
	s.mu.Unlock()
	s.engine.mu.Unlock()
	for _, t := range due {
		go s.execute(t, "cron")
	}
	for _, t := range skipped {
		go s.recordSkip(t)
	}
}
func (s *Scheduler) recordSkip(t Object) {
	id, folder, err := s.engine.newRunFolder()
	w := object(object(t["snapshot"])["workflow"])
	if err == nil {
		err = atomicJSON(filepath.Join(folder, "meta.json"), Object{"id": id, "workflow_name": w["name"], "workflow_version": w["version"], "serial": fmt.Sprintf("%d 台设备", len(list(t["serials"]))), "timestamp": now(), "status": "skipped", "error": t["lastMessage"], "schedule_id": t["id"], "schedule_name": t["name"], "trigger": "cron", "dry_run": object(t["snapshot"])["dryRun"] == true})
	}
	if err == nil {
		err = atomicJSON(filepath.Join(folder, "batch.json"), Object{"schedule": t, "trigger": "cron", "scheduledAt": t["scheduledAt"], "status": "skipped", "message": t["lastMessage"], "devices": []any{}})
	}
	if err == nil {
		err = atomicJSON(filepath.Join(folder, "workflow.json"), w)
	}
	if err == nil {
		err = atomicJSON(filepath.Join(folder, "input.json"), t["snapshot"])
	}
	if err != nil {
		s.mu.Lock()
		s.lastError = err.Error()
		s.mu.Unlock()
	}
	if s.engine.Emit != nil {
		s.engine.Emit("history-changed", nil)
		s.engine.Emit("schedules-changed", nil)
	}
}
func (s *Scheduler) execute(t Object, trigger string) {
	serials := list(t["serials"])
	_, folder, setupErr := s.engine.newRunFolder()
	w := object(object(t["snapshot"])["workflow"])
	meta := Object{"id": filepath.Base(folder), "workflow_name": w["name"], "workflow_version": w["version"], "serial": fmt.Sprintf("%d 台设备", len(serials)), "timestamp": now(), "status": "running", "schedule_id": t["id"], "schedule_name": t["name"], "trigger": trigger, "dry_run": object(t["snapshot"])["dryRun"] == true}
	if setupErr == nil {
		setupErr = atomicJSON(filepath.Join(folder, "meta.json"), meta)
	}
	if setupErr == nil {
		setupErr = atomicJSON(filepath.Join(folder, "workflow.json"), w)
	}
	if setupErr == nil {
		setupErr = atomicJSON(filepath.Join(folder, "input.json"), t["snapshot"])
	}
	results := make([]any, len(serials))
	for first := 0; first < len(serials) && setupErr == nil; first += 4 {
		var workers sync.WaitGroup
		for i := first; i < min(first+4, len(serials)); i++ {
			workers.Add(1)
			go func(i int) {
				defer workers.Done()
				r, err := s.engine.Run(context.Background(), str(serials[i]), object(t["snapshot"]), true)
				var failure any
				var runID any
				if err != nil {
					failure = err.Error()
				} else {
					failure = r["error"]
					runID = r["id"]
					if saved, er := loadFile(filepath.Join(str(r["folder"]), "meta.json"), nil); er == nil && saved != nil {
						m := object(saved)
						m["schedule_id"], m["schedule_name"], m["trigger"] = t["id"], t["name"], trigger
						if er = atomicJSON(filepath.Join(str(r["folder"]), "meta.json"), m); er != nil {
							failure = er.Error()
						}
					}
				}
				results[i] = Object{"serial": serials[i], "runId": runID, "error": failure}
			}(i)
		}
		workers.Wait()
	}
	completed := 0
	for _, r := range results {
		if r != nil && object(r)["error"] == nil {
			completed++
		}
	}
	status := "failed"
	if completed == len(serials) && setupErr == nil {
		status = "completed"
	} else if completed > 0 {
		status = "partial"
	}
	message := fmt.Sprintf("共 %d 台，成功 %d 台", len(serials), completed)
	if setupErr != nil {
		message = "批次证据保存失败，未执行设备操作：" + setupErr.Error()
	}
	meta["status"] = status
	if status != "completed" {
		meta["error"] = message
	}
	batch := Object{"schedule": t, "trigger": trigger, "scheduledAt": t["scheduledAt"], "status": status, "message": message, "devices": results}
	if setupErr == nil {
		if err := atomicJSON(filepath.Join(folder, "batch.json"), batch); err != nil {
			status, message = "failed", err.Error()
		}
		meta["status"] = status
		if err := atomicJSON(filepath.Join(folder, "meta.json"), meta); err != nil {
			status, message = "failed", err.Error()
		}
	}
	s.mu.Lock()
	for _, v := range s.tasks {
		x := object(v)
		if x["id"] == t["id"] {
			x["lastStatus"], x["lastMessage"], x["lastRunAt"] = status, message, now()
		}
	}
	delete(s.running, str(t["id"]))
	_ = s.persist()
	s.mu.Unlock()
	if s.engine.Emit != nil {
		s.engine.Emit("schedules-changed", nil)
		s.engine.Emit("history-changed", nil)
	}
}
func (s *Scheduler) Close() {
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
}
