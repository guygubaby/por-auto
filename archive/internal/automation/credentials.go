package automation

import (
	"fmt"
	"github.com/google/uuid"
	"github.com/zalando/go-keyring"
	"strings"
	"sync"
	"unicode"
)

type credentialValue struct {
	Value string
	Err   error
}
type Credentials struct {
	mu       sync.Mutex
	cache    map[string]credentialValue
	bindings map[string]string
}

func NewCredentials() *Credentials {
	return &Credentials{cache: map[string]credentialValue{}, bindings: map[string]string{}}
}
func (c *Credentials) Bind(id, endpoint string) {
	if _, e := uuid.Parse(id); e == nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		if _, ok := c.bindings[id]; !ok {
			c.bindings[id] = endpoint
		}
	}
}
func (c *Credentials) Save(kind, endpoint, value string) (string, error) {
	if value == "" || len(value) > 2000 || strings.ContainsFunc(value, unicode.IsControl) {
		return "", errf("鉴权值为空、过长或包含控制字符")
	}
	id := uuid.NewString()
	if e := keyring.Set("com.por.wechatreader."+kind, id, value); e != nil {
		return "", errf("系统凭据保存失败，配置未更改")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bindings[id] = endpoint
	c.cache[kind+":"+id+":"+endpoint] = credentialValue{Value: value}
	return id, nil
}
func (c *Credentials) Read(kind, id, endpoint string) (string, error) {
	if _, e := uuid.Parse(id); e != nil {
		return "", errf("鉴权引用无效")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.bindings[id] != endpoint {
		return "", errf("接口地址已改变或凭据未绑定，请重新保存鉴权值")
	}
	key := kind + ":" + id + ":" + endpoint
	if v, ok := c.cache[key]; ok {
		return v.Value, v.Err
	}
	value, e := keyring.Get("com.por.wechatreader."+kind, id)
	if e != nil {
		e = fmt.Errorf("无法读取系统凭据；本次会话不再重复请求，请重新保存")
	}
	c.cache[key] = credentialValue{Value: value, Err: e}
	return value, e
}
func (c *Credentials) BindConfig(config Object) {
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			if u, ok := x["url"].(string); ok {
				a := object(x["auth"])
				c.Bind(str(a["credential"]), u)
			}
			for _, a := range x {
				walk(a)
			}
		case []any:
			for _, a := range x {
				walk(a)
			}
		}
	}
	walk(config)
}
