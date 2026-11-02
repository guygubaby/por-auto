package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func configureUpdateProxy() {
	if runtime.GOOS != "darwin" {
		return
	}
	// MyGo uses DefaultClient for both update manifests and signed archives.
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = func(req *http.Request) (*url.URL, error) {
		for _, key := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"} {
			if os.Getenv(key) != "" {
				return http.ProxyFromEnvironment(req)
			}
		}
		host := req.URL.Hostname()
		if host == "localhost" || net.ParseIP(host).IsLoopback() {
			return nil, nil
		}
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		settings, err := exec.CommandContext(ctx, "/usr/sbin/scutil", "--proxy").Output()
		if err != nil {
			return nil, fmt.Errorf("读取 macOS 系统代理失败: %w", err)
		}
		return macOSUpdateProxy(string(settings), req.URL.Scheme, req.URL.Hostname())
	}
	http.DefaultClient.Transport = transport
}

func macOSUpdateProxy(settings, scheme, host string) (*url.URL, error) {
	values := map[string]string{}
	var exceptions []string
	depth, inExceptions := 0, false
	for line := range strings.SplitSeq(settings, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 3 && fields[1] == ":" {
			if depth == 1 {
				values[fields[0]] = fields[2]
			} else if depth == 2 && inExceptions {
				exceptions = append(exceptions, fields[2])
			}
		}
		if depth == 1 && strings.HasPrefix(strings.TrimSpace(line), "ExceptionsList : <array>") {
			inExceptions = true
		}
		depth += strings.Count(line, "{") - strings.Count(line, "}")
		if depth < 2 {
			inExceptions = false
		}
	}
	host = strings.TrimSuffix(strings.ToLower(host), ".")
	ip := net.ParseIP(host)
	if values["ExcludeSimpleHostnames"] == "1" && !strings.Contains(host, ".") && ip == nil {
		return nil, nil
	}
	for _, pattern := range exceptions {
		pattern = strings.ToLower(pattern)
		match, _ := path.Match(pattern, host)
		_, network, err := net.ParseCIDR(pattern)
		if match || err == nil && network.Contains(ip) || pattern == "<local>" && ip == nil && !strings.Contains(host, ".") {
			return nil, nil
		}
	}
	// shortcut: manual HTTP/HTTPS proxies only; use a native resolver when PAC support is needed.
	prefix := strings.ToUpper(scheme)
	if values[prefix+"Enable"] != "1" {
		return nil, nil
	}
	host, port := values[prefix+"Proxy"], values[prefix+"Port"]
	number, err := strconv.Atoi(port)
	if host == "" || err != nil || number < 1 || number > 65535 {
		return nil, fmt.Errorf("macOS %s 代理地址或端口无效", prefix)
	}
	return &url.URL{Scheme: "http", Host: net.JoinHostPort(host, port)}, nil
}
