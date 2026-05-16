package sentryreplica

import "testing"

func TestScopeChainableSetters(t *testing.T) {
	s := NewScope().
		SetUser(&User{ID: "u1"}).
		SetTag("region", "eu-west").
		SetExtra("ctx", 42).
		SetLevel(LevelWarning).
		SetFingerprint([]string{"custom"})
	if s.User().ID != "u1" {
		t.Errorf("user mismatch: %+v", s.User())
	}
	if s.Tags()["region"] != "eu-west" {
		t.Errorf("tag mismatch")
	}
	if s.Extras()["ctx"] != 42 {
		t.Errorf("extra mismatch")
	}
	if s.GetLevel() != LevelWarning {
		t.Errorf("level mismatch")
	}
	if len(s.Fingerprint()) != 1 {
		t.Errorf("fingerprint mismatch: %v", s.Fingerprint())
	}
}

func TestScopeClearWipesEverything(t *testing.T) {
	s := NewScope().SetUser(&User{ID: "u"}).SetTag("k", "v").SetLevel(LevelError)
	s.Clear()
	if s.User() != nil || len(s.Tags()) != 0 || s.GetLevel() != "" {
		t.Errorf("clear failed")
	}
}

func TestScopeCloneIsIndependent(t *testing.T) {
	s := NewScope().SetTag("a", "1")
	c := s.Clone().SetTag("a", "2").SetTag("b", "3")
	if s.Tags()["a"] != "1" {
		t.Errorf("original mutated")
	}
	if _, ok := s.Tags()["b"]; ok {
		t.Errorf("original gained a tag")
	}
	if c.Tags()["a"] != "2" {
		t.Errorf("clone tag mismatch")
	}
}

func baseEvent() Event {
	return Event{EventID: "x", Timestamp: "2024-01-01T00:00:00Z"}
}

func TestApplyToEventAddsUserWhenAbsent(t *testing.T) {
	s := NewScope().SetUser(&User{ID: "u1"})
	out := s.ApplyToEvent(baseEvent())
	if out.User == nil || out.User.ID != "u1" {
		t.Errorf("user not applied")
	}
}

func TestApplyToEventPreservesEventUser(t *testing.T) {
	s := NewScope().SetUser(&User{ID: "scope"})
	ev := baseEvent()
	ev.User = &User{ID: "event"}
	out := s.ApplyToEvent(ev)
	if out.User.ID != "event" {
		t.Errorf("event user overridden: %q", out.User.ID)
	}
}

func TestApplyToEventMergesTagsEventWins(t *testing.T) {
	s := NewScope().SetTag("a", "scope-a").SetTag("b", "scope-b")
	ev := baseEvent()
	ev.Tags = map[string]string{"a": "event-a"}
	out := s.ApplyToEvent(ev)
	if out.Tags["a"] != "event-a" || out.Tags["b"] != "scope-b" {
		t.Errorf("tag merge wrong: %v", out.Tags)
	}
}

func TestApplyToEventLevelDefaults(t *testing.T) {
	s := NewScope().SetLevel(LevelWarning)
	out := s.ApplyToEvent(baseEvent())
	if out.Level != LevelWarning {
		t.Errorf("scope level not applied")
	}
	ev := baseEvent()
	ev.Level = LevelFatal
	out2 := s.ApplyToEvent(ev)
	if out2.Level != LevelFatal {
		t.Errorf("event level overridden")
	}
}