// Package sentryreplica is the Go SDK for sentry-replica.
//
// Quick start:
//
//	sentryreplica.Init(sentryreplica.ClientOptions{
//	    DSN: "https://abc@relay.example.com/1",
//	})
//	defer sentryreplica.Flush(2 * time.Second)
//	defer sentryreplica.CurrentHub().Recover()
//
//	sentryreplica.CaptureException(err)
//	sentryreplica.CaptureMessage("hello", sentryreplica.LevelInfo)
package sentryreplica

import (
	"sync"
	"time"
)

var (
	currentMu sync.RWMutex
	current   = NewHub(nil)
)

// Init creates a Client from the provided options and binds it to the current Hub.
func Init(options ClientOptions) error {
	client, err := NewClient(options)
	if err != nil {
		return err
	}
	currentMu.RLock()
	defer currentMu.RUnlock()
	current.BindClient(client)
	return nil
}

// CurrentHub returns the package-level Hub.
//
// For per-goroutine isolation, call CurrentHub().Clone() and route capture
// helpers through the clone directly rather than via these package-level
// functions.
func CurrentHub() *Hub {
	currentMu.RLock()
	defer currentMu.RUnlock()
	return current
}

// SetCurrentHub replaces the package-level Hub. Test helper.
func SetCurrentHub(hub *Hub) {
	currentMu.Lock()
	defer currentMu.Unlock()
	current = hub
}

// CaptureException captures err via the current Hub.
func CaptureException(err error) string {
	return CurrentHub().CaptureException(err)
}

// CaptureMessage captures a message via the current Hub.
func CaptureMessage(message string, level Level) string {
	return CurrentHub().CaptureMessage(message, level)
}

// CaptureEvent captures a pre-built event via the current Hub.
func CaptureEvent(event Event) string {
	return CurrentHub().CaptureEvent(event)
}

// WithScope pushes a cloned scope, runs fn, pops on return.
func WithScope(fn func(*Scope)) {
	CurrentHub().WithScope(fn)
}

// ConfigureScope mutates the current scope in place.
func ConfigureScope(fn func(*Scope)) {
	CurrentHub().ConfigureScope(fn)
}

// SetUser sets the user on the current scope.
func SetUser(user *User) {
	CurrentHub().GetScope().SetUser(user)
}

// SetTag sets a tag on the current scope.
func SetTag(key, value string) {
	CurrentHub().GetScope().SetTag(key, value)
}

// SetExtra sets an extra on the current scope.
func SetExtra(key string, value any) {
	CurrentHub().GetScope().SetExtra(key, value)
}

// SetContext sets a typed context on the current scope.
func SetContext(key string, value any) {
	CurrentHub().GetScope().SetContext(key, value)
}

// SetLevel sets the level on the current scope.
func SetLevel(level Level) {
	CurrentHub().GetScope().SetLevel(level)
}

// Flush forwards to the current Hub.
func Flush(timeout time.Duration) bool {
	return CurrentHub().Flush(timeout)
}

// Close forwards to the current Hub.
func Close(timeout time.Duration) bool {
	return CurrentHub().Close(timeout)
}