package session

import (
	"path/filepath"
	"testing"
)

func TestFileStoreSaveLoad(t *testing.T) {
	store := NewFileStore(filepath.Join(t.TempDir(), "sessions.json"))
	record := Record{
		ID:          "telegram:u1",
		ProjectName: "default",
		Channel:     "telegram",
		UserID:      "u1",
		Runtime: RuntimeSessionConfig{
			ProjectName: "default",
			ProjectHome: t.TempDir(),
			Mode:        "yolo",
			ProviderRef: "cliproxy",
		},
	}
	if err := store.Save(record); err != nil {
		t.Fatalf("save: %v", err)
	}
	got, err := store.Load(record.ID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got.ProjectName != record.ProjectName || got.Channel != record.Channel {
		t.Fatalf("unexpected record: %#v", got)
	}
	if got.UpdatedAt.IsZero() {
		t.Fatal("expected updated_at")
	}
}
