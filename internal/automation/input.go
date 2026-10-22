package automation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"por-auto/assets"
	"strings"
	"time"
)

const inputPackage = "com.por.auto.input"
const inputIME = inputPackage + "/.PorInputMethod"

func selectedIME(v string) bool {
	return v == inputIME || v == inputPackage+"/"+inputPackage+".PorInputMethod"
}

type InputFrame struct {
	Package  string `json:"packageName"`
	Session  string `json:"sessionId"`
	Text     string `json:"text"`
	Complete bool   `json:"complete"`
	Action   int    `json:"imeAction"`
	Owner    string `json:"ownerId"`
}
type Input struct {
	ADB                                                  ADB
	Package, Original, Session, Owner, Text, LastSession string
	Changed                                              bool
}

func nativeEmptyEditor(f *InputFrame, kind string) bool {
	return f != nil && f.Complete && f.Text == "" && ((kind == "search_input") == (f.Action == 3))
}
func corroborateEmptyEditor(f *InputFrame, visual any) bool {
	if f != nil {
		return nativeEmptyEditor(f, "message_editor")
	}
	return visual == ""
}

func StartInput(ctx context.Context, a ADB, pkg, folder string) (s *Input, err error) {
	if pkg != "com.tencent.wework" {
		return nil, errf("输入组件不支持目标应用")
	}
	apk, e := assets.Files.ReadFile("por-input.apk")
	if e != nil {
		return nil, e
	}
	manifest, _ := assets.Files.ReadFile("input-manifest.json")
	var meta Object
	if e = json.Unmarshal(manifest, &meta); e != nil {
		return nil, e
	}
	h := sha256.Sum256(apk)
	if hex.EncodeToString(h[:]) != str(meta["sha256"]) {
		return nil, errf("输入组件校验失败")
	}
	paths, _ := a.Shell(ctx, "pm", "path", inputPackage)
	exact := false
	if strings.HasPrefix(paths, "package:/data/app/") && !strings.Contains(paths, "\n") {
		p := strings.TrimPrefix(paths, "package:")
		if strings.HasSuffix(p, "/base.apk") {
			existing, e := a.Run(ctx, "exec-out", "cat "+shellQuote(p))
			exact = e == nil && bytes.Equal(existing, apk)
		}
	}
	if !exact {
		p := filepath.Join(folder, "por-input.apk")
		if e = os.WriteFile(p, apk, 0600); e != nil {
			return nil, e
		}
		defer os.Remove(p)
		out, e := a.runFrom(ctx, filepath.Dir(p), "install", "-r", filepath.Base(p))
		if e != nil || !strings.Contains(string(out), "Success") {
			return nil, errf("输入组件安装未完成，请在手机确认安装")
		}
	}
	original, e := a.Shell(ctx, "settings", "get", "secure", "default_input_method")
	if e != nil || !strings.Contains(original, "/") || strings.ContainsAny(original, "\r\n") {
		return nil, errf("无法保存原键盘设置")
	}
	s = &Input{ADB: a, Package: pkg, Original: original}
	defer func() {
		if err != nil {
			_ = s.Restore()
		}
	}()
	if !selectedIME(original) {
		if _, e = a.Shell(ctx, "ime", "enable", inputIME); e != nil {
			return s, e
		}
		s.Changed = true
		if _, e = a.Shell(ctx, "ime", "set", inputIME); e != nil {
			return s, e
		}
		v, e := a.Shell(ctx, "settings", "get", "secure", "default_input_method")
		if e != nil || !selectedIME(v) {
			return s, errf("原生输入组件未选中")
		}
	}
	_, e = s.call(ctx, "status", Object{})
	return s, e
}
func (s *Input) call(ctx context.Context, method string, arg Object) (Object, error) {
	arg["protocolVersion"] = 1
	raw, e := s.ADB.Shell(ctx, "content call --uri content://com.por.auto.input --method "+method+" --arg "+shellQuote(JSON(arg)))
	if e != nil {
		return nil, e
	}
	const prefix = "Result: Bundle[{result="
	if !strings.HasPrefix(raw, prefix) || !strings.HasSuffix(raw, "}]") {
		return nil, errf("输入组件返回格式无效，未自动重试")
	}
	var v Object
	if e = json.Unmarshal([]byte(raw[len(prefix):len(raw)-2]), &v); e != nil {
		return nil, errf("输入组件返回 JSON 无效")
	}
	if v["ok"] != true {
		return v, fmt.Errorf("原生输入未完成：%s；未自动重试", str(v["error"]))
	}
	if num(v["protocolVersion"]) != 1 || num(v["versionCode"]) < 1 {
		return nil, errf("输入组件版本不兼容")
	}
	return v, nil
}
func (s *Input) Read(ctx context.Context) (*InputFrame, error) {
	v, e := s.call(ctx, "read", Object{"packageName": s.Package})
	if e != nil {
		if v != nil && (v["error"] == "NO_EDITOR" || v["error"] == "PRIVATE_OR_UNSUPPORTED_EDITOR" || v["error"] == "IME_NOT_SELECTED") {
			return nil, nil
		}
		return nil, e
	}
	var f InputFrame
	b, _ := json.Marshal(v)
	if e = json.Unmarshal(b, &f); e != nil {
		return nil, e
	}
	if f.Package != s.Package || !f.Complete || len(f.Text) > 4000 || f.Session == "" || len(f.Session) > 100 {
		return nil, errf("原生输入内容或位置不完整")
	}
	return &f, nil
}
func (s *Input) Write(ctx context.Context, text string) error {
	if len(text) > 4000 || strings.TrimSpace(text) == "" {
		return errf("消息为空或过长")
	}
	f, e := s.Read(ctx)
	if e != nil {
		return e
	}
	if f == nil || f.Text != "" {
		return errf("输入焦点缺失或已有草稿，未覆盖")
	}
	v, e := s.call(ctx, "write", Object{"packageName": s.Package, "sessionId": f.Session, "requestId": uuid.NewString(), "text": text})
	if e != nil {
		return e
	}
	if str(v["sessionId"]) != f.Session || v["text"] != text || str(v["ownerId"]) == "" {
		return errf("原生输入结果不明，未重试")
	}
	s.Session = f.Session
	s.LastSession = f.Session
	s.Owner = str(v["ownerId"])
	s.Text = text
	return nil
}
func (s *Input) Verify(ctx context.Context, text string) error {
	f, e := s.Read(ctx)
	if e != nil {
		return e
	}
	if f == nil || s.Owner == "" || f.Session != s.Session || f.Text != text || s.Text != text {
		return errf("会话输入连接或草稿已变化，未发送或清理")
	}
	return nil
}
func (s *Input) Clear(ctx context.Context, text string) error {
	if e := s.Verify(ctx, text); e != nil {
		return e
	}
	v, e := s.call(ctx, "clearOwned", Object{"packageName": s.Package, "sessionId": s.Session, "ownerId": s.Owner, "requestId": uuid.NewString()})
	if e != nil {
		return e
	}
	if v["sessionId"] != s.Session || v["text"] != "" {
		return errf("原生草稿清理结果不明，未重试")
	}
	s.Owner = ""
	s.Text = ""
	return nil
}
func (s *Input) Restore() error {
	if s == nil || !s.Changed {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// A brief USB reconnect must not skip restoring the keyboard we selected.
	if _, err := s.ADB.Text(ctx, "wait-for-device"); err != nil {
		return err
	}
	return s.restoreUsing(func() (string, error) {
		return s.ADB.Shell(ctx, "settings", "get", "secure", "default_input_method")
	}, func() error {
		_, err := s.ADB.Shell(ctx, "ime", "set", s.Original)
		return err
	})
}

func (s *Input) restoreUsing(read func() (string, error), selectOriginal func() error) error {
	v, e := read()
	if e != nil {
		return e
	}
	if !selectedIME(v) {
		s.Changed = false
		return nil
	}
	if e = selectOriginal(); e != nil {
		return e
	}
	v, e = read()
	if e != nil {
		return e
	}
	if v != s.Original {
		return errf("原键盘恢复未完成，请在手机选择日常键盘")
	}
	s.Changed = false
	return nil
}
