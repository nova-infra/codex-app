package render

import (
	"fmt"
	"regexp"
	"strings"
)

var thinkingTagPattern = regexp.MustCompile(`(?s)<think>.*?</think>`)

func sanitizeText(text string) string {
	trimmed := strings.TrimSpace(text)
	trimmed = strings.TrimSpace(thinkingTagPattern.ReplaceAllString(trimmed, ""))
	if trimmed == "" {
		return ""
	}
	return strings.TrimSpace(strings.Join(strings.Fields(trimmed), " "))
}

func IsReasoning(kind EventKind, text string) bool {
	return kind == EventKindReasoning || strings.HasPrefix(strings.ToLower(strings.TrimSpace(text)), "<think>")
}

func visibleText(text string) string {
	clean := sanitizeText(text)
	clean = strings.ReplaceAll(clean, "  ", " ")
	return strings.TrimSpace(clean)
}

func splitPlainText(text string, maxLen int) []string {
	if maxLen <= 0 || maxLen >= len(text) {
		return []string{strings.TrimSpace(text)}
	}
	parts := []string{}
	for i := 0; i < len(text); {
		end := i + maxLen
		if end > len(text) {
			end = len(text)
		}
		segment := strings.TrimSpace(text[i:end])
		if segment != "" {
			parts = append(parts, segment)
		}
		i = end
	}
	return parts
}

func ApplyProfile(events []Event, profile DisplayProfile) ([]Event, []string) {
	out := make([]Event, 0, len(events))
	warnings := []string{}
	for _, event := range events {
		if !profile.ShowReasoning && IsReasoning(event.Kind, event.Text) {
			continue
		}
		if event.Kind == EventKindMedia && len(event.Media) == 0 {
			warnings = append(warnings, "media event missing attachment")
			continue
		}
		e := event
		e.Text = visibleText(e.Text)
		if e.Text == "" && e.Kind != EventKindMedia && e.Kind != EventKindToolStart && e.Kind != EventKindToolDone {
			continue
		}
		if e.Kind == EventKindToolStart && profile.ToolProgress == ToolProgressOff {
			continue
		}
		if e.Kind == EventKindToolDone && profile.ToolProgress == ToolProgressOff {
			continue
		}
		out = append(out, e)
	}
	return out, warnings
}

func BlockType(kind EventKind) string {
	return blockTypeForEvent(kind)
}

func BuildTextBlocks(text string, previewLen int) []RenderBlock {
	plain := strings.TrimSpace(text)
	if plain == "" {
		return nil
	}
	parts := splitPlainText(plain, previewLen)
	blocks := make([]RenderBlock, 0, len(parts))
	for _, p := range parts {
		blocks = append(blocks, RenderBlock{Type: "text", Text: strings.TrimSpace(p), Metadata: map[string]string{"truncated": "false"}})
	}
	return blocks
}

func blockTypeForEvent(kind EventKind) string {
	switch kind {
	case EventKindToolStart:
		return "tool_progress"
	case EventKindToolDone:
		return "tool_progress_done"
	case EventKindApproval:
		return "approval"
	case EventKindMedia:
		return "media"
	case EventKindError:
		return "error"
	case EventKindFinal:
		return "final"
	default:
		return "text"
	}
}

func ErrorText(err error) string {
	if err == nil {
		return ""
	}
	return fmt.Sprintf("%v", err)
}
