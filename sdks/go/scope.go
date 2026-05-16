package sentryreplica

import "sync"

// Scope holds per-request context applied to outgoing events.
type Scope struct {
	mu          sync.Mutex
	user        *User
	level       Level
	fingerprint []string
	tags        map[string]string
	extras      map[string]any
	contexts    map[string]any
}

// NewScope constructs an empty Scope.
func NewScope() *Scope {
	return &Scope{
		tags:     map[string]string{},
		extras:   map[string]any{},
		contexts: map[string]any{},
	}
}

// SetUser sets (or clears with nil) the user.
func (s *Scope) SetUser(user *User) *Scope {
	s.mu.Lock()
	defer s.mu.Unlock()
	if user == nil {
		s.user = nil
	} else {
		copy := *user
		s.user = &copy
	}
	return s
}

// SetTag sets a single tag.
func (s *Scope) SetTag(key, value string) *Scope {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tags[key] = value
	return s
}

// SetExtra sets a single extra entry.
func (s *Scope) SetExtra(key string, value any) *Scope {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.extras[key] = value
	return s
}

// SetContext sets a typed context (e.g. "os": {...}).
func (s *Scope) SetContext(key string, value any) *Scope {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.contexts[key] = value
	return s
}

// SetLevel sets the level floor.
func (s *Scope) SetLevel(level Level) *Scope {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.level = level
	return s
}

// SetFingerprint overrides the server-side grouping fingerprint.
func (s *Scope) SetFingerprint(fp []string) *Scope {
	s.mu.Lock()
	defer s.mu.Unlock()
	if fp == nil {
		s.fingerprint = nil
	} else {
		s.fingerprint = append([]string(nil), fp...)
	}
	return s
}

// Clear wipes the scope.
func (s *Scope) Clear() *Scope {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.user = nil
	s.level = ""
	s.fingerprint = nil
	s.tags = map[string]string{}
	s.extras = map[string]any{}
	s.contexts = map[string]any{}
	return s
}

// Clone returns an independent copy of the scope.
func (s *Scope) Clone() *Scope {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := NewScope()
	if s.user != nil {
		u := *s.user
		c.user = &u
	}
	c.level = s.level
	if s.fingerprint != nil {
		c.fingerprint = append([]string(nil), s.fingerprint...)
	}
	for k, v := range s.tags {
		c.tags[k] = v
	}
	for k, v := range s.extras {
		c.extras[k] = v
	}
	for k, v := range s.contexts {
		c.contexts[k] = v
	}
	return c
}

// ApplyToEvent merges scope values into event. Event-level values win on conflict.
func (s *Scope) ApplyToEvent(event Event) Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	if event.User == nil && s.user != nil {
		u := *s.user
		event.User = &u
	}
	if event.Level == "" && s.level != "" {
		event.Level = s.level
	}
	if event.Fingerprint == nil && s.fingerprint != nil {
		event.Fingerprint = append([]string(nil), s.fingerprint...)
	}
	if len(s.tags) > 0 {
		if event.Tags == nil {
			event.Tags = map[string]string{}
		}
		for k, v := range s.tags {
			if _, ok := event.Tags[k]; !ok {
				event.Tags[k] = v
			}
		}
	}
	if len(s.extras) > 0 {
		if event.Extra == nil {
			event.Extra = map[string]any{}
		}
		for k, v := range s.extras {
			if _, ok := event.Extra[k]; !ok {
				event.Extra[k] = v
			}
		}
	}
	if len(s.contexts) > 0 {
		if event.Contexts == nil {
			event.Contexts = map[string]any{}
		}
		for k, v := range s.contexts {
			if _, ok := event.Contexts[k]; !ok {
				event.Contexts[k] = v
			}
		}
	}
	return event
}

// Diagnostics for tests.
func (s *Scope) User() *User {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.user == nil {
		return nil
	}
	cp := *s.user
	return &cp
}
func (s *Scope) GetLevel() Level          { s.mu.Lock(); defer s.mu.Unlock(); return s.level }
func (s *Scope) Fingerprint() []string    { s.mu.Lock(); defer s.mu.Unlock(); return append([]string(nil), s.fingerprint...) }
func (s *Scope) Tags() map[string]string  { s.mu.Lock(); defer s.mu.Unlock(); out := map[string]string{}; for k, v := range s.tags { out[k] = v }; return out }
func (s *Scope) Extras() map[string]any   { s.mu.Lock(); defer s.mu.Unlock(); out := map[string]any{}; for k, v := range s.extras { out[k] = v }; return out }
func (s *Scope) Contexts() map[string]any { s.mu.Lock(); defer s.mu.Unlock(); out := map[string]any{}; for k, v := range s.contexts { out[k] = v }; return out }