package automation

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHistoryDiagnosticsKeepTextAndExcludeLegacyBinaryImages(t *testing.T) {
	e := NewEngine(t.TempDir(), nil)
	id, folder, err := e.newRunFolder()
	if err != nil {
		t.Fatal(err)
	}
	if err = atomicJSON(filepath.Join(folder, "meta.json"), Object{"id": id, "status": "completed"}); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string][]byte{"visual-observation.json": []byte(`{"page":"home"}`), "hierarchy.xml": []byte("<hierarchy/>"), "visual-before-send.png": {137, 80, 78, 71, 13, 10, 26, 10}} {
		if err = os.WriteFile(filepath.Join(folder, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	details, err := e.RunDetails(id)
	if err != nil {
		t.Fatal(err)
	}
	diagnostics := object(details["diagnostics"])
	if diagnostics["visual-observation.json"] == nil || diagnostics["hierarchy.xml"] == nil {
		t.Fatal("text diagnostics were lost")
	}
	if _, ok := diagnostics["visual-before-send.png"]; ok {
		t.Fatal("legacy image bytes were copied into JSON as text")
	}
}

func TestGoScreensFollowSharedJavaScriptContract(t *testing.T) {
	r := NewRuntime(context.Background(), NewCredentials())
	s := emptyScreen("chat")
	s.Title = "测试群(2)"
	s.Editor = &Editor{Point: Point{500, 900}, Text: ""}
	if _, err := r.Call("core", "validateScreen", s); err != nil {
		t.Fatal(err)
	}
}

func TestSearchSuggestionWithoutLocalAvatarCannotBecomeChatTarget(t *testing.T) {
	s := emptyScreen("search")
	s.Items = []Item{{Role: "search_input", Text: "搜索", Value: "测试群", Point: Point{500, 70}, Complete: true}, {Role: "chat", Text: "测试群", Point: Point{400, 333}, Complete: true}}
	checked := corroborateSearchRows(s, 0)
	if checked.Items[1].Complete || !checked.Items[0].Complete {
		t.Fatal("a search suggestion without an avatar remained a verified conversation")
	}
	actual := emptyScreen("search")
	actual.Items = []Item{{Role: "group", Text: "测试群", Point: Point{400, 333}, Complete: true}}
	if !corroborateSearchRows(actual, 1).Items[0].Complete {
		t.Fatal("locally corroborated search row was removed")
	}
}
func TestRegistryAndSchedulesLoadExistingDesktopDataReadOnly(t *testing.T) {
	source := os.Getenv("POR_LEGACY_DATA_DIR")
	if source == "" {
		t.Skip("set POR_LEGACY_DATA_DIR for compatibility with saved client data")
	}
	root := t.TempDir()
	for _, name := range []string{"workflow-store.json", "schedules.json", "vision-provider.json"} {
		if b, err := os.ReadFile(filepath.Join(source, name)); err == nil {
			if err = os.WriteFile(filepath.Join(root, name), b, 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	e := NewEngine(root, nil)
	if _, err := e.Store(); err != nil {
		t.Fatal(err)
	}
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	if _, err := e.Call(context.Background(), "list_schedules", Object{}); err != nil {
		t.Fatal(err)
	}
}
func TestAllSharedControllerWorkflowsThroughGoRuntime(t *testing.T) {
	r := NewRuntime(context.Background(), NewCredentials())
	fixture, err := os.ReadFile("../../scripts/test-mobile-workflows.mjs")
	if err != nil {
		t.Fatal(err)
	}
	text := string(fixture)
	start := strings.Index(text, "function fixture(")
	end := strings.Index(text[start:], "\ntest(")
	if start < 0 || end < 0 {
		t.Fatal("shared fixture boundary not found")
	}
	prefix := `function pair(role,text,point,value){return {role:role,text:text,point:point,value:value===undefined?null:value,complete:true}};function structuredClone(value){return JSON.parse(JSON.stringify(value));}var assert={equal:function(a,b){if(a!==b)throw Error('fixture assertion '+a+' != '+b)},ok:function(v,message){if(!v)throw Error(message||'assertion')}};`
	core, err := r.Module("core")
	if err != nil {
		t.Fatal(err)
	}
	_ = r.VM.Set("core", core)
	if _, err = r.VM.RunString(prefix + text[start:start+end]); err != nil {
		t.Fatal(err)
	}
	ws, err := bundled()
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range ws {
		w := object(value)
		id := str(w["id"])
		t.Run(id, func(t *testing.T) {
			_ = r.VM.Set("workflow", w)
			_, err = r.VM.RunString(`var sample=fixture();sample.runner.run(workflow,{dryRun:true,hooks:{},input:{message:{type:'manual',text:'Ok'},recipients:{groups:true,direct:false},intervalMs:1000}});if(sample.state.sendClicks!==0)throw Error('unexpected send');`)
			if err != nil {
				t.Fatal(err)
			}
			if id == "wecom-broadcast" {
				_, err = r.VM.RunString(`var sample=fixture({groups:['测试群']});
sample.state.outgoing.push({text:'Ok',pending:false,failed:false,position:7});
var observe=sample.io.observe;
sample.io.observe=function(){var screen=observe();if(sample.state.sendClicks){screen.outgoing=screen.outgoing.slice(-1);screen.outgoing[0].position=8}return screen};
sample.runner.run(workflow,{dryRun:false,input:{message:{type:'manual',text:'Ok'},recipients:{groups:true,direct:false},intervalMs:1000}});
if(sample.state.sendClicks!==1||sample.state.records[sample.state.records.length-1].outputs.completed_count!=='1')throw Error('identical visible message misclassified');`)
				if err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
