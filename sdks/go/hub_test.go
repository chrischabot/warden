package sentryreplica

import (
	"encoding/json"
	"errors"
	"testing"
)

func newTestHub() (*Hub, *NoopTransport) {
	transport := NewNoopTransport()
	client, _ := NewClient(ClientOptions{
		DSN:       "https://abc@relay.test/1",
		Transport: transport,
	})
	return NewHub(client), transport
}

func TestHubGetScopeStable(t *testing.T) {
	hub, _ := newTestHub()
	s1 := hub.GetScope()
	s2 := hub.GetScope()
	if s1 != s2 {
		t.Errorf("expected stable scope reference")
	}
}

func TestHubPushPop(t *testing.T) {
	hub, _ := newTestHub()
	hub.GetScope().SetTag("a", "1")
	pushed := hub.PushScope()
	if pushed.Tags()["a"] != "1" {
		t.Errorf("pushed scope didn't clone tags")
	}
	pushed.SetTag("a", "2")
	if hub.GetScope().Tags()["a"] != "2" {
		t.Errorf("pushed scope not on top")
	}
	hub.PopScope()
	if hub.GetScope().Tags()["a"] != "1" {
		t.Errorf("pop didn't restore previous")
	}
}

func TestHubPopRefusesToPopRoot(t *testing.T) {
	hub, _ := newTestHub()
	hub.PopScope()
	hub.PopScope()
	if hub.GetScope() == nil {
		t.Errorf("root scope was popped")
	}
}

func TestHubWithScopeIsolates(t *testing.T) {
	hub, _ := newTestHub()
	hub.GetScope().SetTag("outer", "parent")
	hub.WithScope(func(s *Scope) {
		s.SetTag("outer", "child")
	})
	if hub.GetScope().Tags()["outer"] != "parent" {
		t.Errorf("withScope didn't pop")
	}
}

func TestHubWithScopePopsOnPanic(t *testing.T) {
	hub, _ := newTestHub()
	hub.GetScope().SetTag("a", "1")
	defer func() {
		_ = recover() // swallow the panic
		if hub.GetScope().Tags()["a"] != "1" {
			t.Errorf("withScope didn't pop after panic")
		}
	}()
	hub.WithScope(func(s *Scope) {
		s.SetTag("a", "2")
		panic("boom")
	})
}

func TestHubCaptureExceptionAppliesScope(t *testing.T) {
	hub, transport := newTestHub()
	hub.ConfigureScope(func(s *Scope) {
		s.SetUser(&User{ID: "u42"})
		s.SetTag("request_id", "rid-1")
	})
	id := hub.CaptureException(errors.New("boom"))
	if id == "" {
		t.Fatal("expected event_id")
	}
	if transport.Len() != 1 {
		t.Fatalf("expected 1 envelope, got %d", transport.Len())
	}
	_, items, err := ParseEnvelope(transport.Sent()[0])
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(items[0].Payload, &body); err != nil {
		t.Fatal(err)
	}
	user := body["user"].(map[string]any)
	if user["id"] != "u42" {
		t.Errorf("user not applied: %v", user)
	}
	tags := body["tags"].(map[string]any)
	if tags["request_id"] != "rid-1" {
		t.Errorf("tag not applied")
	}
}

func TestHubCaptureWithoutClientReturnsEmpty(t *testing.T) {
	hub := NewHub(nil)
	if hub.CaptureException(errors.New("x")) != "" {
		t.Errorf("expected empty event id with no client")
	}
}

func TestHubRecoverCapturesPanic(t *testing.T) {
	hub, transport := newTestHub()
	func() {
		defer hub.Recover()
		panic("recover me")
	}()
	if transport.Len() != 1 {
		t.Fatalf("expected 1 envelope, got %d", transport.Len())
	}
	_, items, _ := ParseEnvelope(transport.Sent()[0])
	var body map[string]any
	_ = json.Unmarshal(items[0].Payload, &body)
	exc := body["exception"].(map[string]any)
	values := exc["values"].([]any)
	if values[0].(map[string]any)["type"] != "panic" {
		t.Errorf("expected type=panic, got %v", values[0])
	}
}

func TestHubCloneIsIndependent(t *testing.T) {
	hub, _ := newTestHub()
	hub.GetScope().SetTag("a", "1")
	clone := hub.Clone()
	clone.GetScope().SetTag("a", "2")
	if hub.GetScope().Tags()["a"] != "1" {
		t.Errorf("clone mutated parent")
	}
	if clone.GetScope().Tags()["a"] != "2" {
		t.Errorf("clone tag mismatch")
	}
}