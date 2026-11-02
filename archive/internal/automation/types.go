package automation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

type Object = map[string]any

func now() int64 { return time.Now().UnixMilli() }
func object(v any) Object {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	b, _ := json.Marshal(v)
	var m Object
	_ = json.Unmarshal(b, &m)
	return m
}
func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}
func num(v any) float64 {
	switch n := v.(type) {
	case float64:
		return n
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case json.Number:
		f, _ := n.Float64()
		return f
	}
	return 0
}
func list(v any) []any {
	if a, ok := v.([]any); ok {
		return a
	}
	return []any{}
}
func clone(v any) Object  { b, _ := json.Marshal(v); var m Object; _ = json.Unmarshal(b, &m); return m }
func errf(s string) error { return errors.New(s) }

var serialPattern = regexp.MustCompile(`^[a-zA-Z0-9._:-]{1,100}$`)

func ValidSerial(s string) bool { return serialPattern.MatchString(s) }
func sleep(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}
func nameKey(s string) string {
	s = strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\r', '\n':
			return -1
		case '\u3000':
			return -1
		case '（':
			return '('
		case '）':
			return ')'
		case '｜', '丨':
			return '|'
		}
		return r
	}, s)
	s = regexp.MustCompile(`(?:…|\.{3}|·{3})`).ReplaceAllString(s, "…")
	return s
}
func sameTitle(a, b string) bool {
	a, b = nameKey(a), nameKey(b)
	if strings.Contains(a, "…") || strings.Contains(b, "…") {
		return false
	}
	if a == b {
		return true
	}
	p := regexp.QuoteMeta(b) + `\([0-9]+\)$`
	return regexp.MustCompile("^" + p).MatchString(a)
}

func JSON(v any) string { b, _ := json.Marshal(v); return string(b) }

type Device struct {
	Serial string `json:"serial"`
	State  string `json:"state"`
	Model  string `json:"model"`
}
type Point [2]int
type Item struct {
	Role     string `json:"role"`
	Text     string `json:"text"`
	Value    any    `json:"value"`
	Point    Point  `json:"point"`
	Complete bool   `json:"complete"`
}
type Editor struct {
	Point Point `json:"point"`
	Text  any   `json:"text"`
}
type Screen struct {
	Page      string  `json:"page"`
	Title     string  `json:"title"`
	Certain   bool    `json:"certain"`
	Items     []Item  `json:"items"`
	Editor    *Editor `json:"editor"`
	Outgoing  []any   `json:"outgoing"`
	ListEmpty bool    `json:"listEmpty"`
}

func emptyScreen(page string) Screen {
	return Screen{Page: page, Certain: true, Items: []Item{}, Outgoing: []any{}}
}
func (s Screen) Unique(role string) (Item, error) {
	var found []Item
	for _, i := range s.Items {
		if i.Role == role && i.Complete {
			found = append(found, i)
		}
	}
	if len(found) != 1 {
		return Item{}, fmt.Errorf("页面入口 %s 不唯一或不完整", role)
	}
	return found[0], nil
}
func decode(v any, dst any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	d := json.NewDecoder(strings.NewReader(string(b)))
	d.DisallowUnknownFields()
	return d.Decode(dst)
}
