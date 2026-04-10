# Telegram / WeChat 端到端联调 TODO

## 1. 启动 dev 实例

- 使用 dev bot token
- 确认独立配置与独立进程
- 验证完成前不碰生产进程

## 2. Telegram 联调

- 普通问答
- 长回复
- 代码块回复
- `/session`
- `/model`
- `/reasoning`
- `/cx`

## 3. WeChat 联调

- 普通问答
- 处理中提示
- 长回复摘要 + 分段
- `/session`
- `/model`
- `/reasoning`
- `/cx`

## 4. 问题记录

- 格式错误
- 无响应
- 状态提示缺失
- 参数未生效
- 账号流程异常

## 5. 修复后重验

- 只修联调暴露的问题
- 按同样用例回归一轮

## 6. 发布前确认

- Telegram 通过
- WeChat 通过
- 再决定是否切生产
