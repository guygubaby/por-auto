package automation

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWecomVersionProfilePreservesNativeHomeAndRawActionIDs(t *testing.T) {
	profile, err := NewRuntime(context.Background(), NewCredentials()).Call("wecom-ids", "profile", "5.0.12")
	if err != nil {
		t.Fatal(err)
	}
	nodes, err := parseXML(`<hierarchy><node package="com.tencent.wework" class="android.widget.FrameLayout" bounds="[0,0][1080,2280]"><node package="com.tencent.wework" resource-id="com.tencent.wework:id/o6j" text="消息" bounds="[489,121][591,190]"/><node package="com.tencent.wework" resource-id="com.tencent.wework:id/fwr" text="全部" bounds="[109,281][187,331]"/><node package="com.tencent.wework" resource-id="com.tencent.wework:id/db5" class="androidx.recyclerview.widget.RecyclerView" bounds="[0,228][1080,2111]"/></node></hierarchy>`)
	if err != nil {
		t.Fatal(err)
	}
	applyWecomProfile(nodes, object(profile))
	d := &DeviceIO{Package: "com.tencent.wework", Width: 1080, Height: 2280, Nodes: nodes, wecomIDs: object(profile)}
	screen, err := d.nativeScreen(nodes)
	if err != nil || screen.Page != "home" {
		t.Fatalf("new resource IDs were not recognized: %s %v", screen.Page, err)
	}
	if d.nativeResource("czp") != "db5" {
		t.Fatal("native action selector did not retain the raw installed ID")
	}
}

func TestSlidingWecomSidebarCannotUseItsClippedMessageTab(t *testing.T) {
	var nodes []*Node
	for i, label := range []string{"消息", "邮件", "文档", "工作台", "通讯录"} {
		nodes = append(nodes, &Node{Attr: map[string]string{"package": "com.tencent.wework", "resource-id": "com.tencent.wework:id/hrr", "text": label}, Bounds: [4]int{i * 216, 2224, (i + 1) * 216, 2259}})
	}
	if wecomMessageTab(nodes, 1080, 2280) == nil {
		t.Fatal("complete native navigation was rejected")
	}
	nodes[0].Bounds = [4]int{994, 2224, 1080, 2259}
	if wecomMessageTab(nodes[:1], 1080, 2280) != nil {
		t.Fatal("clipped background tab behind the sidebar was accepted")
	}
}

func TestWecomSentBubbleUsesMessageTextNotTimestamp(t *testing.T) {
	profile, err := NewRuntime(context.Background(), NewCredentials()).Call("wecom-ids", "profile", "5.0.12")
	if err != nil {
		t.Fatal(err)
	}
	nodes, err := parseXML(`<hierarchy><node package="com.tencent.wework" class="android.widget.FrameLayout" bounds="[0,0][1080,2280]"><node package="com.tencent.wework" resource-id="com.tencent.wework:id/o6j" text="测试群(1)" bounds="[434,121][646,190]"/><node package="com.tencent.wework" resource-id="com.tencent.wework:id/iu5" class="android.widget.EditText" text="" showing-hint-text="true" bounds="[150,1331][804,1397]"/><node package="com.tencent.wework" resource-id="com.tencent.wework:id/iuc" text="13:46" bounds="[490,600][589,650]"/><node package="com.tencent.wework" resource-id="com.tencent.wework:id/ixq" bounds="[0,704][1080,921]"><node package="com.tencent.wework" resource-id="com.tencent.wework:id/ith" text="验收消息" bounds="[177,704][921,921]"/><node package="com.tencent.wework" resource-id="com.tencent.wework:id/j3b" class="android.widget.ImageView" bounds="[936,704][1050,818]"/></node></node></hierarchy>`)
	if err != nil {
		t.Fatal(err)
	}
	applyWecomProfile(nodes, object(profile))
	device := &DeviceIO{Package: "com.tencent.wework", Width: 1080, Height: 2280, Nodes: nodes, wecomIDs: object(profile)}
	screen, err := device.nativeScreen(nodes)
	if err != nil {
		t.Fatal(err)
	}
	if screen.Page != "chat" || len(screen.Outgoing) != 1 || object(screen.Outgoing[0])["text"] != "验收消息" {
		t.Fatalf("sent bubble was not identified from the real message node: %+v", screen.Outgoing)
	}
}

func TestNativeOutgoingKeepsAbsoluteListPositionAndScreenOrder(t *testing.T) {
	nodes, err := parseXML(`<hierarchy><node package="com.tencent.wework" bounds="[0,0][1080,2280]">
<node package="com.tencent.wework" resource-id="ncq" text="Peer" bounds="[400,100][650,160]"/>
<node package="com.tencent.wework" resource-id="i_6" class="android.widget.EditText" showing-hint-text="true" bounds="[150,1800][800,1900]"/>
<node package="com.tencent.wework" collection-row="43" bounds="[0,1000][1080,1200]"><node package="com.tencent.wework" resource-id="message_row" bounds="[0,1000][1080,1200]"><node package="com.tencent.wework" resource-id="i_d" text="New" bounds="[177,1000][921,1200]"/><node package="com.tencent.wework" resource-id="message_avatar" bounds="[936,1000][1050,1114]"/></node></node>
<node package="com.tencent.wework" collection-row="42" bounds="[0,704][1080,921]"><node package="com.tencent.wework" resource-id="message_row" bounds="[0,704][1080,921]"><node package="com.tencent.wework" resource-id="i_d" text="Old" bounds="[177,704][921,921]"/><node package="com.tencent.wework" resource-id="message_avatar" bounds="[936,704][1050,818]"/></node></node>
</node></hierarchy>`)
	if err != nil {
		t.Fatal(err)
	}
	d := &DeviceIO{Package: "com.tencent.wework", Width: 1080, Height: 2280, Nodes: nodes}
	screen, err := d.nativeScreen(nodes)
	if err != nil || len(screen.Outgoing) != 2 {
		t.Fatalf("outgoing readback failed: %v %v", screen.Outgoing, err)
	}
	if object(screen.Outgoing[0])["text"] != "Old" || num(object(screen.Outgoing[0])["position"]) != 42 || object(screen.Outgoing[1])["text"] != "New" || num(object(screen.Outgoing[1])["position"]) != 43 {
		t.Fatalf("message order or absolute list position was lost: %v", screen.Outgoing)
	}
}

func TestNativeOutgoingRequiresUniqueRightAvatarInSameMessageRow(t *testing.T) {
	for _, tc := range []struct {
		name, body, avatar string
		want               int
	}{
		{"outgoing short", "[650,704][921,818]", "[936,704][1050,818]", 1},
		{"outgoing long", "[177,704][921,921]", "[936,704][1050,818]", 1},
		{"incoming short", "[159,704][450,818]", "[30,704][144,818]", 0},
		{"incoming long", "[159,704][903,921]", "[30,704][144,818]", 0},
		{"misaligned avatar", "[177,704][921,921]", "[936,1000][1050,1114]", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			xml := fmt.Sprintf(`<hierarchy><node package="com.tencent.wework" bounds="[0,0][1080,2280]"><node package="com.tencent.wework" resource-id="com.tencent.wework:id/ncq" text="Peer" bounds="[400,100][650,160]"/><node package="com.tencent.wework" resource-id="com.tencent.wework:id/i_6" class="android.widget.EditText" text="" showing-hint-text="true" bounds="[150,1800][800,1900]"/><node package="com.tencent.wework" resource-id="message_row" bounds="[0,704][1080,921]"><node package="com.tencent.wework" resource-id="i_d" text="Hello" bounds="%s"/><node package="com.tencent.wework" resource-id="message_avatar" bounds="%s"/></node></node></hierarchy>`, tc.body, tc.avatar)
			nodes, err := parseXML(xml)
			if err != nil {
				t.Fatal(err)
			}
			d := &DeviceIO{Package: "com.tencent.wework", Width: 1080, Height: 2280, Nodes: nodes}
			screen, err := d.nativeScreen(nodes)
			if err != nil || len(screen.Outgoing) != tc.want {
				t.Fatalf("outgoing=%v error=%v", screen.Outgoing, err)
			}
			var body, avatar *Node
			for _, n := range nodes {
				if n.ID() == "i_d" {
					body = n
				}
				if n.ID() == "message_avatar" {
					avatar = n
				}
			}
			if tc.want == 1 {
				d.Nodes = append(d.Nodes, avatar)
				if d.nativeOutgoing(body) {
					t.Fatal("ambiguous avatar was accepted")
				}
			}
		})
	}
}

func TestOrdinaryWeChatHasNoNativeExecutionPath(t *testing.T) {
	d := &DeviceIO{Package: "com.tencent.mm"}
	if _, err := d.tree(); err == nil {
		t.Fatal("ordinary WeChat tree was accepted")
	}
	if _, err := d.nativeScreen(nil); err == nil {
		t.Fatal("ordinary WeChat screen was accepted")
	}
	if _, err := d.scrollNative(false); err == nil {
		t.Fatal("ordinary WeChat scroll was accepted")
	}
	if _, err := StartInput(context.Background(), ADB{}, "com.tencent.mm", t.TempDir()); err == nil {
		t.Fatal("ordinary WeChat input was accepted")
	}
}

func TestNativeHomeWaitsForSplashAndLeavesSearchAfterKeyboardCloses(t *testing.T) {
	a, folder := launchTestADB(t)
	if err := os.WriteFile(filepath.Join(folder, "ready"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	reads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reads++
		backs, _ := os.ReadFile(filepath.Join(folder, "backs"))
		nodes := `<node resource-id="splash" bounds="[0,0][1080,1920]"/>`
		if len(backs) > 0 && reads <= 4 {
			t.Error("Back was pressed before the splash finished")
		}
		if reads > 4 {
			nodes = fmt.Sprintf(`<node resource-id="lba" bounds="[100,100][900,%d]"/>`, 200+len(backs)*100)
		}
		if len(backs) >= 2 {
			nodes = `<node resource-id="ncq" text="消息" bounds="[100,100][900,200]"/><node resource-id="fg8" text="全部" bounds="[100,200][200,300]"/><node resource-id="czp" bounds="[0,300][1080,1800]"/>`
		}
		nodes = strings.ReplaceAll(nodes, "<node ", `<node package="com.tencent.wework" `)
		_ = json.NewEncoder(w).Encode(Object{"jsonrpc": "2.0", "id": 1, "result": `<hierarchy><node package="com.tencent.wework" bounds="[0,0][1080,1920]">` + nodes + `</node></hierarchy>`})
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	d := &DeviceIO{Ctx: ctx, ADB: a, Package: "com.tencent.wework", Folder: folder, wecomIDs: Object{}, U2: &U2{Port: strings.TrimPrefix(server.URL, "http://127.0.0.1:"), Client: server.Client()}}
	screen, err := d.nativeHome()
	if err != nil || screen.Page != "home" {
		t.Fatalf("home recovery stalled after closing the keyboard: %s %v", screen.Page, err)
	}
	backs, err := os.ReadFile(filepath.Join(folder, "backs"))
	if err != nil || len(backs) != 2 {
		t.Fatalf("Back was replayed or search was not closed: %q %v", backs, err)
	}
}
