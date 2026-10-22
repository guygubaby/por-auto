package automation

import (
	"context"
	"strings"
	"testing"
)

func sendWorkflow() Object {
	return Object{"schemaVersion": 1, "minEngine": 4, "id": "daily-report", "name": "Report", "version": "1.0.0", "description": "", "package": "com.tencent.wework", "steps": []any{
		Object{"name": "Open", "action": Object{"type": "chat_first_chat", "output": "title"}},
		Object{"name": "Send", "action": Object{"type": "chat_send_text", "text": "Hello"}},
	}}
}

func TestWorkflowValidationRejectsUnsafeActionsAndSchemas(t *testing.T) {
	if err := validateWorkflow(sendWorkflow()); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(Object){
		"duplicate send": func(w Object) { w["steps"] = append(list(w["steps"]), list(w["steps"])[1]) },
		"duplicate broadcast": func(w Object) {
			w["inputSchema"] = Object{"$ref": "por-auto://schemas/chat-send-input/v1"}
			w["steps"] = []any{Object{"name": "Batch", "action": Object{"type": "chat_broadcast"}}, Object{"name": "Batch twice", "action": Object{"type": "chat_broadcast"}}}
		},
		"unknown field":        func(w Object) { w["unexpected"] = true },
		"unknown action field": func(w Object) { object(object(list(w["steps"])[1])["action"])["retry"] = 2 },
		"non-string action":    func(w Object) { object(object(list(w["steps"])[1])["action"])["type"] = []any{"wake"} },
		"wrong engine":         func(w Object) { w["minEngine"] = 0 },
		"ordinary WeChat":      func(w Object) { w["package"] = "com.tencent.mm" },
		"missing description":  func(w Object) { delete(w, "description") },
		"invalid version":      func(w Object) { w["version"] = "1.0.0-01" },
		"unknown schema":       func(w Object) { w["inputSchema"] = Object{"$ref": "unknown"} },
		"missing batch schema": func(w Object) {
			w["steps"] = []any{Object{"name": "Batch", "action": Object{"type": "chat_broadcast"}}}
		},
		"send after navigation": func(w Object) {
			w["steps"] = append([]any{list(w["steps"])[0], Object{"name": "Back", "action": Object{"type": "back"}}}, list(w["steps"])[1])
		},
		"oversized fixed text": func(w Object) { object(object(list(w["steps"])[1])["action"])["text"] = strings.Repeat("中", 167) },
		"unbounded recovery": func(w Object) {
			w["steps"] = []any{Object{"name": "Tap", "action": Object{"type": "tap", "selector": Object{"text": []any{"Test"}}, "recover_back": 4}}}
		},
		"string wait": func(w Object) {
			w["steps"] = []any{Object{"name": "Wait", "action": Object{"type": "wait", "ms": "1000"}}}
		},
		"long wait": func(w Object) {
			w["steps"] = []any{Object{"name": "Wait", "action": Object{"type": "wait", "ms": 10001}}}
		},
		"total wait": func(w Object) {
			w["steps"] = []any{}
			for range 4 {
				w["steps"] = append(list(w["steps"]), Object{"name": "Wait", "action": Object{"type": "wait", "ms": 10000}})
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			w := sendWorkflow()
			mutate(w)
			if err := validateWorkflow(w); err == nil {
				t.Fatal("invalid workflow was accepted")
			}
		})
	}
}

func TestDuplicateSendCannotReachSharedControllerIO(t *testing.T) {
	w := sendWorkflow()
	w["steps"] = append(list(w["steps"]), list(w["steps"])[1])
	r := NewRuntime(context.Background(), NewCredentials())
	m, err := r.Module("core")
	if err != nil {
		t.Fatal(err)
	}
	_ = r.VM.Set("core", m)
	_ = r.VM.Set("workflow", w)
	_, err = r.VM.RunString(`core.create({}).run(workflow,{dryRun:false,hooks:{}})`)
	if err == nil || !strings.Contains(err.Error(), "一个发送动作") {
		t.Fatalf("duplicate send reached IO instead of failing preflight: %v", err)
	}
}
