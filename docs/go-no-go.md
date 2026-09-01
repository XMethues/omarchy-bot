# Go / No-Go

## 决策

**Go，但按“九 Agent runtime = 九个多角色 Bot，共享 Omarchy Computer”分阶段验证。**

项目价值不是网页调用九个 CLI，而是让九个长期、多角色 Bot 在同一台 Omarchy 电脑上完成工作：聊天、操作电脑、等待审批、后台运行、Routine 和角色间 handoff。连接方式以原生功能完整度为首要指标。

公共第三方插件 API 延期；Routine、Task/Run、Computer 和多 Bot 协作属于 MVP 核心。MVP 后以 Tauri 桌面客户端提供远程连接，但服务仍运行在 Omarchy 上，且不默认公开公网端口。

## 已确认的基础可行性

九个 Agent 都有可用于富客户端集成的官方接口：

- Pi：TypeScript SDK；
- OMP：Bun SDK；
- Codex：app-server；
- Claude：Agent SDK；
- OpenCode：TypeScript SDK + server；
- Copilot：TypeScript SDK + JSON-RPC runtime；
- Grok：原生 ACP + `x.ai/*` 扩展；
- Gemini：ACP；
- Crush：server API + SSE。

统一 Computer 可以通过 computer-use-linux MCP/custom tool bridge 暴露给九个 Bot。systemd user service、SQLite、Omarchy hooks 和通知足以承载本机 Routine 与状态持久化。

详细依据见 [agents-integration.md](./agents-integration.md)、[design.md](./design.md)、[app-structure.md](./app-structure.md) 和 [technology-selection.md](./technology-selection.md)。

## 主要风险

1. **共享桌面竞态**：九个 Bot 不能同时点击和输入；必须有独占 Computer lease；
2. **人工与 Bot 争抢**：检测到用户输入或 Take over 后立即暂停 Bot；
3. **敏感操作**：登录、发送、删除、购买等即使在 trusted 下也要 Action needed；
4. **上游变化**：CLI/SDK 升级后重新跑 conformance，失败即隐藏 Bot；
5. **后台可靠性**：Routine 必须去重、可恢复，并明确关机/休眠时的 missed-run 行为；
6. **多 Bot 循环**：handoff 设置 hop、预算、时间和并发限制；
7. **同项目并发写**：使用 task lock 或 Git worktree；
8. **范围过大**：先证明 Pi Bot + Computer，再扩展九 Bot、Routine 和团队协作。

## Gates

### Gate 1：Pi Bot + Omarchy Computer

必须端到端通过：

- 持久 direct thread 与原生 session 恢复；
- 流式文本和工具卡；
- Computer observe/screenshot/click/type；
- 独占 lease；
- Agent 权限和 Computer 权限；
- Action needed；
- Take over 后停止输入，I’m done 后重新观察并继续；
- abort 后没有晚到写操作或桌面输入；
- 服务重启后 lease 不会错误恢复为 Bot 持有。

任一安全项不稳定则停止扩展。

### Gate 2：九 Bot 一致性

其余八个 Bot 使用最完整官方接口，通过同一组：

- chat/session；
- tool lifecycle；
- approval/abort；
- 图片和文件；
- Computer；
- Task/Run 状态。

不通过者保持 unavailable，禁止使用 headless/PTY/自动批准假装完整支持。

### Gate 3：持续工作

验证：

- Routine 创建、启停、补跑/跳过；
- 重启去重；
- Bot memory 和 workspace memory；
- 完成、阻塞、Action needed 桌面通知；
- 从成功 Run 保存为 Routine。

### Gate 4：Bot 团队

验证角色创建、同 Bot 多角色 direct/channel、跨 Bot channel、mention、handoff、child task、artifact 传递和循环限制。所有协作由 omarchy-bot orchestration 实现，不能只在支持原生 subagent 的 Bot 上可用。

### Gate 5：自用与发布

连续两周日常使用，确认：

- Bot 确实完成工作而非只返回建议；
- Computer lease 不干扰正常桌面使用；
- Routine 值得长期运行；
- 多 Bot handoff 比用户手动复制上下文更有效；
- 上游升级维护成本可接受。

之后进入 Tauri Remote：复用同一 REST/WebSocket API，完成本机配对、设备撤销、加密通道、断线恢复和远程 Take over；公共插件 API 与完整 Teach-a-task 再单独评估。

## Kill criteria

满足任一项即暂停或缩小范围：

1. 无法可靠阻止两个 Bot 或 Bot 与用户同时控制桌面；
2. 无法为全部 ready Bot 提供相同审批和 Computer 能力；
3. Routine 会重复执行或在恢复时误执行敏感操作；
4. handoff 容易产生无界循环或费用；
5. conformance 无法检测破坏性升级；
6. 必须依赖默认自动批准或 PTY 抓屏才能维持支持数量；
7. 作者连续两周不实际使用；
8. Tauri Remote 必须公开未认证公网端口或无法在本机即时撤销控制。

## 工期

Gate 1 可以采用两周验证时间盒，但不是完成承诺。整体工期应在 Pi Bot、Computer lease 和 Take over 安全闭环通过后重新估算。
