//go:build desktoptest

package app

import (
	"context"
	"errors"
	"github.com/egoist/mygo"
	"os"
	"path/filepath"
	"por-auto/internal/automation"
	"time"
)

// The desktoptest build exercises the actual system WebView and IPC without changing production entry points.
func acceptance(win *mygo.Window, d *Desktop) {
	win.Page().OnDOMReady(func() {
		win.Show()
		win.Focus()
		go func() {
			out := os.Getenv("POR_DESKTOP_TEST_OUTPUT")
			if out == "" {
				return
			}
			_ = os.MkdirAll(out, 0700)
			report := map[string]any{}
			check := func(name, script string) bool {
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()
				v, e := win.Page().EvalContext(ctx, script)
				if e != nil {
					report[name] = e.Error()
					return false
				}
				report[name] = v
				return true
			}
			defer func() { _ = automation.SaveJSON(filepath.Join(out, "native-report.json"), report); mygo.App.Quit() }()
			check("ready", `for(let n=0;n<100;n++){if(document.querySelector('h1')?.textContent==='工作台')return true;await new Promise(r=>setTimeout(r,100))}throw Error('workspace not rendered')`)
			check("bridge", `const env=await window.mygo.call('Desktop.Call','check_environment',{});return {ready:env.ready,deviceCount:env.devices.length,platform:env.platform}`)
			check("initialize", `const button=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('初始化连接组件'));if(button){button.click();for(let n=0;n<100;n++){if(![...document.querySelectorAll('button')].some(b=>b.textContent.includes('初始化连接组件')))return true;await new Promise(r=>setTimeout(r,100))}throw Error('device panel did not refresh')}return true`)
			check("schedules", `const call=(name,args={})=>window.mygo.call('Desktop.Call',name,args);const store=await call('workflow_store');const workflow=store.installed.find(i=>i.workflow.id==='wecom-open');const saved=await call('save_schedule',{input:{name:'原生 IPC 回归',cron:'0 9 * * *',timezone:'Asia/Shanghai',enabled:false,workflowKey:workflow.key,serials:['por-native-smoke-absent'],updateWorkflow:false}});const task=saved.tasks.find(t=>t.name==='原生 IPC 回归');await call('run_schedule_now',{id:task.id});for(let n=0;n<100;n++){const view=await call('list_schedules');if(!view.runningIds.includes(task.id)){const history=await call('list_runs');const batch=history.find(r=>r.schedule_id===task.id&&r.serial.includes('台设备'));if(!batch)throw Error('batch history missing');const details=await call('run_details',{id:batch.id});if(details.batch.devices.length!==1||!details.batch.devices[0].error)throw Error('offline result not preserved');await call('delete_schedule',{id:task.id});return {status:batch.status,offlineDeviceProtected:true,historyRecords:history.length}}await new Promise(r=>setTimeout(r,100))}throw Error('schedule did not finish')`)
			for _, mode := range []string{"light", "dark", "system"} {
				script := `const mode='` + mode + `',labels={light:'浅色',dark:'深色',system:'跟随系统'};const trigger=document.querySelector('[role="combobox"][aria-label="主题"]');trigger.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,100));const option=[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()===labels[mode]);if(!option)throw Error('theme option missing');option.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));let saved=false;for(let n=0;n<100;n++){const settings=await window.mygo.call('Desktop.Call','ui_settings',{});if(settings.theme===mode&&trigger.textContent.includes(labels[mode])){saved=true;break}await new Promise(r=>setTimeout(r,50))}if(!saved)throw Error('theme was not saved');await new Promise(r=>setTimeout(r,500));document.getAnimations().forEach(a=>{try{a.finish()}catch{}});return {theme:mode,dark:document.documentElement.classList.contains('dark'),scheme:getComputedStyle(document.documentElement).colorScheme}`
				if !check(mode, script) {
					return
				}
				b, e := win.CapturePage()
				if e != nil {
					report[mode+"Capture"] = e.Error()
				} else {
					_ = os.WriteFile(filepath.Join(out, "native-"+mode+".png"), b, 0600)
				}
			}
			check("route", `location.hash='/settings';for(let n=0;n<100;n++){if(document.querySelector('h1')?.textContent==='设置')return document.body.textContent.includes('视觉模型');await new Promise(r=>setTimeout(r,100))}throw Error('settings did not render')`)
			if report["ready"] != true {
				report["error"] = errors.New("native smoke failed").Error()
			}
		}()
	})
}
