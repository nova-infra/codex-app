package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Record struct {
	ID          string               `json:"id"`
	ProjectName string               `json:"project_name"`
	Channel     string               `json:"channel"`
	UserID      string               `json:"user_id"`
	Runtime     RuntimeSessionConfig `json:"runtime"`
	UpdatedAt   time.Time            `json:"updated_at"`
}

type FileStore struct {
	Path string
}

func NewFileStore(path string) FileStore {
	return FileStore{Path: path}
}

func (s FileStore) Save(record Record) error {
	if strings.TrimSpace(record.ID) == "" {
		return fmt.Errorf("session id is required")
	}
	if strings.TrimSpace(s.Path) == "" {
		return fmt.Errorf("session store path is required")
	}
	records, err := s.LoadAll()
	if err != nil {
		return err
	}
	record.UpdatedAt = time.Now().UTC()
	records[record.ID] = record
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.Path, append(body, '\n'), 0o600)
}

func (s FileStore) Load(id string) (Record, error) {
	records, err := s.LoadAll()
	if err != nil {
		return Record{}, err
	}
	record, ok := records[id]
	if !ok {
		return Record{}, fmt.Errorf("session %q not found", id)
	}
	return record, nil
}

func (s FileStore) LoadAll() (map[string]Record, error) {
	if strings.TrimSpace(s.Path) == "" {
		return nil, fmt.Errorf("session store path is required")
	}
	body, err := os.ReadFile(s.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]Record{}, nil
		}
		return nil, err
	}
	records := map[string]Record{}
	if len(body) == 0 {
		return records, nil
	}
	if err := json.Unmarshal(body, &records); err != nil {
		return nil, fmt.Errorf("parse session store %q: %w", s.Path, err)
	}
	return records, nil
}
