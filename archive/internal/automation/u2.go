package automation

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

type U2 struct {
	ADB     ADB
	Port    string
	Process *exec.Cmd
	Client  *http.Client
	exited  chan struct{}
	log     *os.File
}
type limitedDeviceLog struct {
	writer io.Writer
	left   int
	mu     sync.Mutex
}

func (l *limitedDeviceLog) Write(data []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	length := len(data)
	if l.left > 0 {
		n, err := l.writer.Write(data[:min(length, l.left)])
		l.left -= n
		if err != nil {
			return n, err
		}
	}
	return length, nil
}

func StartU2(ctx context.Context, a ADB, resources, folder string) (*U2, error) {
	for _, f := range []string{"u2.jar", "u2-hint.dex"} {
		if e := a.Push(ctx, filepath.Join(resources, f), "/data/local/tmp/por-"+f); e != nil {
			return nil, e
		}
	}
	port, e := a.Text(ctx, "forward", "tcp:0", "tcp:9010")
	if e != nil {
		return nil, e
	}
	p, e := strconv.Atoi(port)
	if e != nil || p < 1 || p > 65535 {
		return nil, errf("自动化端口无效")
	}
	u := &U2{ADB: a, Port: port, Client: &http.Client{Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	u.stopServer()
	log, e := os.OpenFile(filepath.Join(folder, "u2-server.log"), os.O_CREATE|os.O_WRONLY, 0600)
	if e != nil {
		u.Close()
		return nil, e
	}
	u.log = log
	cmd := exec.Command(a.Path, "-s", a.Serial, "shell", "CLASSPATH=/data/local/tmp/por-u2-hint.dex:/data/local/tmp/por-u2.jar app_process / com.wetest.uia2.Main -p 9010")
	hideConsole(cmd)
	bounded := &limitedDeviceLog{writer: log, left: 32 * 1024}
	cmd.Stdout = bounded
	cmd.Stderr = bounded
	if e = cmd.Start(); e != nil {
		u.Close()
		return nil, e
	}
	u.Process = cmd
	u.exited = make(chan struct{})
	go func() { _ = cmd.Wait(); close(u.exited) }()
	for {
		select {
		case <-u.exited:
			u.Close()
			return nil, errf("手机自动化服务已退出，请检查 u2-server.log")
		default:
		}
		req, _ := http.NewRequestWithContext(ctx, "GET", u.url("/ping"), nil)
		resp, e := u.Client.Do(req)
		if e == nil {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 100))
			resp.Body.Close()
			if string(b) == "pong" {
				_, e = u.RPC(ctx, "setConfigurator", []any{Object{"uiAutomationFlags": 3}})
				if e == nil {
					if _, e = u.RPC(ctx, "deviceInfo", []any{}); e == nil {
						return u, nil
					}
				}
				break
			}
		}
		if sleep(ctx, 300*time.Millisecond) != nil {
			break
		}
	}
	u.Close()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return nil, errf("手机自动化服务未就绪，请保持手机解锁")
}
func (u *U2) url(path string) string { return "http://127.0.0.1:" + u.Port + path }
func (u *U2) RPC(ctx context.Context, method string, params any) (any, error) {
	body, _ := json.Marshal(Object{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req, _ := http.NewRequestWithContext(ctx, "POST", u.url("/jsonrpc/0"), bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, e := u.Client.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("原生操作响应未知，未自动重试：%w", e)
	}
	defer resp.Body.Close()
	b, e := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024+1))
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if e != nil || len(b) > 4*1024*1024 {
		return nil, errf("原生控件响应无效")
	}
	var v Object
	if e = json.Unmarshal(b, &v); e != nil {
		return nil, e
	}
	if num(v["id"]) != 1 || v["jsonrpc"] != "2.0" {
		return nil, errf("原生操作响应不匹配")
	}
	if v["error"] != nil {
		return nil, fmt.Errorf("原生操作失败：%s", str(object(v["error"])["message"]))
	}
	return v["result"], nil
}
func (u *U2) Close() {
	if u == nil {
		return
	}
	if u.Process != nil && u.Process.Process != nil {
		_ = u.Process.Process.Kill()
		<-u.exited
	}
	if u.log != nil {
		_ = u.log.Close()
	}
	u.stopServer()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _ = u.ADB.Text(ctx, "forward", "--remove", "tcp:"+u.Port)
}
func (u *U2) stopServer() {
	// Cleanup must finish even when the device no longer responds.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", u.url("/stop"), nil)
	if r, e := u.Client.Do(req); e == nil {
		r.Body.Close()
	}
}
