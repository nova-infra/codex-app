package session

import (
	"fmt"
	"strings"
)

type Store interface {
	Load(id string) (Record, error)
	Save(record Record) error
}

type StartRequest struct {
	SessionID   string
	ProjectName string
	Channel     string
	UserID      string
	Runtime     RuntimeSessionConfig
}

type StartResult struct {
	Record         Record
	Resumed        bool
	FallbackReason string
}

func ResumeOrCreate(store Store, req StartRequest) (StartResult, error) {
	if store == nil {
		return StartResult{}, fmt.Errorf("session store is required")
	}
	if id := strings.TrimSpace(req.SessionID); id != "" {
		record, err := store.Load(id)
		if err == nil {
			return StartResult{Record: record, Resumed: true}, nil
		}
		return createFallback(store, req, err.Error())
	}
	return createFallback(store, req, "")
}

func createFallback(store Store, req StartRequest, reason string) (StartResult, error) {
	record, err := newRecord(req)
	if err != nil {
		return StartResult{}, err
	}
	if err := store.Save(record); err != nil {
		return StartResult{}, fmt.Errorf("save fallback session: %w", err)
	}
	return StartResult{Record: record, FallbackReason: reason}, nil
}

func newRecord(req StartRequest) (Record, error) {
	projectName := strings.TrimSpace(req.ProjectName)
	channel := strings.TrimSpace(req.Channel)
	userID := strings.TrimSpace(req.UserID)
	if projectName == "" {
		return Record{}, fmt.Errorf("project name is required")
	}
	if channel == "" {
		return Record{}, fmt.Errorf("channel is required")
	}
	if userID == "" {
		return Record{}, fmt.Errorf("user id is required")
	}
	return Record{
		ID:          stableRecordID(projectName, channel, userID),
		ProjectName: projectName,
		Channel:     channel,
		UserID:      userID,
		Runtime:     req.Runtime,
	}, nil
}

func stableRecordID(projectName string, channel string, userID string) string {
	return strings.Join([]string{projectName, channel, userID}, ":")
}
