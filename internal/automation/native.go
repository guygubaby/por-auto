package automation

import (
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Node struct {
	Attr        map[string]string
	Bounds      [4]int
	Parent      *Node
	Children    []*Node
	canonicalID string
}

func (n *Node) Text() string { return n.Attr["text"] }
func (n *Node) ID() string {
	if n.canonicalID != "" {
		return n.canonicalID
	}
	s := n.Attr["resource-id"]
	if i := strings.Index(s, ":id/"); i >= 0 {
		return s[i+4:]
	}
	return s
}
func (n *Node) Valid(pkg string) bool {
	return n.Attr["package"] == pkg && n.Attr["visible-to-user"] != "false" && n.Attr["enabled"] != "false" && n.Bounds[2] > n.Bounds[0] && n.Bounds[3] > n.Bounds[1]
}
func (n *Node) Under(p *Node) bool {
	for n = n.Parent; n != nil; n = n.Parent {
		if n == p {
			return true
		}
	}
	return false
}
func (n *Node) Point(w, h int) Point {
	return Point{(n.Bounds[0] + n.Bounds[2]) * 500 / w, (n.Bounds[1] + n.Bounds[3]) * 500 / h}
}

var boundsPattern = regexp.MustCompile(`^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$`)

func parseXML(text string) ([]*Node, error) {
	if len(text) > 4*1024*1024 {
		return nil, errf("控件树过大")
	}
	dec := xml.NewDecoder(strings.NewReader(text))
	var stack []*Node
	var nodes []*Node
	for {
		t, e := dec.Token()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, e
		}
		switch t := t.(type) {
		case xml.StartElement:
			if t.Name.Local != "node" {
				continue
			}
			n := &Node{Attr: map[string]string{}}
			for _, a := range t.Attr {
				n.Attr[a.Name.Local] = a.Value
			}
			m := boundsPattern.FindStringSubmatch(n.Attr["bounds"])
			if len(m) == 5 {
				for i := 0; i < 4; i++ {
					n.Bounds[i], _ = strconv.Atoi(m[i+1])
				}
			}
			if len(stack) > 0 {
				n.Parent = stack[len(stack)-1]
				n.Parent.Children = append(n.Parent.Children, n)
			}
			nodes = append(nodes, n)
			stack = append(stack, n)
			if len(nodes) > 4000 {
				return nil, errf("控件树过大")
			}
		case xml.EndElement:
			if t.Name.Local == "node" && len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
	return nodes, nil
}
func (d *DeviceIO) tree() ([]*Node, error) {
	return d.treeAttempt(0)
}
func (d *DeviceIO) treeAttempt(attempt int) ([]*Node, error) {
	if d.Package != "com.tencent.wework" {
		return nil, errf("不支持目标应用，仅支持企业微信")
	}
	if e := d.ADB.Foreground(d.Ctx, d.Package); e != nil {
		return nil, e
	}
	if d.U2 == nil {
		return nil, errf("原生控件服务未启动")
	}
	v, e := d.U2.RPC(d.Ctx, "dumpWindowHierarchy", []any{false, 80})
	if e != nil {
		return nil, e
	}
	text := str(v)
	_ = os.WriteFile(filepath.Join(d.Folder, "hierarchy.xml"), []byte(text), 0600)
	nodes, e := parseXML(text)
	if e != nil {
		return nil, e
	}
	if d.Package == "com.tencent.wework" {
		if d.wecomIDs == nil {
			info, err := d.ADB.Shell(d.Ctx, "dumpsys", "package", d.Package)
			if err != nil {
				return nil, err
			}
			match := regexp.MustCompile(`versionName=([^\s]+)`).FindStringSubmatch(info)
			if len(match) != 2 {
				return nil, errf("无法确认企业微信版本")
			}
			profile, err := d.Runtime.Call("wecom-ids", "profile", match[1])
			if err != nil {
				return nil, err
			}
			d.wecomIDs = object(profile)
		}
		applyWecomProfile(nodes, d.wecomIDs)
	}
	valid := []*Node{}
	for _, n := range nodes {
		if n.Valid(d.Package) {
			valid = append(valid, n)
			d.Width = max(d.Width, n.Bounds[2])
			d.Height = max(d.Height, n.Bounds[3])
		}
	}
	if !usableNativeTree(valid) {
		if attempt < 3 {
			if err := sleep(d.Ctx, 500*time.Millisecond); err != nil {
				return nil, err
			}
			return d.treeAttempt(attempt + 1)
		}
		return nil, errf("企业微信暂未提供原生页面控件，请保持手机解锁后重试")
	}
	d.Nodes = valid
	return valid, nil
}
func usableNativeTree(nodes []*Node) bool {
	if len(nodes) < 2 {
		return false
	}
	for _, n := range nodes {
		if n.Attr["resource-id"] != "" || n.Text() != "" || n.Attr["content-desc"] != "" || n.Attr["class"] == "android.widget.EditText" {
			return true
		}
	}
	return false
}
func applyWecomProfile(nodes []*Node, profile Object) {
	inverse := map[string]string{}
	for canonical, raw := range profile {
		inverse[str(raw)] = canonical
	}
	for _, n := range nodes {
		if n.Attr["package"] == "com.tencent.wework" {
			n.canonicalID = inverse[strings.TrimPrefix(n.Attr["resource-id"], "com.tencent.wework:id/")]
		}
	}
}
func (d *DeviceIO) nativeResource(id string) string {
	if value := str(d.wecomIDs[id]); value != "" {
		return value
	}
	return id
}
func (d *DeviceIO) node(id string) (*Node, error) {
	var result []*Node
	for _, n := range d.Nodes {
		if n.ID() == id {
			result = append(result, n)
		}
	}
	if len(result) != 1 {
		return nil, fmt.Errorf("原生控件 %s 缺失或不唯一", id)
	}
	return result[0], nil
}
func (d *DeviceIO) tapNode(n *Node) error {
	return d.ADB.Tap(d.Ctx, d.Package, n.Point(d.Width, d.Height), d.Width, d.Height)
}
func (d *DeviceIO) observeNative() (Screen, error) {
	nodes, e := d.tree()
	if e != nil {
		return Screen{}, e
	}
	return d.nativeScreen(nodes)
}
func (d *DeviceIO) nativeScreen(nodes []*Node) (Screen, error) {
	s := emptyScreen("other")
	if d.Package == "com.tencent.wework" {
		titles := []*Node{}
		for _, n := range nodes {
			if n.ID() == "ncq" {
				titles = append(titles, n)
			}
		}
		if len(titles) == 1 {
			s.Title = titles[0].Text()
		}
		editor, e := d.node("i_6")
		if e == nil {
			if editor.Attr["class"] != "android.widget.EditText" || editor.Attr["password"] == "true" {
				return s, errf("当前不是普通文字输入框")
			}
			text, e := nodeDraft(editor)
			if e != nil {
				return s, e
			}
			s.Page = "chat"
			s.Editor = &Editor{Point: editor.Point(d.Width, d.Height), Text: text}
			for _, n := range nodes {
				if n.Text() == "发送" && n.Bounds[0] >= editor.Bounds[2] && n.Bounds[1] < editor.Bounds[3] && n.Bounds[3] > editor.Bounds[1] {
					s.Items = append(s.Items, Item{Role: "send", Text: "发送", Point: n.Point(d.Width, d.Height), Complete: true})
				}
				if n.ID() == "i_d" && d.nativeOutgoing(n) {
					s.Outgoing = append(s.Outgoing, Object{"text": n.Text(), "pending": false, "failed": false})
				}
			}
			return s, nil
		}
		list, e := d.node("czp")
		filter, fe := d.node("fg8")
		if len(titles) == 1 && s.Title == "消息" && e == nil && fe == nil && list.Bounds[0] == 0 && list.Bounds[2] == d.Width {
			_ = filter
			s.Page = "home"
			if d.Scope == "groups" {
				s.Page = "groups"
			}
			rows, e := d.nativeRows(list)
			if e != nil {
				return s, e
			}
			s.Items = rows
			s.ListEmpty = len(rows) == 0
			return s, nil
		}
		return s, nil
	}
	return s, errf("不支持目标应用，仅支持企业微信")
}
func (d *DeviceIO) nativeOutgoing(body *Node) bool {
	row := body.Parent
	for row != nil && row.ID() != "message_row" {
		row = row.Parent
	}
	if row == nil {
		return false
	}
	var avatars []*Node
	for _, n := range d.Nodes {
		if n.ID() == "message_avatar" && n.Valid(d.Package) && n.Under(row) {
			avatars = append(avatars, n)
		}
	}
	if len(avatars) != 1 {
		return false
	}
	b, a, r := body.Bounds, avatars[0].Bounds, row.Bounds
	return body.Valid(d.Package) && b[0] >= r[0] && b[2] <= r[2] && b[1] >= r[1] && b[3] <= r[3] &&
		a[0] > d.Width/2 && a[0] >= b[2] && a[2] <= d.Width &&
		a[0] >= r[0] && a[2] <= r[2] && a[1] >= r[1] && a[3] <= r[3] && a[1] < b[3] && a[3] > b[1]
}
func nodeDraft(n *Node) (string, error) {
	switch n.Attr["showing-hint-text"] {
	case "true":
		return "", nil
	case "false":
		return n.Text(), nil
	}
	return "", errf("缺少原生提示文字状态，未覆盖草稿")
}
func (d *DeviceIO) nativeRows(container *Node) ([]Item, error) {
	var result []Item
	seen := map[string]bool{}
	for _, n := range d.Nodes {
		if n.ID() != "hrr" || !n.Under(container) {
			continue
		}
		row := n
		for row.Parent != nil && row.Parent != container {
			row = row.Parent
		}
		if row.Attr["clickable"] != "true" || row.Bounds[1] < container.Bounds[1] || row.Bounds[3] > container.Bounds[3] {
			continue
		}
		text := n.Text()
		if text == "" || strings.Contains(text, "…") || strings.HasSuffix(text, "...") {
			return nil, errf("会话名称不完整")
		}
		if d.Scope != "groups" && strings.Contains("|客户联系|行业资讯|接收微信中的工作消息|打卡|企业微信团队|我的客服|添加管理员协助你体验|", "|"+text+"|") {
			continue
		}
		if seen[nameKey(text)] {
			return nil, errf("同名会话无法区分")
		}
		seen[nameKey(text)] = true
		role := "chat"
		if d.Scope == "groups" {
			role = "group"
		}
		result = append(result, Item{Role: role, Text: text, Point: row.Point(d.Width, d.Height), Complete: true})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Point[1] < result[j].Point[1] })
	return result, nil
}
func (d *DeviceIO) nativeHome() (Screen, error) {
	d.Scope = "conversations"
	for n := 0; n < 8; n++ {
		s, e := d.observeNative()
		if e != nil {
			return s, e
		}
		if s.Page == "home" {
			return s, nil
		}
		if tab := wecomMessageTab(d.Nodes, d.Width, d.Height); tab != nil {
			e = d.tapNode(tab)
		} else {
			e = d.back()
		}
		if e != nil {
			return s, e
		}
		if e = sleep(d.Ctx, 500*time.Millisecond); e != nil {
			return s, e
		}
	}
	return Screen{}, errf("未能返回企业微信消息首页")
}
func wecomMessageTab(nodes []*Node, width, height int) *Node {
	tabs := map[string][]*Node{}
	for _, n := range nodes {
		if n.Valid("com.tencent.wework") && n.ID() == "hrr" && n.Bounds[1] > height*3/4 && n.Bounds[0] >= 0 && n.Bounds[2] <= width {
			tabs[n.Text()] = append(tabs[n.Text()], n)
		}
	}
	for _, label := range []string{"消息", "邮件", "文档", "工作台", "通讯录"} {
		if len(tabs[label]) != 1 {
			return nil
		}
	}
	return tabs["消息"][0]
}
func (d *DeviceIO) recipientNative(scope string) (Screen, error) {
	if scope != "groups" && scope != "conversations" {
		return Screen{}, errf("会话范围无效")
	}
	if _, e := d.nativeHome(); e != nil {
		return Screen{}, e
	}
	desired := "全部"
	if scope == "groups" {
		desired = "群聊"
	}
	filter, e := d.node("fg8")
	if e != nil {
		return Screen{}, e
	}
	if filter.Text() != desired {
		button, e := d.node("fg9")
		if e != nil {
			return Screen{}, e
		}
		if e = d.tapNode(button); e != nil {
			return Screen{}, e
		}
		if _, e = d.tree(); e != nil {
			return Screen{}, e
		}
		var options []*Node
		for _, n := range d.Nodes {
			if n.Text() == desired {
				options = append(options, n)
			}
		}
		if len(options) != 1 {
			return Screen{}, errf("会话分类不唯一")
		}
		if e = d.tapNode(options[0]); e != nil {
			return Screen{}, e
		}
		if _, e = d.tree(); e != nil {
			return Screen{}, e
		}
		filter, e = d.node("fg8")
		if e != nil || filter.Text() != desired {
			return Screen{}, errf("会话分类未完成切换")
		}
	}
	d.Scope = scope
	return d.observeNative()
}
func (d *DeviceIO) scrollNative(up bool) error {
	if d.Package != "com.tencent.wework" {
		return errf("不支持目标应用，仅支持企业微信")
	}
	if e := d.ADB.Foreground(d.Ctx, d.Package); e != nil {
		return e
	}
	method := "scrollForward"
	if up {
		method = "scrollBackward"
	}
	id := "czp"
	_, e := d.U2.RPC(d.Ctx, method, []any{Object{"mask": 0x280000, "packageName": d.Package, "resourceId": d.Package + ":id/" + d.nativeResource(id)}, true, 20})
	if e != nil {
		return e
	}
	return sleep(d.Ctx, 400*time.Millisecond)
}
func (d *DeviceIO) openNativeRow(title, page string) error {
	s, e := d.observeNative()
	if e != nil {
		return e
	}
	if s.Page != page {
		return errf("会话列表已变化")
	}
	var rows []Item
	for _, i := range s.Items {
		if i.Text == title && (i.Role == "chat" || i.Role == "group") && i.Complete {
			rows = append(rows, i)
		}
	}
	if len(rows) != 1 {
		return errf("完整会话名称不唯一")
	}
	d.OwnedTitle = title
	if err := appendEvent(d.Folder, "native_target", "已核对原生会话行", Object{"title": title, "point": rows[0].Point, "width": d.Width, "height": d.Height, "scope": d.Scope}); err != nil {
		return err
	}
	if err := d.click(rows[0].Point); err != nil {
		return err
	}
	return d.waitNativeChat(title)
}
func (d *DeviceIO) waitNativeChat(title string) error {
	for n := 0; n < 8; n++ {
		s, err := d.observeNative()
		if err != nil {
			return err
		}
		if s.Page == "chat" {
			if !sameTitle(s.Title, title) {
				return errf("打开的会话与完整目标名称不一致")
			}
			return nil
		}
		if err = sleep(d.Ctx, 750*time.Millisecond); err != nil {
			return err
		}
	}
	return errf("原生聊天页面未就绪，未继续输入或发送")
}
func (d *DeviceIO) openNativeNamed(title, scope string) error {
	if _, e := d.nativeHome(); e != nil {
		return e
	}
	button, e := d.node("ndh")
	if e != nil {
		return e
	}
	if e = d.tapNode(button); e != nil {
		return e
	}
	if _, e = d.tree(); e != nil {
		return e
	}
	input, e := d.node("lba")
	if e != nil {
		return e
	}
	draft, e := nodeDraft(input)
	if e != nil || draft != "" {
		return errf("搜索框已有文字，未覆盖")
	}
	selector := Object{"mask": 0x280000, "packageName": d.Package, "resourceId": d.Package + ":id/" + d.nativeResource("lba")}
	v, e := d.U2.RPC(d.Ctx, "setText", []any{selector, title})
	if e != nil || v != true {
		return errf("原生搜索输入未完成")
	}
	_ = sleep(d.Ctx, 650*time.Millisecond)
	if _, e = d.tree(); e != nil {
		return e
	}
	input, e = d.node("lba")
	if e != nil || input.Text() != title {
		return errf("搜索内容核对失败")
	}
	if scope == "groups" {
		tabs, e := d.node("n5o")
		if e != nil {
			return e
		}
		var options []*Node
		for _, n := range tabs.Children {
			if n.Valid(d.Package) && n.Text() == "群聊" {
				options = append(options, n)
			}
		}
		if len(options) != 1 {
			return errf("搜索群聊分类不唯一")
		}
		if e = d.tapNode(options[0]); e != nil {
			return e
		}
		if _, e = d.tree(); e != nil {
			return e
		}
	}
	container, e := d.node("km_")
	if e != nil {
		return e
	}
	var found []*Node
	for _, n := range d.Nodes {
		if n.ID() == "mid1Txt" && n.Text() == title && n.Under(container) {
			found = append(found, n)
		}
	}
	if len(found) > 1 {
		return errf("存在同名搜索结果")
	}
	if len(found) == 1 {
		row := found[0]
		for row.Attr["clickable"] != "true" && row.Parent != nil && row.Parent != container {
			row = row.Parent
		}
		if row.Attr["clickable"] != "true" {
			return errf("结果行不可验证")
		}
		d.OwnedTitle = title
		if err := d.tapNode(row); err != nil {
			return err
		}
		return d.waitNativeChat(title)
	}
	if _, e = d.recipientNative(scope); e != nil {
		return e
	}
	for n := 0; n < 300; n++ {
		s, e := d.observeNative()
		if e != nil {
			return e
		}
		for _, i := range s.Items {
			if i.Text == title {
				return d.openNativeRow(title, s.Page)
			}
		}
		if e = d.scrollNative(false); e != nil {
			return e
		}
	}
	return errf("会话列表没有找到完整名称")
}
func (d *DeviceIO) nicknameNative() (string, error) {
	if _, e := d.nativeHome(); e != nil {
		return "", e
	}
	button, e := d.node("ndw")
	if e != nil {
		return "", e
	}
	if e = d.tapNode(button); e != nil {
		return "", e
	}
	if _, e = d.tree(); e != nil {
		return "", e
	}
	header, e := d.node("og3")
	if e != nil {
		return "", e
	}
	name, e := d.node("mi0")
	if e != nil || !name.Under(header) || name.Text() == "" {
		return "", errf("个人信息姓名无法确认")
	}
	return name.Text(), nil
}
func (d *DeviceIO) editNative(expected, text, title string) error {
	s, e := d.observeNative()
	if e != nil {
		return e
	}
	if s.Page != "chat" || !sameTitle(s.Title, title) || s.Editor == nil || s.Editor.Text != expected {
		return errf("会话或原生草稿已变化，未修改")
	}
	if expected != "" && (d.OwnedText != expected || d.OwnedTitle != title) {
		return errf("草稿不属于本轮，未清理")
	}
	selector := Object{"mask": 0x280000, "packageName": d.Package, "resourceId": d.Package + ":id/" + d.nativeResource("i_6")}
	v, e := d.U2.RPC(d.Ctx, "setText", []any{selector, text})
	if e != nil {
		return e
	}
	if v != true {
		return errf("原生输入未完成")
	}
	d.OwnedTitle, d.OwnedText = title, text
	_ = sleep(d.Ctx, 300*time.Millisecond)
	after, e := d.observeNative()
	if e != nil {
		return e
	}
	if !sameTitle(after.Title, title) || after.Editor == nil || after.Editor.Text != text {
		return errf("原生输入回读不一致，未重试")
	}
	return nil
}
