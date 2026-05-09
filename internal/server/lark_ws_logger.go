package server

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
)

type larkWSLogger struct {
	onLog func(level slog.Level, msg string)
}

func (l larkWSLogger) Debug(ctx context.Context, args ...interface{}) {
	l.log(ctx, slog.LevelDebug, args...)
}
func (l larkWSLogger) Info(ctx context.Context, args ...interface{}) {
	l.log(ctx, slog.LevelInfo, args...)
}
func (l larkWSLogger) Warn(ctx context.Context, args ...interface{}) {
	l.log(ctx, slog.LevelWarn, args...)
}
func (l larkWSLogger) Error(ctx context.Context, args ...interface{}) {
	l.log(ctx, slog.LevelError, args...)
}

func (l larkWSLogger) log(_ context.Context, level slog.Level, args ...interface{}) {
	parts := make([]string, 0, len(args))
	for _, arg := range args {
		parts = append(parts, sanitizeLarkWSLog(toLogString(arg)))
	}
	msg := strings.Join(parts, " ")
	if l.onLog != nil {
		l.onLog(level, msg)
	}
	slog.Log(context.Background(), level, "lark ws sdk", "msg", msg)
}

func toLogString(arg interface{}) string {
	return fmt.Sprint(arg)
}

func sanitizeLarkWSLog(value string) string {
	for _, key := range []string{"device_id=", "access_key=", "ticket=", "conn_id=", "secret=", "token=", "key="} {
		value = maskQueryValue(value, key)
	}
	return value
}

func maskQueryValue(value string, key string) string {
	idx := strings.Index(value, key)
	for idx >= 0 {
		start := idx + len(key)
		end := start
		for end < len(value) && value[end] != '&' && value[end] != ' ' && value[end] != ']' {
			end++
		}
		value = value[:start] + "***" + value[end:]
		next := strings.Index(value[start+3:], key)
		if next < 0 {
			break
		}
		idx = start + 3 + next
	}
	return value
}
