---
"@codex-app/channel-telegram": patch
---

Reduce duplicate Telegram replies by reusing the streaming preview as the final message when possible, ignore reasoning summary deltas that caused extra progress-card churn, and surface Telegram edit failures instead of silently swallowing them.
