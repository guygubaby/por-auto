package automation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type ADB struct{ Path, Serial string }

func (a ADB) Run(ctx context.Context, args ...string) ([]byte, error) {
	return a.runFrom(ctx, "", args...)
}
func (a ADB) runFrom(ctx context.Context, dir string, args ...string) ([]byte, error) {
	if a.Serial != "" {
		if !ValidSerial(a.Serial) {
			return nil, errf("手机标识无效")
		}
		args = append([]string{"-s", a.Serial}, args...)
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, a.Path, args...)
	cmd.Dir = dir
	hideConsole(cmd)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		m := strings.TrimSpace(stderr.String())
		if len(m) > 400 {
			m = m[:400]
		}
		return nil, fmt.Errorf("手机操作失败：%s (%w)", m, err)
	}
	return out, nil
}
func (a ADB) Text(ctx context.Context, args ...string) (string, error) {
	b, e := a.Run(ctx, args...)
	return strings.TrimSpace(string(b)), e
}
func (a ADB) Shell(ctx context.Context, args ...string) (string, error) {
	return a.Text(ctx, append([]string{"shell"}, args...)...)
}
func (a ADB) Push(ctx context.Context, local, remote string) error {
	abs, e := filepath.Abs(local)
	if e != nil {
		return e
	}
	_, e = a.runFrom(ctx, filepath.Dir(abs), "push", filepath.Base(abs), remote)
	return e
}
func ParseDevices(text string) []Device {
	result := []Device{}
	for _, line := range strings.Split(text, "\n") {
		f := strings.Fields(line)
		if len(f) < 2 || !ValidSerial(f[0]) || f[0] == "List" || strings.HasPrefix(f[0], "*") {
			continue
		}
		d := Device{Serial: f[0], State: f[1], Model: f[0]}
		for _, v := range f[2:] {
			if strings.HasPrefix(v, "model:") {
				d.Model = strings.ReplaceAll(strings.TrimPrefix(v, "model:"), "_", " ")
			}
		}
		result = append(result, d)
	}
	return result
}
func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }

var packagePattern = regexp.MustCompile(`^[A-Za-z0-9_.]+$`)

func focusedPackages(windows string) (string, string) {
	var focus string
	for _, line := range strings.Split(windows, "\n") {
		if _, value, ok := strings.Cut(line, "mCurrentFocus="); ok {
			focus = strings.TrimSpace(value)
			break
		}
	}
	if focus == "" || focus == "null" {
		focus = ""
	}
	inside := false
	for _, line := range strings.Split(windows, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "Window #") {
			if inside {
				break
			}
			inside = strings.HasSuffix(line, " "+focus+":")
		} else if inside {
			for _, word := range strings.Fields(line) {
				key, value, ok := strings.Cut(word, "=")
				if ok && (key == "package" || key == "packageName") && packagePattern.MatchString(value) {
					return value, focusApp(windows)
				}
			}
		}
	}
	var owner string
	for _, word := range strings.Fields(focus) {
		if owner, _, ok := strings.Cut(word, "/"); ok && packagePattern.MatchString(owner) {
			return owner, focusApp(windows)
		}
	}
	return owner, focusApp(windows)
}
func focusApp(windows string) string {
	for _, line := range strings.Split(windows, "\n") {
		if _, value, ok := strings.Cut(line, "mFocusedApp="); ok {
			for _, word := range strings.Fields(value) {
				if owner, _, ok := strings.Cut(word, "/"); ok && packagePattern.MatchString(owner) {
					return owner
				}
			}
			return ""
		}
	}
	return ""
}
func focusedPackage(windows string) string {
	owner, _ := focusedPackages(windows)
	return owner
}

func (a ADB) Foreground(ctx context.Context, pkg string) error {
	return awaitForeground(ctx, pkg, func() (string, bool, error) {
		policy, err := a.Shell(ctx, "dumpsys", "window", "policy")
		if err != nil || strings.Contains(policy, "showing=true") {
			return "", strings.Contains(policy, "showing=true"), err
		}
		windows, err := a.Shell(ctx, "dumpsys", "window", "windows")
		owner, app := focusedPackages(windows)
		if owner == "" && app == pkg {
			return "", false, err
		}
		return owner, false, err
	})
}

func awaitForeground(ctx context.Context, pkg string, read func() (string, bool, error)) error {
	for attempt := 0; attempt < 4; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		owner, locked, err := read()
		if err != nil {
			return err
		}
		if locked {
			return errf("手机已锁屏，未操作或读取锁屏画面")
		}
		if owner == pkg {
			return nil
		}
		// Android may briefly have no focused window while a chat opens.
		if owner != "" || attempt == 3 {
			return fmt.Errorf("目标应用未处于前台（当前窗口：%q），未操作其他应用", owner)
		}
		if err := sleep(ctx, 250*time.Millisecond); err != nil {
			return err
		}
	}
	return nil
}
func (a ADB) Launch(ctx context.Context, pkg, activity string) (string, error) {
	out, err := a.Shell(ctx, "am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "--activity-reset-task-if-needed", "-n", pkg+"/"+activity)
	if err != nil {
		return out, err
	}
	if strings.Contains(out, "Error") || strings.Contains(out, "Exception") {
		return out, errf("无法打开目标应用，请先解锁手机并手动打开")
	}
	observeCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	for {
		if err = a.Foreground(observeCtx, pkg); err == nil {
			return out, nil
		}
		if sleep(observeCtx, 300*time.Millisecond) != nil {
			return out, errf("启动后未确认目标应用处于前台，请检查手机解锁和应用状态")
		}
	}
}
func (a ADB) Tap(ctx context.Context, pkg string, p Point, w, h int) error {
	if e := a.Foreground(ctx, pkg); e != nil {
		return e
	}
	if p[0] <= 0 || p[0] >= 1000 || p[1] <= 0 || p[1] >= 1000 || w < 100 || h < 100 {
		return errf("点击位置超出屏幕，未点击")
	}
	_, e := a.Shell(ctx, "input", "tap", fmt.Sprint(p[0]*w/1000), fmt.Sprint(p[1]*h/1000))
	if e != nil {
		return e
	}
	return sleep(ctx, 700*time.Millisecond)
}
func (a ADB) WakeSession(ctx context.Context) (func() error, error) {
	v, e := a.Shell(ctx, "settings", "get", "global", "stay_on_while_plugged_in")
	if e != nil {
		return nil, e
	}
	if !regexp.MustCompile(`^[0-9]+$`).MatchString(v) {
		return nil, errf("无法保存原唤醒设置")
	}
	// Some USB-connected phones report AC power.
	_, e = a.Shell(ctx, "svc", "power", "stayon", "true")
	if e != nil {
		return nil, e
	}
	return func() error {
		_, e := a.Shell(context.Background(), "settings", "put", "global", "stay_on_while_plugged_in", v)
		return e
	}, nil
}
func atomicJSON(path string, v any) error {
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(path), 0700); e != nil {
		return e
	}
	tmp := path + ".next"
	f, e := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if e != nil {
		return e
	}
	if _, e = f.Write(b); e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(tmp, path)
}
