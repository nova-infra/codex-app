package render

func SampleEvents() []Event {
	return []Event{
		{Kind: EventKindStarted, Text: "已收到来自社交 channel 的请求", ThreadID: "thread-1"},
		{Kind: EventKindReasoning, Text: "<think>分析上下文与回复结构</think>", ThreadID: "thread-1"},
		{Kind: EventKindToolStart, Text: "读取 architecture / channel 文档", ToolName: "read-docs", ThreadID: "thread-1"},
		{Kind: EventKindToolDone, Text: "文档读取完成", ToolName: "read-docs", ThreadID: "thread-1"},
		{Kind: EventKindTextDelta, Text: "Go 重写第一阶段先统一返回消息契约，再接入 Telegram、微信和飞书。", ThreadID: "thread-1"},
		{Kind: EventKindApproval, Text: "是否继续接入真实平台？", Approval: &ApprovalRequest{RequestID: "approval-demo", Title: "继续执行", Body: "mock 阶段之后再接真实平台"}, ThreadID: "thread-1"},
		{Kind: EventKindFinal, Text: "mock 渲染已生成，可用于后续真实 channel 适配。", ThreadID: "thread-1"},
	}
}
