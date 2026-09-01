# Agent 接入规范

> 核验日期：2026-09-01。结论以本机 CLI 帮助、各项目官方文档和官方 GitHub 仓库为准，来源见文末。

## 1. 产品原则：完整度优先，公共基线兜底

连接方式首先选择上游官方提供的**能力超集**：原生 SDK 或富 app-server/server 优先于信息有损的标准化接口。只有 ACP 本身就是该 Agent 最完整的官方外部接口，或原生 SDK 尚未实现审批等关键能力时，才以 ACP 为主路径。开发成本和协议复用不能成为牺牲功能的理由。

同时，用户在 Web 聊天中不应遇到“Agent A 支持取消、Agent B 不支持审批”。因此所有正式可用的 Agent 必须通过以下公共基线；适配器还必须无损保留原生接口提供的高级事件和控制能力。

公共能力：

1. 创建、恢复并读取会话；
2. 流式文本输出；
3. 结构化工具开始、进度、结果事件；
4. 工具权限请求及允许/拒绝响应；
5. 中止当前 turn；
6. 文本、图片和文件附件；
7. cwd 与模型选择；
8. 明确的完成、取消和错误边界。

完整度与统一性分两层处理：

- **公共基线**：九个 Agent 的 UI 和语义必须一致；
- **原生能力层**：reasoning、usage、plan、subagent、steer、fork、compact、slash command 等不得在 adapter 中丢弃，统一封装为 typed capability/event；前端可以用通用详情卡展示，无法跨 Agent 等价的操作必须清楚标识为原生能力，不能伪造。

“体验一致”不等于只取协议交集；它表示基础功能没有缺口，同时原生能力不会因为选择了统一 transport 而被截断。

产品层固定 `BotId === AgentId`：Pi、OMP、Codex、Claude、Grok、OpenCode、Gemini、Copilot、Crush 各自就是一个长期、多角色 Bot。一个 Bot 可以有多个 `RoleId`，每个角色拥有独立 instructions、memory、Routine 和 thread/session；这些角色仍复用同一个 adapter/runtime 类型。Routine、memory、handoff 和共享 Omarchy Computer 由上层 orchestration 统一提供，不能依赖某个 Agent 的同名私有功能。

## 2. 统一事件与会话接口

```ts
type PermissionMode = "ask" | "trusted";

type AgentEvent =
  | { type: "message.delta"; text: string }
  | { type: "tool.started"; id: string; name: string; input: unknown }
  | { type: "tool.updated"; id: string; output?: unknown }
  | { type: "tool.completed"; id: string; output: unknown; isError: boolean }
  | { type: "permission.requested"; id: string; tool: string; details: unknown }
  | { type: "turn.completed" }
  | { type: "turn.cancelled" }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "native"; capability: string; payload: unknown };

interface AgentAdapter {
  readonly id: string;
  probe(): Promise<ProbeResult>;
  open(options: OpenSessionOptions): Promise<AgentSession>;
  resume(nativeSessionId: string, options: OpenSessionOptions): Promise<AgentSession>;
}

interface AgentSession {
  readonly nativeSessionId: string;
  send(message: UserMessage): Promise<void>;
  events(): AsyncIterable<AgentEvent>;
  respondPermission(requestId: string, allow: boolean): Promise<void>;
  abort(): Promise<void>;
  history(): Promise<NormalizedMessage[]>;
  close(): Promise<void>;
}
```

所有异步命令必须有 request ID；命令被接受不等于 turn 完成。适配器只能在原生协议给出最终完成/取消事件后发出统一终态。

## 3. 权限语义

公共 UI 只提供两种模式：

- `ask`：写文件、执行命令、访问额外路径或网络等副作用必须在 Web 端确认；
- `trusted`：由用户对当前会话显式开启，Agent 可按自身策略自动执行。

不提供含义模糊的统一 `auto`/`yolo`。各 Agent 的 sandbox、allowlist 和企业策略仍然生效，网关不会绕过上游的强制限制。

Pi 没有内置逐工具审批，因此正式接入需要一个很小的 Pi permission extension，在 SDK resource loader 中注册并把工具调用映射到 Web 确认。该 extension 是统一权限所需，不是传输层所需。

## 4. 最终连接方式

| Agent | 正式连接方式 | 启动入口 | 选择原因 |
|---|---|---|---|
| Pi | 官方 TypeScript SDK | `@earendil-works/pi-coding-agent` | 官方明确用于 custom UI；直接访问 session、资源加载、extension、工具和完整事件 |
| OMP | 官方 Bun SDK | `@oh-my-pi/pi-coding-agent` | 官方定义为进程内完整集成面；直接访问 agent state、事件、tool wiring、session 和 UI context |
| Codex | 官方 app-server stdio | `codex app-server --stdio` | 官方富客户端接口；thread/turn、流式、审批、interrupt、附件和动态命令完整 |
| Claude Code | 官方 TypeScript Agent SDK | `@anthropic-ai/claude-agent-sdk` | `query()`、hooks、`canUseTool`、resume、interrupt 和 partial messages 完整 |
| Grok Build | 原生 ACP + `x.ai/*` 扩展 | `grok agent stdio` | Grok TUI、Desktop 和官方 agent SDK 自身都以该通道驱动 shell；它实际上就是 Grok 的原生 app-server 协议 |
| OpenCode | 官方 TypeScript SDK + server | `@opencode-ai/sdk` / `opencode serve` | SDK 是完整 server API 的 typed client；额外覆盖 session children/share/revert/summarize、文件、LSP、TUI 和全量事件 |
| Gemini CLI | 官方 ACP stdio | `gemini --acp` | 当前 SDK 的 approvals、hooks、subagents 和 ACP 尚未完整实现；ACP 反而是现阶段完整的交互接入面 |
| GitHub Copilot CLI | 官方 TypeScript SDK | `@github/copilot-sdk` | JSON-RPC SDK 完整暴露多会话、权限、elicitation、hooks、steer/queue、usage、subagent、附件和恢复 |
| Crush | 官方 server API | `crush server` | 官方 Unix socket/HTTP API + SSE；会话、工具事件、权限、问题、取消和附件完整 |

### 不采用的主路径

- `*-p`、`exec --json` 等一次性 headless：适合 automation fallback，但不能稳定承载双向审批和长驻聊天；
- 社区 ACP wrapper：存在官方富接口时不增加第三方依赖；
- 为了复用代码而只实现 ACP 标准子集：完整度优先；Grok 必须实现其 `x.ai/*` 原生扩展，不能只接基础 ACP；
- PTY 抓屏：结构化事件和权限都不可靠；
- `omarchy agent`：它是交互式 TUI 启动器，并会为多数 Agent 添加自动批准参数；
- Codex WebSocket app-server：官方仍标记 experimental/unsupported，使用 stdio；
- Grok WebSocket server：本机同进程网关不需要额外网络监听。

## 5. 各适配器实现要点

### 5.1 Pi SDK

- 使用 `createAgentSession()` 和 `DefaultResourceLoader`，保留用户 extensions、skills、prompt templates 和 context files；
- 订阅完整 session event stream，以 settled 状态作为 turn 最终边界；
- 通过 `SessionManager`/原生 session API 创建和恢复，不复制 transcript；
- permission extension 作为 named inline extension 注入，并通过 event bus 与 Web PermissionService 通信；
- SDK 放在受管 worker process 中，兼顾完整度与崩溃隔离；RPC 仅作为诊断备用路径。

### 5.2 OMP SDK

- 使用 `createCodingAgentSession()`；宿主 worker 必须满足 Bun 1.3.14+；
- 直接消费 agent state、event streaming、tool wiring、session control；
- Web 交互实现 `ExtensionUIContext`，通过 `setToolUIContext(..., true)` 接入审批和 extension UI；
- 保留 OMP extensions、skills、custom tools、approval mode 和 session features；
- SDK worker 与 Bun daemon 通过内部版本化 IPC 通信，ACP/RPC-ui 只作为诊断备用路径。

### 5.3 Codex app-server

- 每个连接先 `initialize`，再发送 `initialized`；
- 使用 `thread/start|resume`、`turn/start`、`turn/interrupt`；
- 以 `turn/completed` 为最终边界；
- 实现 command/file change/permissions 等 server request 的审批响应；
- 构建时运行 `codex app-server generate-ts` 或 `generate-json-schema`，生成物必须与探测到的 Codex 版本匹配；
- 只使用 stdio，日志走 stderr。

### 5.4 Claude Agent SDK

- 使用官方 `query()`，多轮输入使用 `AsyncIterable<SDKUserMessage>`；
- `canUseTool` 映射统一审批卡，不与会绕过 callback 的 `allowedTools`/bypass 配置混用；
- 使用 `resume` 恢复，`interrupt()` 取消；
- 从 `system/init` 获取 session ID；
- 订阅 partial message、tool use/result 和最终 result，不能只解析最终文本。

### 5.5 OpenCode SDK/server

- 使用 `createOpencode()` 启动受管 server，或用 `createOpencodeClient()` 连接指定本地 HTTP endpoint；
- 订阅 `event.subscribe()` SSE，并完整保存 message parts；
- 使用 session create/list/messages/prompt/abort、permission response；
- 同时保留 children、share、summarize、revert/unrevert、command、shell、file、LSP 等原生 API；
- ACP 只作为兼容性测试目标，不作为主路径。

### 5.6 Copilot SDK

- 使用 `CopilotClient` 的 stdio runtime connection，避免 experimental in-process FFI；
- 使用 create/resume/list/delete session、typed streaming events、`abort()` 和 `getEvents()`；
- `onPermissionRequest`、user input 和 elicitation callback 映射 Web 交互；
- 保留 hooks、skills、custom agents、subagent、steering/queueing、usage、citations 和 infinite sessions；
- 以 `session.idle` 作为最终完成边界。

### 5.7 Grok 原生 ACP

Grok 不是“仅支持标准 ACP”。其 TUI 的 pager、Desktop 和源码中提到的官方 agent SDK 都会启动 `grok agent … stdio`；真正的完整接口是 **ACP v1 + `x.ai/*` 双向扩展**。

基础 ACP 实现：

- initialize/authenticate；
- session/new、load、list、resume、close、prompt、cancel；
- text、thought、tool、plan 和 image updates；
- permission requests、MCP elicitation、ask-user 和 plan approval；
- model/session mode 与 MCP server configuration。

必须实现或无损透传的 Grok 扩展：

- session：list/search/info/state/history/updates/usage、fork、rename、delete、repair、import、rehydrate；
- turn：`x.ai/session/prompt_complete`、interject、queue edit/reorder/remove/clear；
- context：rewind points/execute、compact、recap、prompt history；
- agent：subagent lifecycle/list/cancel、background task、scheduler、follow-up、goal/workflow；
- extensibility：client hooks、skills、plugins、marketplace、MCP SDK reverse calls；
- workspace：fs notify/index、git/diff/worktree、hunk tracker、review、terminal/PTY、code navigation/search；
- operations：models、auth、usage/billing、memory、announcements 和 retry/compaction notifications。

实现约束：

- `initialize` 带稳定的 `clientIdentifier` 和所需 capabilities，读取 `agentVersion`、`availableCommands`、`modelState` 与 `x.ai` capability metadata；
- 不传 `--always-approve`，让标准 permission request 接到 Web；deny rules、managed policy 和 hooks 始终保留；
- `session/load` 使用 `_meta.cursor` 和 replay/event ID 去重，不能重复渲染历史；
- 普通 prompt 以 `x.ai/session/prompt_complete` 为权威终态；还要单独处理 scheduler/auto-wake 等没有该通知的后台 turn；
- 对未知 `x.ai/*` 消息保存 raw envelope 并上报 capability drift，不能像普通未知 ACP 扩展一样丢弃；
- 为上述核心扩展维护按 Grok 版本固定的 typed inventory 和 conformance tests。

没有发现可公开安装、且比该 wire 更底层完整的 Grok SDK。源码中的官方 `grok-agent-sdk` 同样启动 `grok agent stdio`，用于提供 typed client hooks 和 SDK-host MCP tools；因此可以采用其 SDK（可获得时）作为 typed client，但主协议和完整度仍由 ACP + `x.ai/*` 决定。

### 5.8 Gemini ACP

Gemini 使用标准 ACP 主路径：initialize/authenticate、session new/load/prompt/cancel、session update、permission/elicitation、image/file 与 capability negotiation。Gemini profile 独立维护，不与 Grok 的 `x.ai/*` 绑定。

### 5.9 Crush server

- 默认使用官方 per-user Unix socket，不开放 TCP；
- 创建 workspace 后立即保持 `/v1/workspaces/{id}/events` SSE 连接，否则 workspace 会被回收；
- 使用 sessions、agent、permissions、questions、cancel API；
- 通过 `runId/sessionId/toolCallId` 做事件关联；
- `/v1/docs/` 的 Swagger 和当前二进制版本共同作为协议依据。

## 6. 兼容认证

Agent 不能仅凭 `command -v` 就显示为可用。`probe()` 必须运行版本化 conformance suite：

1. 创建临时 cwd 和会话；
2. 流式返回固定文本；
3. 调用只读工具并收到完整 lifecycle；
4. 触发写工具，分别验证拒绝和允许；
5. 中途取消长 turn；
6. 上传文本文件和 1×1 PNG；
7. 关闭后恢复并读取历史；
8. 验证进程退出和错误不会留下孤儿；
9. 对照该版本官方 capability inventory，确认高级事件与控制 API 已映射或以 typed native envelope 无损保留；
10. 通过统一 Computer tool fixture：观察、截图、申请输入 lease、执行测试输入、Take over 后停止、释放后继续。

公共基线任一项失败，或 adapter 无说明地丢弃官方富接口能力：该 Agent 标记为 `incompatible`，前端不提供聊天入口，并展示最低版本或修复方法。禁止用纯文本、PTY、自动批准或较弱 transport 静默降级。

## 7. 官方来源

本次核验的仓库 commit：

- Pi 0.84.4 本机文档：`docs/sdk.md`、`docs/rpc.md`
- OMP `eea5628f13043286e17c4a2ea4fc28b15fda33ca`：<https://github.com/can1357/oh-my-pi/blob/master/docs/sdk.md>
- Codex `e017e93aceafb2fe04bed1c926e448a5fb4f913d`：<https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- Claude Agent SDK `ecf585fa6114bb5ec9e5ee83a4af64baa041735c`：<https://github.com/anthropics/claude-agent-sdk-typescript>
- Grok Build `bb7f39d5858cbf5e00de639367f59debbdcb0138`：<https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md>
- OpenCode `ebece6efd7b11401cf1e7390b5a22991b6608cc4`：<https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/sdk.mdx>
- Gemini CLI `0bd1d439751478771c45d3d0895a6a9760554bf4`：<https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md>
- Copilot SDK `5b3a03e2d5615076598b9421cd2bced93f4612e8`：<https://github.com/github/copilot-sdk>；npm `@github/copilot-sdk` 1.0.11
- Crush `559ec80922fecf3baa0b7599230f4c91067440de`：<https://github.com/charmbracelet/crush>，API 路由见 `internal/server/server.go`
