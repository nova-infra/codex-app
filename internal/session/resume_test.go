package session

import (
	"errors"
	"testing"
)

type memoryStore struct {
	records map[string]Record
	loadErr error
	saveErr error
}

func newMemoryStore() *memoryStore {
	return &memoryStore{records: map[string]Record{}}
}

func (s *memoryStore) Load(id string) (Record, error) {
	if s.loadErr != nil {
		return Record{}, s.loadErr
	}
	record, ok := s.records[id]
	if !ok {
		return Record{}, errors.New("missing")
	}
	return record, nil
}

func (s *memoryStore) Save(record Record) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	s.records[record.ID] = record
	return nil
}

func TestResumeOrCreateResumesExistingSession(t *testing.T) {
	store := newMemoryStore()
	existing := Record{
		ID:          "default:telegram:u1",
		ProjectName: "default",
		Channel:     "telegram",
		UserID:      "u1",
	}
	store.records[existing.ID] = existing
	got, err := ResumeOrCreate(store, StartRequest{SessionID: existing.ID})
	if err != nil {
		t.Fatalf("resume: %v", err)
	}
	if !got.Resumed || got.Record.ID != existing.ID || got.FallbackReason != "" {
		t.Fatalf("unexpected resume result: %#v", got)
	}
}

func TestResumeOrCreateCreatesFallbackWhenSessionMissing(t *testing.T) {
	store := newMemoryStore()
	got, err := ResumeOrCreate(store, StartRequest{
		SessionID:   "missing",
		ProjectName: "default",
		Channel:     "telegram",
		UserID:      "u1",
		Runtime: RuntimeSessionConfig{
			ProjectName: "default",
			ProjectHome: "/tmp/codex-home",
			Mode:        "yolo",
			ProviderRef: "cliproxy",
		},
	})
	if err != nil {
		t.Fatalf("fallback: %v", err)
	}
	if got.Resumed {
		t.Fatalf("expected fallback, got resume: %#v", got)
	}
	if got.FallbackReason == "" {
		t.Fatalf("expected fallback reason: %#v", got)
	}
	if _, ok := store.records["default:telegram:u1"]; !ok {
		t.Fatalf("fallback record was not saved: %#v", store.records)
	}
}

func TestResumeOrCreateCreatesNewSessionWithoutSessionID(t *testing.T) {
	store := newMemoryStore()
	got, err := ResumeOrCreate(store, StartRequest{
		ProjectName: "default",
		Channel:     "lark",
		UserID:      "u2",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if got.Record.ID != "default:lark:u2" || got.Resumed || got.FallbackReason != "" {
		t.Fatalf("unexpected new session: %#v", got)
	}
}

func TestResumeOrCreateReturnsSaveError(t *testing.T) {
	store := newMemoryStore()
	store.saveErr = errors.New("disk full")
	_, err := ResumeOrCreate(store, StartRequest{
		SessionID:   "missing",
		ProjectName: "default",
		Channel:     "wechat",
		UserID:      "u3",
	})
	if err == nil {
		t.Fatal("expected save error")
	}
}
