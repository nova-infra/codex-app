package codex

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type StreamingResponder interface {
	Respond(ctx context.Context, userText string) (string, error)
	StreamRespond(ctx context.Context, userText string, onDelta func(string)) (string, error)
}

type AppServerResponder struct {
	Executable string
	Model      string
	WorkDir    string
	Timeout    time.Duration
	SessionKey string
	Fallback   ExecResponder
}

func NewStreamingResponderFromEnv() StreamingResponder {
	return NewStreamingResponderFromEnvWithSession("default")
}

func NewStreamingResponderFromEnvWithSession(sessionKey string) StreamingResponder {
	return AppServerResponder{
		Executable: strings.TrimSpace(os.Getenv("CODEX_EXECUTABLE")),
		Model:      strings.TrimSpace(os.Getenv("CODEX_EXEC_MODEL")),
		WorkDir:    strings.TrimSpace(os.Getenv("CODEX_EXEC_WORKDIR")),
		Timeout:    timeoutFromEnv(os.Getenv("CODEX_EXEC_TIMEOUT_SECONDS")),
		SessionKey: sessionKey,
		Fallback:   NewExecResponderFromEnv(),
	}
}

func (r AppServerResponder) Respond(ctx context.Context, userText string) (string, error) {
	return r.StreamRespond(ctx, userText, nil)
}

func (r AppServerResponder) StreamRespond(ctx context.Context, userText string, onDelta func(string)) (string, error) {
	if strings.TrimSpace(userText) == "" {
		return "", fmt.Errorf("codex prompt is empty")
	}
	ctx, cancel := context.WithTimeout(ctx, r.timeout())
	defer cancel()

	session, err := sharedAppServerSessions.getOrCreate(
		r.executable(),
		r.Model,
		r.WorkDir,
		r.sessionKey(),
	)
	if err != nil {
		return r.Fallback.StreamRespond(ctx, userText, onDelta)
	}
	finalText, err := session.respond(ctx, userText, onDelta)
	if err != nil {
		sharedAppServerSessions.invalidate(session.key)
		if strings.TrimSpace(finalText) != "" {
			return finalText, err
		}
		return r.Fallback.StreamRespond(ctx, userText, onDelta)
	}
	return finalText, nil
}

func (r AppServerResponder) sessionKey() string {
	key := strings.TrimSpace(r.SessionKey)
	if key == "" {
		return "default"
	}
	return key
}

func (r AppServerResponder) executable() string {
	if executable := strings.TrimSpace(r.Executable); executable != "" {
		return executable
	}
	return "codex"
}

func (r AppServerResponder) timeout() time.Duration {
	if r.Timeout > 0 {
		return r.Timeout
	}
	return 90 * time.Second
}

type appServerSessionManager struct {
	mu       sync.Mutex
	sessions map[string]*appServerConversation
}

type appServerConversation struct {
	key         string
	executable  string
	model       string
	workDir     string
	proc        *appServerProcess
	threadID    string
	initialized bool
	mu          sync.Mutex
}

var sharedAppServerSessions = newAppServerSessionManager()

func newAppServerSessionManager() *appServerSessionManager {
	return &appServerSessionManager{sessions: map[string]*appServerConversation{}}
}

func (m *appServerSessionManager) getOrCreate(executable, model, workDir, sessionKey string) (*appServerConversation, error) {
	key := strings.Join([]string{
		strings.TrimSpace(executable),
		strings.TrimSpace(model),
		strings.TrimSpace(workDir),
		strings.TrimSpace(sessionKey),
	}, "\x1f")
	m.mu.Lock()
	defer m.mu.Unlock()
	if session, ok := m.sessions[key]; ok {
		return session, nil
	}
	session := &appServerConversation{
		key:        key,
		executable: strings.TrimSpace(executable),
		model:      strings.TrimSpace(model),
		workDir:    strings.TrimSpace(workDir),
	}
	m.sessions[key] = session
	return session, nil
}

func (m *appServerSessionManager) invalidate(key string) {
	key = strings.TrimSpace(key)
	if key == "" {
		return
	}
	m.mu.Lock()
	session := m.sessions[key]
	if session != nil {
		delete(m.sessions, key)
	}
	m.mu.Unlock()
	if session != nil {
		session.close()
	}
}

func (s *appServerConversation) respond(ctx context.Context, userText string, onDelta func(string)) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.proc == nil {
		proc, err := newAppServerProcess(s.executable, s.workDir)
		if err != nil {
			return "", err
		}
		s.proc = proc
		s.initialized = false
		s.threadID = ""
	}
	if !s.initialized {
		if err := s.proc.Initialize(ctx); err != nil {
			s.closeLocked()
			return "", err
		}
		if err := s.proc.SendInitialized(ctx); err != nil {
			s.closeLocked()
			return "", err
		}
		s.initialized = true
	}
	if strings.TrimSpace(s.threadID) == "" {
		threadID, err := s.proc.StartThread(ctx, s.model, s.workDir)
		if err != nil {
			s.closeLocked()
			return "", err
		}
		s.threadID = threadID
	}
	reply, err := s.proc.StartTurn(ctx, s.threadID, userText, onDelta)
	if err != nil {
		if ctx.Err() != nil {
			s.closeLocked()
		}
		return reply, err
	}
	return reply, nil
}

func (s *appServerConversation) close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closeLocked()
}

func (s *appServerConversation) closeLocked() {
	if s.proc != nil {
		s.proc.Close()
	}
	s.proc = nil
	s.threadID = ""
	s.initialized = false
}

type appServerProcess struct {
	cmd      *exec.Cmd
	stdin    io.WriteCloser
	reader   *bufio.Reader
	mu       sync.Mutex
	nextID   int64
	closed   bool
	messages chan appServerMessage
}

type appServerMessage struct {
	id     *int64
	method string
	params json.RawMessage
	result json.RawMessage
	err    *jsonRPCError
}

type jsonRPCError struct {
	Code    int64           `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func newAppServerProcess(executable string, workDir string) (*appServerProcess, error) {
	cmd := exec.Command(executable, "app-server", "--listen", "stdio://")
	if strings.TrimSpace(workDir) != "" {
		cmd.Dir = workDir
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		return nil, err
	}
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		return nil, err
	}
	p := &appServerProcess{
		cmd:      cmd,
		stdin:    stdin,
		reader:   bufio.NewReader(stdout),
		messages: make(chan appServerMessage, 128),
	}
	go p.readLoop()
	return p, nil
}

func (p *appServerProcess) Close() {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return
	}
	p.closed = true
	p.mu.Unlock()
	_ = p.stdin.Close()
	if p.cmd != nil && p.cmd.Process != nil {
		_ = p.cmd.Process.Kill()
		_, _ = p.cmd.Process.Wait()
	}
}

func (p *appServerProcess) readLoop() {
	defer close(p.messages)
	for {
		line, err := p.reader.ReadBytes('\n')
		if err != nil {
			return
		}
		line = bytesTrimSpace(line)
		if len(line) == 0 {
			continue
		}
		msg, err := parseAppServerMessage(line)
		if err != nil {
			continue
		}
		p.messages <- msg
	}
}

func (p *appServerProcess) writeRequest(ctx context.Context, method string, params any) (int64, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return 0, fmt.Errorf("app-server process is closed")
	}
	p.nextID++
	id := p.nextID
	req := map[string]any{
		"id":     id,
		"method": method,
	}
	if params != nil {
		req["params"] = params
	}
	raw, err := json.Marshal(req)
	if err != nil {
		return 0, err
	}
	if _, err := io.WriteString(p.stdin, string(raw)+"\n"); err != nil {
		return 0, err
	}
	return id, nil
}

func (p *appServerProcess) writeNotification(ctx context.Context, method string, params any) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return fmt.Errorf("app-server process is closed")
	}
	req := map[string]any{
		"method": method,
	}
	if params != nil {
		req["params"] = params
	}
	raw, err := json.Marshal(req)
	if err != nil {
		return err
	}
	if _, err := io.WriteString(p.stdin, string(raw)+"\n"); err != nil {
		return err
	}
	return nil
}

func (p *appServerProcess) waitForResponse(ctx context.Context, id int64, onNotification func(method string, params json.RawMessage)) (json.RawMessage, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case msg, ok := <-p.messages:
			if !ok {
				return nil, io.EOF
			}
			if msg.method != "" {
				if onNotification != nil {
					onNotification(msg.method, msg.params)
				}
				continue
			}
			if msg.id == nil || *msg.id != id {
				continue
			}
			if msg.err != nil {
				return nil, fmt.Errorf("app-server rpc error %d: %s", msg.err.Code, msg.err.Message)
			}
			return msg.result, nil
		}
	}
}

func (p *appServerProcess) Initialize(ctx context.Context) error {
	id, err := p.writeRequest(ctx, "initialize", map[string]any{
		"clientInfo": map[string]any{
			"name":    "codex-app",
			"version": "1",
		},
		"capabilities": map[string]any{
			"experimentalApi": true,
		},
	})
	if err != nil {
		return err
	}
	_, err = p.waitForResponse(ctx, id, nil)
	return err
}

func (p *appServerProcess) SendInitialized(ctx context.Context) error {
	return p.writeNotification(ctx, "initialized", map[string]any{})
}

func (p *appServerProcess) StartThread(ctx context.Context, model string, workDir string) (string, error) {
	params := map[string]any{
		"ephemeral": true,
	}
	if strings.TrimSpace(model) != "" {
		params["model"] = strings.TrimSpace(model)
	}
	if strings.TrimSpace(workDir) != "" {
		params["cwd"] = strings.TrimSpace(workDir)
	}
	id, err := p.writeRequest(ctx, "thread/start", params)
	if err != nil {
		return "", err
	}
	raw, err := p.waitForResponse(ctx, id, nil)
	if err != nil {
		return "", err
	}
	return extractThreadID(raw)
}

func (p *appServerProcess) StartTurn(ctx context.Context, threadID string, prompt string, onDelta func(string)) (string, error) {
	params := map[string]any{
		"threadId": threadID,
		"input": []any{
			map[string]any{
				"type": "text",
				"text": prompt,
			},
		},
	}
	id, err := p.writeRequest(ctx, "turn/start", params)
	if err != nil {
		return "", err
	}
	var (
		mu           sync.Mutex
		builder      strings.Builder
		finalRaw     json.RawMessage
		haveResponse bool
		haveDone     bool
	)
	for !(haveResponse && haveDone) {
		select {
		case <-ctx.Done():
			return builder.String(), ctx.Err()
		case msg, ok := <-p.messages:
			if !ok {
				if haveResponse {
					text := strings.TrimSpace(builder.String())
					if text != "" {
						return text, nil
					}
					extracted, extractErr := extractTurnText(finalRaw)
					if extractErr != nil {
						return "", extractErr
					}
					return extracted, nil
				}
				return "", io.EOF
			}
			if msg.method != "" {
				switch msg.method {
				case "item/agentMessage/delta", "turn/delta":
					var payload struct {
						Delta string `json:"delta"`
					}
					if json.Unmarshal(msg.params, &payload) != nil || payload.Delta == "" {
						continue
					}
					mu.Lock()
					builder.WriteString(payload.Delta)
					mu.Unlock()
					if onDelta != nil {
						onDelta(payload.Delta)
					}
				case "turn/completed":
					haveDone = true
				}
				continue
			}
			if msg.id == nil || *msg.id != id {
				continue
			}
			if msg.err != nil {
				return builder.String(), fmt.Errorf("app-server rpc error %d: %s", msg.err.Code, msg.err.Message)
			}
			finalRaw = append(json.RawMessage(nil), msg.result...)
			haveResponse = true
		}
	}
	text := strings.TrimSpace(builder.String())
	if text != "" {
		return text, nil
	}
	extracted, extractErr := extractTurnText(finalRaw)
	if extractErr != nil {
		return "", extractErr
	}
	return extracted, nil
}

func parseAppServerMessage(line []byte) (appServerMessage, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(line, &raw); err != nil {
		return appServerMessage{}, err
	}
	msg := appServerMessage{}
	if method, ok := raw["method"]; ok {
		_ = json.Unmarshal(method, &msg.method)
	}
	if idRaw, ok := raw["id"]; ok {
		var id int64
		if err := json.Unmarshal(idRaw, &id); err == nil {
			msg.id = &id
		}
	}
	if params, ok := raw["params"]; ok {
		msg.params = append(json.RawMessage(nil), params...)
	}
	if result, ok := raw["result"]; ok {
		msg.result = append(json.RawMessage(nil), result...)
	}
	if errRaw, ok := raw["error"]; ok {
		var rpcErr jsonRPCError
		if err := json.Unmarshal(errRaw, &rpcErr); err == nil {
			msg.err = &rpcErr
		}
	}
	return msg, nil
}

func extractThreadID(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", fmt.Errorf("app-server returned empty thread payload")
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return "", err
	}
	if threadRaw, ok := obj["thread"]; ok {
		var thread map[string]json.RawMessage
		if err := json.Unmarshal(threadRaw, &thread); err == nil {
			if id := firstJSONString(thread, "id"); id != "" {
				return id, nil
			}
		}
	}
	if id := firstJSONString(obj, "threadId", "id"); id != "" {
		return id, nil
	}
	return "", fmt.Errorf("app-server thread response missing thread id")
}

func extractTurnText(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return "", err
	}
	if turnRaw, ok := obj["turn"]; ok {
		var turn map[string]json.RawMessage
		if err := json.Unmarshal(turnRaw, &turn); err == nil {
			if text := extractTextFromAny(turn); text != "" {
				return text, nil
			}
		}
	}
	if text := extractTextFromAny(obj); text != "" {
		return text, nil
	}
	return "", nil
}

func extractTextFromAny(obj map[string]json.RawMessage) string {
	if obj == nil {
		return ""
	}
	if text := firstJSONString(obj, "content", "text", "output_text"); text != "" {
		return text
	}
	if itemsRaw, ok := obj["items"]; ok {
		var items []map[string]json.RawMessage
		if err := json.Unmarshal(itemsRaw, &items); err == nil {
			var parts []string
			for _, item := range items {
				if itemType := firstJSONString(item, "type"); itemType == "agentMessage" || itemType == "message" {
					if text := firstJSONString(item, "text", "content", "delta"); text != "" {
						parts = append(parts, text)
						continue
					}
					if contentRaw, ok := item["content"]; ok {
						var content map[string]json.RawMessage
						if err := json.Unmarshal(contentRaw, &content); err == nil {
							if text := firstJSONString(content, "text"); text != "" {
								parts = append(parts, text)
							}
						}
					}
				}
			}
			return strings.TrimSpace(strings.Join(parts, ""))
		}
	}
	return ""
}

func firstJSONString(obj map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		raw, ok := obj[key]
		if !ok {
			continue
		}
		var text string
		if err := json.Unmarshal(raw, &text); err == nil {
			text = strings.TrimSpace(text)
			if text != "" {
				return text
			}
		}
	}
	return ""
}

func bytesTrimSpace(in []byte) []byte {
	start := 0
	for start < len(in) {
		switch in[start] {
		case ' ', '\n', '\r', '\t':
			start++
		default:
			goto right
		}
	}
right:
	end := len(in)
	for end > start {
		switch in[end-1] {
		case ' ', '\n', '\r', '\t':
			end--
		default:
			return in[start:end]
		}
	}
	return in[start:end]
}
