package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/dop251/goja"
	"os"
	"path/filepath"
	"time"
)

type DeviceIO struct {
	Ctx                                            context.Context
	ADB                                            ADB
	Package, Folder, RunID, WorkflowKey, Scope     string
	Visual                                         bool
	Vision                                         Vision
	Input                                          *Input
	U2                                             *U2
	Runtime                                        *Runtime
	Width, Height                                  int
	LastPhoto                                      *Photo
	Last                                           Screen
	LastHierarchy, CurrentStep                     string
	Events                                         []Object
	Result                                         Object
	Nodes                                          []*Node
	wecomIDs                                       Object
	OwnedTitle, OwnedText, CommitTitle, CommitText string
	Emit                                           func(string, any)
	Step, Total                                    int
}

func (d *DeviceIO) observe(hint string) (Screen, error) {
	var s Screen
	var e error
	if d.Visual {
		s, e = d.observeVisual(hint)
	} else {
		s, e = d.observeNative()
	}
	if e == nil {
		d.Last = s
	}
	return s, e
}
func (d *DeviceIO) click(p Point) error {
	sending := d.CommitTitle != ""
	for _, item := range d.Last.Items {
		if d.Last.Page == "chat" && item.Role == "send" && item.Point == p {
			sending = true
		}
	}
	if sending {
		if e := verifySend(d.Last, p, d.CommitTitle, d.CommitText); e != nil {
			return e
		}
		if d.Input != nil {
			if e := d.Input.Verify(d.Ctx, d.CommitText); e != nil {
				return e
			}
		}
		fresh, e := d.observe("")
		if e != nil {
			return e
		}
		if e = verifySend(fresh, p, d.CommitTitle, d.CommitText); e != nil {
			return e
		}
		if d.Visual {
			if e = d.unchanged(d.LastPhoto, fresh.Editor.Point, true); e != nil {
				return e
			}
		}
		d.CommitTitle, d.CommitText = "", ""
	}
	return d.ADB.Tap(d.Ctx, d.Package, p, d.Width, d.Height)
}
func verifySend(s Screen, p Point, title, text string) error {
	if title == "" || text == "" || s.Page != "chat" || !sameTitle(s.Title, title) || s.Editor == nil || s.Editor.Text != text {
		return errf("发送前目标或完整草稿已变化，未点击")
	}
	var buttons []Item
	for _, item := range s.Items {
		if item.Role == "send" {
			buttons = append(buttons, item)
		}
	}
	if len(buttons) != 1 || !buttons[0].Complete || buttons[0].Text != "发送" || buttons[0].Point != p {
		return errf("发送按钮位置变化或不唯一，未点击")
	}
	return nil
}
func (d *DeviceIO) back() error {
	if e := d.ADB.Foreground(d.Ctx, d.Package); e != nil {
		return e
	}
	_, e := d.ADB.Shell(d.Ctx, "input", "keyevent", "KEYCODE_BACK")
	return e
}
func (d *DeviceIO) Bind(r *Runtime) *goja.Object {
	d.Runtime = r
	o := r.IO()
	_ = o.Set("runId", d.RunID)
	_ = o.Set("serial", d.ADB.Serial)
	_ = o.Set("package", d.Package)
	r.Bind(o, "sleep", func(a []goja.Value) (any, error) {
		return nil, sleep(d.Ctx, time.Duration(a[0].ToInteger())*time.Millisecond)
	})
	r.Bind(o, "wake", func(a []goja.Value) (any, error) {
		_, e := d.ADB.Shell(d.Ctx, "input", "keyevent", "KEYCODE_WAKEUP")
		return nil, e
	})
	r.Bind(o, "launch", func(a []goja.Value) (any, error) {
		activity := ".launch.LaunchSplashActivity"
		if len(a) > 0 && !goja.IsUndefined(a[0]) && a[0].String() != "" {
			activity = a[0].String()
		}
		_, e := d.ADB.Launch(d.Ctx, d.Package, activity)
		if e != nil {
			return nil, e
		}
		return nil, sleep(d.Ctx, time.Second)
	})
	r.Bind(o, "observe", func(a []goja.Value) (any, error) {
		hint := ""
		if len(a) > 0 {
			hint = a[0].String()
		}
		return d.observe(hint)
	})
	r.Bind(o, "click", func(a []goja.Value) (any, error) { return nil, d.click(toPoint(a[0].Export())) })
	r.Bind(o, "back", func(a []goja.Value) (any, error) { return nil, d.back() })
	r.Bind(o, "scroll", func(a []goja.Value) (any, error) {
		up := a[0].ToBoolean()
		if !d.Visual {
			return d.scrollNative(up)
		}
		if e := d.ADB.Foreground(d.Ctx, d.Package); e != nil {
			return nil, e
		}
		y1, y2 := d.Height*73/100, d.Height*35/100
		if up {
			y1, y2 = y2, y1
		}
		_, e := d.ADB.Shell(d.Ctx, "input", "swipe", fmt.Sprint(d.Width/2), fmt.Sprint(y1), fmt.Sprint(d.Width/2), fmt.Sprint(y2), "650")
		return nil, e
	})
	r.Bind(o, "openRow", func(a []goja.Value) (any, error) {
		title, page := a[0].String(), a[1].String()
		if d.Visual {
			return nil, d.openVisualRow(title, page, toPoint(a[2].Export()))
		}
		return nil, d.openNativeRow(title, page)
	})
	r.Bind(o, "clickTab", func(a []goja.Value) (any, error) {
		s, e := d.observe("核对底部完整四个导航标签")
		if e != nil {
			return nil, e
		}
		var found []Item
		for _, i := range s.Items {
			if i.Role == "tab" && i.Text == a[0].String() && i.Complete {
				found = append(found, i)
			}
		}
		if len(found) != 1 {
			return nil, errf("底部导航不唯一")
		}
		return nil, d.click(found[0].Point)
	})
	r.Bind(o, "ensureEditor", func(a []goja.Value) (any, error) {
		title := a[0].String()
		s, e := d.observe("核对底部输入栏，文字模式不要切到语音模式")
		if e != nil {
			return nil, e
		}
		if s.Page != "chat" || !sameTitle(s.Title, title) {
			return nil, errf("当前不是目标会话")
		}
		if s.Editor != nil && s.Editor.Text == nil && d.Input != nil {
			f, e := d.Input.Read(d.Ctx)
			if e != nil {
				return nil, e
			}
			if corroborateEmptyEditor(f, nil) {
				s.Editor.Text = ""
			}
		}
		if s.Editor == nil {
			if d.Visual {
				p, e := d.photo()
				if e != nil {
					return nil, e
				}
				m, e := d.metrics(p)
				if e != nil {
					return nil, e
				}
				target, e := r.Call("markers", "composerTarget", p.Width, p.Height, m)
				if e != nil {
					return nil, e
				}
				t := object(target)
				b, e := p.Crop(list(t["crop"]))
				if e != nil {
					return nil, e
				}
				probe, e := d.Vision.Observe(d.Ctx, b, "Inspect only the composer row. Return JSON {\"mode\":\"text|voice|unknown\"}. Text is an editable field, voice is 按住说话. Do not guess.")
				if e != nil {
					return nil, e
				}
				mode := str(object(probe)["mode"])
				if mode == "voice" {
					if e = d.click(toPoint(t["keyboard"])); e != nil {
						return nil, e
					}
				} else if mode != "text" {
					return nil, errf("无法确认文字或语音输入模式")
				}
				s, e = d.observe("完整核对底部文字编辑框")
				if e != nil {
					return nil, e
				}
			} else {
				button, e := s.Unique("keyboard")
				if e != nil {
					return nil, e
				}
				if e = d.click(button.Point); e != nil {
					return nil, e
				}
				s, e = d.observe("")
				if e != nil {
					return nil, e
				}
			}
		}
		if s.Editor != nil && s.Editor.Text == nil && d.Input != nil {
			f, e := d.Input.Read(d.Ctx)
			if e != nil {
				return nil, e
			}
			if corroborateEmptyEditor(f, nil) {
				s.Editor.Text = ""
			}
		}
		if s.Editor == nil {
			return nil, errf("无法确认文字输入框")
		}
		return s, nil
	})
	r.Bind(o, "type", func(a []goja.Value) (any, error) {
		text := a[0].String()
		p := toPoint(a[1].Export())
		title := ""
		if len(a) > 2 {
			title = a[2].String()
		}
		if !d.Visual && d.Package == "com.tencent.wework" {
			return nil, d.editNative("", text, title)
		}
		if d.Input == nil {
			return nil, errf("原生输入组件未准备")
		}
		kind := "search_input"
		if title != "" {
			kind = "message_editor"
			if d.Last.Page != "chat" || !sameTitle(d.Last.Title, title) {
				return nil, errf("输入前会话不匹配")
			}
		}
		f, e := d.Input.Read(d.Ctx)
		if e != nil {
			return nil, e
		}
		if nativeEmptyEditor(f, kind) {
			return nil, d.Input.Write(d.Ctx, text)
		}
		if e := d.focus(kind, p); e != nil {
			return nil, e
		}
		return nil, d.Input.Write(d.Ctx, text)
	})
	r.Bind(o, "clear", func(a []goja.Value) (any, error) {
		text := a[0].String()
		if d.CommitTitle == "" || d.CommitText != text {
			return nil, errf("缺少本轮草稿清理核对，未修改")
		}
		d.CommitTitle, d.CommitText = "", ""
		if !d.Visual && d.Package == "com.tencent.wework" {
			return nil, d.editNative(text, "", d.OwnedTitle)
		}
		if d.Input == nil {
			return nil, errf("输入连接缺失")
		}
		if e := d.Input.Clear(d.Ctx, text); e != nil {
			return nil, e
		}
		f, e := d.Input.Read(d.Ctx)
		if e != nil {
			return nil, e
		}
		if f == nil || f.Text != "" || f.Action == 3 {
			return nil, errf("原生草稿清理后无法确认空输入框")
		}
		return nil, nil
	})
	r.Bind(o, "beforeCommit", func(a []goja.Value) (any, error) {
		p, title, text := toPoint(a[0].Export()), a[1].String(), a[2].String()
		for n := 0; n < 3; n++ {
			s, e := d.observe("再次核对接收对象与完整草稿")
			if e != nil {
				return nil, e
			}
			if s.Page != "chat" || !sameTitle(s.Title, title) || s.Editor == nil || s.Editor.Text != text {
				return nil, errf("提交前会话或草稿已变化")
			}
			if d.Input != nil {
				if e = d.Input.Verify(d.Ctx, text); e != nil {
					return nil, e
				}
			}
			if d.Visual {
				if e = d.unchanged(d.LastPhoto, p, true); e != nil {
					continue
				}
			}
			d.CommitTitle, d.CommitText = title, text
			return nil, nil
		}
		return nil, errf("页面持续变化，未发送或清理")
	})
	r.Bind(o, "log", func(a []goja.Value) (any, error) {
		status := a[0].String()
		var details any
		if len(a) > 1 {
			details = a[1].Export()
		}
		if status == "step_completed" {
			d.Step++
		}
		if status == "step_started" || status == "step_completed" {
			d.CurrentStep = str(object(details)["name"])
			d.report(str(object(details)["name"]))
		}
		d.Events = append(d.Events, Object{"timestamp": now(), "step": d.Step, "status": status, "message": status, "details": details})
		if len(d.Events) > 32 {
			d.Events = d.Events[1:]
		}
		return nil, nil
	})
	r.Bind(o, "record", func(a []goja.Value) (any, error) {
		v := object(a[0].Export())
		if err := writeEvidence(d.Folder, "result.json", v); err != nil {
			return nil, err
		}
		d.Result = v
		return nil, nil
	})
	if !d.Visual && d.Package == "com.tencent.wework" {
		r.Bind(o, "home", func(a []goja.Value) (any, error) { return d.nativeHome() })
		r.Bind(o, "recipientPage", func(a []goja.Value) (any, error) { return d.recipientNative(a[0].String()) })
		r.Bind(o, "openNamed", func(a []goja.Value) (any, error) { return nil, d.openNativeNamed(a[0].String(), a[1].String()) })
		r.Bind(o, "nickname", func(a []goja.Value) (any, error) { return d.nicknameNative() })
	}
	return o
}
func (d *DeviceIO) saveFailure(failure error) error {
	if err := writeEvidence(d.Folder, "failure.log", Object{"error": failure.Error(), "step": d.Step + 1, "stepName": d.CurrentStep, "target": d.OwnedTitle, "page": d.Last.Page, "title": d.Last.Title}); err != nil {
		return err
	}
	var events []byte
	for _, event := range d.Events {
		events = append(events, append(marshal(event), '\n')...)
	}
	if err := os.WriteFile(filepath.Join(d.Folder, "events.jsonl"), events, 0600); err != nil {
		return err
	}
	if d.LastHierarchy != "" {
		return os.WriteFile(filepath.Join(d.Folder, "hierarchy.xml"), []byte(d.LastHierarchy[:min(len(d.LastHierarchy), 32*1024)]), 0600)
	}
	return nil
}
func (d *DeviceIO) report(message string) {
	if d.Emit != nil {
		d.Emit("workflow-progress", Object{"serial": d.ADB.Serial, "workflow_key": d.WorkflowKey, "step": d.Step, "total": d.Total, "message": message})
	}
}
func marshal(v any) []byte { b, _ := json.Marshal(v); return b }
