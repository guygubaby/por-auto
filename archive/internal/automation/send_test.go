package automation

import "testing"

func TestSendCommitRejectsChangedButtonTargetAndDraft(t *testing.T) {
	p := Point{950, 900}
	s := emptyScreen("chat")
	s.Title = "测试群(2)"
	s.Editor = &Editor{Point: Point{500, 900}, Text: "1"}
	s.Items = []Item{{Role: "send", Text: "发送", Point: p, Complete: true}}
	if err := verifySend(s, p, "测试群", "1"); err != nil {
		t.Fatal(err)
	}
	if verifySend(s, Point{930, 900}, "测试群", "1") == nil {
		t.Fatal("stale send coordinate accepted")
	}
	if verifySend(s, p, "另一个群", "1") == nil {
		t.Fatal("changed target accepted")
	}
	if verifySend(s, p, "测试群", "changed") == nil {
		t.Fatal("changed draft accepted")
	}
	if verifySend(s, p, "", "") == nil {
		t.Fatal("missing or consumed send token accepted")
	}
	for _, title := range []string{"123测试群", "测…群(2)", "测试群2"} {
		s.Title = title
		if verifySend(s, p, "测试群", "1") == nil {
			t.Fatalf("ambiguous native title accepted: %q", title)
		}
	}
	s.Title = "测试群(2)"
	s.Items = append(s.Items, s.Items[0])
	if verifySend(s, p, "测试群", "1") == nil {
		t.Fatal("ambiguous send button accepted")
	}
}
