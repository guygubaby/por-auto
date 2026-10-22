package automation

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/dop251/goja"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"por-auto/assets"
	"strings"
	"time"
)

type Runtime struct {
	VM          *goja.Runtime
	modules     map[string]goja.Value
	Ctx         context.Context
	Credentials *Credentials
}

func NewRuntime(ctx context.Context, creds *Credentials) *Runtime {
	r := &Runtime{VM: goja.New(), modules: map[string]goja.Value{}, Ctx: ctx, Credentials: creds}
	r.VM.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	return r
}
func (r *Runtime) Module(name string) (goja.Value, error) {
	name = strings.TrimSuffix(strings.TrimPrefix(name, "./"), ".js")
	if v, ok := r.modules[name]; ok {
		return v, nil
	}
	source, e := assets.Files.ReadFile("runtime/" + name + ".js")
	if e != nil {
		return nil, e
	}
	v, e := r.VM.RunString("(function(require){var module={exports:{}};" + string(source) + ";return module.exports;})")
	if e != nil {
		return nil, e
	}
	fn, _ := goja.AssertFunction(v)
	out, e := fn(goja.Undefined(), r.VM.ToValue(func(name string) goja.Value {
		v, e := r.Module(name)
		if e != nil {
			panic(r.VM.NewGoError(e))
		}
		return v
	}))
	if e == nil {
		r.modules[name] = out
	}
	return out, e
}
func (r *Runtime) Call(module, method string, args ...any) (any, error) {
	m, e := r.Module(module)
	if e != nil {
		return nil, e
	}
	fn, ok := goja.AssertFunction(m.ToObject(r.VM).Get(method))
	if !ok {
		return nil, fmt.Errorf("缺少工作流方法 %s", method)
	}
	a := make([]goja.Value, len(args))
	for i, v := range args {
		if j, ok := v.(goja.Value); ok {
			a[i] = j
		} else {
			a[i] = r.VM.ToValue(v)
		}
	}
	v, e := fn(m, a...)
	if e != nil {
		return nil, e
	}
	return v.Export(), nil
}
func (r *Runtime) IO() *goja.Object {
	o := r.VM.NewObject()
	r.Bind(o, "now", func(a []goja.Value) (any, error) { return now(), nil })
	r.Bind(o, "parseUrl", func(a []goja.Value) (any, error) {
		u, e := url.Parse(a[0].String())
		if e != nil || u.Host == "" {
			return nil, nil
		}
		pass, _ := u.User.Password()
		return Object{"scheme": u.Scheme, "host": u.Hostname(), "username": u.User.Username(), "password": pass, "fragment": u.Fragment}, nil
	})
	r.Bind(o, "base64", func(a []goja.Value) (any, error) {
		return base64.StdEncoding.EncodeToString([]byte(a[0].String())), nil
	})
	r.Bind(o, "secret", func(a []goja.Value) (any, error) { return r.Credentials.Read("http", a[0].String(), a[1].String()) })
	r.Bind(o, "request", func(a []goja.Value) (any, error) { return HTTP(r.Ctx, object(a[0].Export())) })
	return o
}
func (r *Runtime) Bind(o *goja.Object, name string, fn func([]goja.Value) (any, error)) {
	_ = o.Set(name, func(c goja.FunctionCall) goja.Value {
		if e := r.Ctx.Err(); e != nil {
			panic(r.VM.NewGoError(e))
		}
		v, e := fn(c.Arguments)
		if e != nil {
			panic(r.VM.NewGoError(e))
		}
		return r.VM.ToValue(v)
	})
}
func HTTP(ctx context.Context, spec Object) (Object, error) {
	if timeout := num(spec["timeoutSeconds"]); timeout < 1 || timeout > 120 {
		return nil, errf("业务 HTTP 超时应为 1～120 秒")
	}
	u, err := url.Parse(str(spec["url"]))
	if err == nil && u.Scheme == "http" && u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" {
		return nil, errf("业务 HTTP 地址需要 HTTPS；仅本机服务可使用 HTTP")
	}
	return requestHTTP(ctx, spec, 65536)
}
func requestHTTP(ctx context.Context, spec Object, bodyLimit int) (Object, error) {
	u, e := url.Parse(str(spec["url"]))
	if e != nil || u.Host == "" || u.User != nil || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errf("请填写有效的 HTTP 或 HTTPS 地址，不在地址中包含鉴权或片段")
	}
	q := u.Query()
	for _, v := range list(spec["query"]) {
		p := object(v)
		q.Add(str(p["name"]), str(p["value"]))
	}
	u.RawQuery = q.Encode()
	var body io.Reader
	if spec["body"] != nil {
		b, e := json.Marshal(spec["body"])
		if e != nil || len(b) > bodyLimit {
			return nil, errf("HTTP 正文无效或过大")
		}
		body = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, str(spec["method"]), u.String(), body)
	if e != nil {
		return nil, errf("HTTP 请求无效")
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for _, v := range list(spec["headers"]) {
		p := object(v)
		req.Header.Add(str(p["name"]), str(p["value"]))
	}
	timeout := time.Duration(num(spec["timeoutSeconds"])) * time.Second
	if timeout < time.Second || timeout > 600*time.Second {
		return nil, errf("HTTP 超时无效")
	}
	client := &http.Client{Timeout: timeout, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Do(req)
	if e != nil {
		if errors.Is(e, context.DeadlineExceeded) {
			return nil, errf("HTTP 请求超时，未自动重试；请检查接口响应速度或调整超时")
		}
		return nil, errf("HTTP 请求未完成，未自动重试；请检查网络和接口")
	}
	defer resp.Body.Close()
	b, e := io.ReadAll(io.LimitReader(resp.Body, 524289))
	if e != nil || len(b) > 524288 {
		return nil, errf("HTTP 响应过大或读取失败")
	}
	return Object{"status": resp.StatusCode, "body": string(b)}, nil
}
func (r *Runtime) ValidateConfig(config Object) error {
	o := r.IO()
	if input := config["input"]; input != nil {
		if _, e := r.Call("core", "validateInput", input); e != nil {
			return e
		}
		m := object(object(input)["message"])
		if m["type"] == "http" {
			if _, e := r.Call("request", "validate", m["request"], o); e != nil {
				return e
			}
		}
	}
	for _, v := range object(config["hooks"]) {
		if v != nil {
			if _, e := r.Call("request", "validate", v, o); e != nil {
				return e
			}
		}
	}
	return nil
}
func (r *Runtime) Run(workflow, config Object, device *DeviceIO) (Object, error) {
	o := device.Bind(r)
	m, e := r.Module("core")
	if e != nil {
		return nil, e
	}
	fn, _ := goja.AssertFunction(m.ToObject(r.VM).Get("create"))
	runner, e := fn(m, o)
	if e != nil {
		return nil, e
	}
	run, _ := goja.AssertFunction(runner.ToObject(r.VM).Get("run"))
	v, e := run(runner, r.VM.ToValue(workflow), r.VM.ToValue(config))
	if e != nil {
		return nil, e
	}
	return object(v.Export()), nil
}
func (r *Runtime) Discover(scope string, device *DeviceIO) (any, error) {
	o := device.Bind(r)
	m, e := r.Module("core")
	if e != nil {
		return nil, e
	}
	fn, _ := goja.AssertFunction(m.ToObject(r.VM).Get("create"))
	runner, e := fn(m, o)
	if e != nil {
		return nil, e
	}
	discover, _ := goja.AssertFunction(runner.ToObject(r.VM).Get("discover"))
	v, e := discover(runner, r.VM.ToValue(scope))
	if e != nil {
		return nil, e
	}
	return v.Export(), nil
}
func writeEvidence(folder, name string, v any) error {
	return atomicJSON(filepath.Join(folder, name), v)
}
func appendEvent(folder, status, message string, detail any) error {
	p := filepath.Join(folder, "events.jsonl")
	f, e := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	defer f.Close()
	b, _ := json.Marshal(Object{"timestamp": now(), "step": 0, "status": status, "message": message, "details": detail})
	_, e = f.Write(append(b, '\n'))
	return e
}
