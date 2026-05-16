package sentryreplica

import (
	"errors"
	"regexp"
	"strings"
	"testing"
)

func TestNewEventIDIs32Hex(t *testing.T) {
	id := NewEventID()
	if matched, _ := regexp.MatchString(`^[0-9a-f]{32}$`, id); !matched {
		t.Errorf("NewEventID returned %q", id)
	}
}

func TestEventIDsAreUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		seen[NewEventID()] = true
	}
	if len(seen) != 100 {
		t.Errorf("expected 100 distinct ids, got %d", len(seen))
	}
}

func TestNowISOShape(t *testing.T) {
	s := NowISO()
	if !strings.Contains(s, "T") || !strings.HasSuffix(s, "Z") {
		t.Errorf("NowISO returned %q", s)
	}
}

func TestEventFromError(t *testing.T) {
	err := errors.New("boom")
	ev := EventFromError(err, "")
	if ev.Platform != "go" {
		t.Errorf("platform: %q", ev.Platform)
	}
	if ev.Level != LevelError {
		t.Errorf("default level: %q", ev.Level)
	}
	if ev.Exception == nil || len(ev.Exception.Values) != 1 {
		t.Fatalf("missing exception interface")
	}
	if ev.Exception.Values[0].Value != "boom" {
		t.Errorf("exception value: %q", ev.Exception.Values[0].Value)
	}
	if ev.Exception.Values[0].Stacktrace == nil || len(ev.Exception.Values[0].Stacktrace.Frames) == 0 {
		t.Errorf("expected captured frames")
	}
}

func TestEventFromMessageDefaultsInfo(t *testing.T) {
	ev := EventFromMessage("hi", "")
	if ev.Level != LevelInfo {
		t.Errorf("default level: %q", ev.Level)
	}
	if ev.Message != "hi" {
		t.Errorf("message: %q", ev.Message)
	}
	if ev.Exception != nil {
		t.Errorf("message events should not carry exception")
	}
}

func TestEventFromMessageRespectsLevel(t *testing.T) {
	ev := EventFromMessage("warn me", LevelWarning)
	if ev.Level != LevelWarning {
		t.Errorf("level: %q", ev.Level)
	}
}

func TestEventFromPanic(t *testing.T) {
	ev := EventFromPanic("oops")
	if ev.Level != LevelFatal {
		t.Errorf("panic should be fatal, got %q", ev.Level)
	}
	if ev.Exception.Values[0].Type != "panic" {
		t.Errorf("expected type=panic, got %q", ev.Exception.Values[0].Type)
	}
	if ev.Exception.Values[0].Value != "oops" {
		t.Errorf("panic value: %q", ev.Exception.Values[0].Value)
	}
}