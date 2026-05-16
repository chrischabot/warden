package sentryreplica

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"runtime"
	"time"
)

// SDK identification constants.
const (
	SdkName    = "sentry-replica.go"
	SdkVersion = "0.0.0"
)

// Level is a Sentry severity level.
type Level string

// Levels enumerated per spec.
const (
	LevelFatal   Level = "fatal"
	LevelError   Level = "error"
	LevelWarning Level = "warning"
	LevelInfo    Level = "info"
	LevelDebug   Level = "debug"
)

// Frame is a single stack frame.
type Frame struct {
	Function string `json:"function,omitempty"`
	AbsPath  string `json:"abs_path,omitempty"`
	Filename string `json:"filename,omitempty"`
	Lineno   uint32 `json:"lineno,omitempty"`
	Colno    uint32 `json:"colno,omitempty"`
	InApp    *bool  `json:"in_app,omitempty"`
}

// Stacktrace wraps a list of frames.
type Stacktrace struct {
	Frames []Frame `json:"frames"`
}

// ExceptionValue is one element of the exception chain.
type ExceptionValue struct {
	Type       string      `json:"type"`
	Value      string      `json:"value"`
	Stacktrace *Stacktrace `json:"stacktrace,omitempty"`
}

// ExceptionInterface is the Sentry "exception" payload field.
type ExceptionInterface struct {
	Values []ExceptionValue `json:"values"`
}

// User identifies the affected user.
type User struct {
	ID        string `json:"id,omitempty"`
	Email     string `json:"email,omitempty"`
	Username  string `json:"username,omitempty"`
	IPAddress string `json:"ip_address,omitempty"`
}

// SdkInfo is the `sdk` field shipped on every event.
type SdkInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// Event is the wire-format Sentry event.
type Event struct {
	EventID     string              `json:"event_id"`
	Timestamp   string              `json:"timestamp"`
	Platform    string              `json:"platform,omitempty"`
	Level       Level               `json:"level,omitempty"`
	Message     string              `json:"message,omitempty"`
	Exception   *ExceptionInterface `json:"exception,omitempty"`
	SDK         *SdkInfo            `json:"sdk,omitempty"`
	User        *User               `json:"user,omitempty"`
	Tags        map[string]string   `json:"tags,omitempty"`
	Extra       map[string]any      `json:"extra,omitempty"`
	Contexts    map[string]any      `json:"contexts,omitempty"`
	Release     string              `json:"release,omitempty"`
	Environment string              `json:"environment,omitempty"`
	Fingerprint []string            `json:"fingerprint,omitempty"`
}

// NewEventID returns a 32-char lowercase hex string (UUID-v4-like).
func NewEventID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		// Fallback to time-derived ID; extremely unlikely path.
		t := time.Now().UnixNano()
		for i := range buf {
			buf[i] = byte(t >> (8 * (i % 8)))
		}
	}
	// Set version 4 and variant bits per RFC 4122.
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	return hex.EncodeToString(buf[:])
}

// NowISO returns a Sentry-compatible ISO 8601 timestamp in UTC.
func NowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000000Z")
}

// EventFromError builds an event from a Go error. Captures the call stack at this point.
func EventFromError(err error, level Level) Event {
	if level == "" {
		level = LevelError
	}
	value := ""
	typeName := "error"
	if err != nil {
		value = err.Error()
		typeName = fmt.Sprintf("%T", err)
	}
	frames := captureFrames(3) // skip runtime.Callers + this + EventFromError
	exc := ExceptionValue{Type: typeName, Value: value}
	if len(frames) > 0 {
		exc.Stacktrace = &Stacktrace{Frames: frames}
	}
	return Event{
		EventID:   NewEventID(),
		Timestamp: NowISO(),
		Platform:  "go",
		Level:     level,
		Exception: &ExceptionInterface{Values: []ExceptionValue{exc}},
		SDK:       &SdkInfo{Name: SdkName, Version: SdkVersion},
	}
}

// EventFromMessage builds a message-shaped event.
func EventFromMessage(message string, level Level) Event {
	if level == "" {
		level = LevelInfo
	}
	return Event{
		EventID:   NewEventID(),
		Timestamp: NowISO(),
		Platform:  "go",
		Level:     level,
		Message:   message,
		SDK:       &SdkInfo{Name: SdkName, Version: SdkVersion},
	}
}

// EventFromPanic builds an event from a recovered panic value.
func EventFromPanic(recovered any) Event {
	value := fmt.Sprintf("%v", recovered)
	frames := captureFrames(3)
	exc := ExceptionValue{Type: "panic", Value: value}
	if len(frames) > 0 {
		exc.Stacktrace = &Stacktrace{Frames: frames}
	}
	return Event{
		EventID:   NewEventID(),
		Timestamp: NowISO(),
		Platform:  "go",
		Level:     LevelFatal,
		Exception: &ExceptionInterface{Values: []ExceptionValue{exc}},
		SDK:       &SdkInfo{Name: SdkName, Version: SdkVersion},
	}
}

func captureFrames(skip int) []Frame {
	var pcs [64]uintptr
	n := runtime.Callers(skip, pcs[:])
	if n == 0 {
		return nil
	}
	rf := runtime.CallersFrames(pcs[:n])
	frames := []Frame{}
	for {
		f, more := rf.Next()
		frames = append([]Frame{
			{
				Function: f.Function,
				AbsPath:  f.File,
				Filename: f.File,
				Lineno:   uint32(f.Line),
			},
		}, frames...)
		if !more {
			break
		}
	}
	return frames
}