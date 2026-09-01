# omarchy-bot 设计

> 产品定义：把 Omarchy 支持的九个 coding Agent 变成九个长期存在、可承载多个角色的 Bot。每个 Bot 保留对应 Agent 的完整能力，并通过统一界面共同操作用户当前这台 Omarchy 电脑。

Agent 接口选型见 [agents-integration.md](./agents-integration.md)，Omarchy 提供的系统能力见 [research.md](./research.md)，进程/仓库结构见 [app-structure.md](./app-structure.md)，运行时与前端选型见 [technology-selection.md](./technology-selection.md)。

## 1. 核心约束

### 1.1 一个 Agent runtime 就是一个多角色 Bot

底层执行 runtime 固定一一对应，不为角色重复实现 adapter：

```text
Pi        → Pi Bot
OMP       → OMP Bot
Codex     → Codex Bot
Claude    → Claude Bot
Grok      → Grok Bot
OpenCode  → OpenCode Bot
Gemini    → Gemini Bot
Copilot   → Copilot Bot
Crush     → Crush Bot
```

```ts
type AgentId =
  | "pi"
  | "omp"
  | "codex"
  | "claude"
  | "grok"
  | "opencode"
  | "gemini"
  | "copilot"
  | "crush";

type BotId = AgentId;
type RoleId = string;

interface ActorRef {
  botId: BotId;
  roleId: RoleId;
}
```

每个 Bot 可以创建多个持久角色，例如同一个 Pi Bot 下有 Coder、Reviewer 和 Chief。角色决定岗位说明、会话、记忆、Routine 和默认 workspace；Bot 决定实际使用哪个 Agent runtime。角色不是新的 adapter 或系统进程。

### 1.2 Omarchy 就是共享 Computer

Grok Bot 使用每用户一台持久云电脑；omarchy-bot 对应的是用户当前的 Omarchy Linux 系统：

- 桌面和窗口；
- 浏览器及登录状态；
- 终端、文件系统和项目；
- 已安装应用；
- 剪贴板、通知、截图；
- Omarchy skills、hooks 和系统命令。

九个 Bot 共享同一台电脑、同一用户权限和同一组登录状态，隔离单位不是 Bot。

这也意味着 omarchy-bot 不能承诺机器关机或休眠时继续工作。Routines 在 systemd user service 可运行期间执行；错过的任务按配置补跑或跳过。

### 1.3 完整度优先

每个 Bot 使用对应 Agent 最完整的官方接口。公共功能必须一致，原生高级能力也不能在 adapter 中丢弃：

```text
完整度 > 官方稳定性 > 安全隔离 > 协议复用 > 开发成本
```

## 2. 产品核心

首个正式产品必须包含：

1. 九个持久多角色 Bot 的 direct chat；
2. 同 Bot 多角色及跨 Bot channel；
3. 后台 Task/Run 状态；
4. Omarchy Computer 观察与操作；
5. Action needed、审批、Take over、I’m done；
6. Bot 间 handoff；
7. Routines 和定时运行；
8. Bot memory 与共享 workspace memory；
9. 文本、图片、文件和语音输入；
10. 桌面通知和可选 Omarchy bar widget。

公共第三方插件 API 和专用移动 App 延后。MVP 默认只监听 localhost；MVP 后开发 Tauri 桌面客户端，通过安全配对远程连接 Omarchy 上的服务。远程连接不改变执行位置：Agent、Role session、Routine 和 ComputerBroker 始终运行在 Omarchy 机器上。

## 3. 领域模型

### 3.1 Bot

```ts
interface Bot {
  id: BotId;
  displayName: string;
  agentVersion: string;
  status: BotStatus;
  defaultCwd: string;
  defaultModel?: string;
  permissionPolicy: PermissionPolicy;
  createdAt: string;
  updatedAt: string;
}

interface BotRole {
  id: RoleId;
  botId: BotId;
  name: string;
  instructions: string;
  defaultCwd?: string;
  defaultModel?: string;
  permissionPolicy?: PermissionPolicy;
  memoryScopeId: string;
  createdAt: string;
  updatedAt: string;
}

interface RoleSession {
  roleId: RoleId;
  threadId: string;
  nativeSessionId: string;
}
```

每个 role/thread 使用独立原生 session。若官方接口安全支持多 session，同一个 Bot 的多个角色可以并行；否则由 Bot 级队列串行执行，但不能共享模型上下文冒充多角色。

Bot 状态：

```ts
type BotStatus =
  | "missing"
  | "unconfigured"
  | "checking"
  | "ready"
  | "working"
  | "waiting_for_input"
  | "waiting_for_computer"
  | "blocked"
  | "incompatible"
  | "offline";
```

只有通过 [agents-integration.md](./agents-integration.md) conformance 的 Agent 才能成为 `ready` Bot。

### 3.2 Thread 与 Channel

```ts
interface Thread {
  id: string;
  kind: "direct" | "channel";
  title: string;
  participants: ActorRef[];
  cwd?: string;
  createdAt: string;
  updatedAt: string;
}
```

- direct thread 只有用户和一个 Bot role；
- channel 可以包含同一个 Bot 的多个角色，也可以跨多个 Bot；
- channel 消息必须明确 Bot 和 role author；
- `@role` 指定角色，必要时使用 `@bot/role` 消除重名；无 mention 时由 coordinator 根据当前 owner 和 handoff 状态路由；
- Bot 不得自行无限互相 mention，coordinator 限制 hop、turn、时间和预算。

### 3.3 Task 与 Run

聊天消息不是唯一的工作状态：

```ts
type TaskStatus =
  | "queued"
  | "working"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "waiting_for_computer"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

interface Task {
  id: string;
  threadId: string;
  owner: ActorRef;
  assignedBy: "user" | ActorRef | "routine";
  title: string;
  status: TaskStatus;
  parentTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

interface Run {
  id: string;
  taskId: string;
  actor: ActorRef;
  nativeSessionId: string;
  state: TaskStatus;
  startedAt: string;
  finishedAt?: string;
}
```

完成必须表示工作已落到目标位置，不能把“模型停止输出”自动解释为任务完成。Bot 必须给出完成状态；高风险任务还要经过结果验证或用户确认。

### 3.4 Routine

```ts
interface Routine {
  id: string;
  name: string;
  actor: ActorRef;
  prompt: string;
  cwd?: string;
  schedule: string;
  enabled: boolean;
  missedRunPolicy: "skip" | "run_once";
  permissionPolicy: PermissionPolicy;
  lastRunAt?: string;
  nextRunAt?: string;
}
```

Routine 是核心能力，不是 reminder 的别名。systemd user service 保持 scheduler 运行，SQLite 负责持久化和去重。

## 4. 系统架构

```text
Local Browser (MVP)
  └── REST + WebSocket over localhost

Tauri Desktop Client (post-MVP)
  └── paired encrypted remote connection

Both connect to:
        omarchy-bot.service on Omarchy
              ├── BotRegistry
              ├── ThreadService
              ├── TaskCoordinator
              ├── RoutineScheduler
              ├── MemoryService
              ├── PermissionService
              ├── ComputerBroker
              ├── NotificationService
              ├── Persistence
              └── Agent adapters
                    ├── Pi SDK worker
                    ├── OMP SDK worker
                    ├── Codex app-server
                    ├── Claude Agent SDK
                    ├── Grok ACP + x.ai
                    ├── OpenCode SDK/server
                    ├── Gemini ACP
                    ├── Copilot SDK
                    └── Crush server

Shared Omarchy Computer
  ├── computer-use-linux MCP/tool bridge
  ├── desktop/windows/input
  ├── browser/accounts
  ├── terminal/files/projects
  └── notifications/screenshots

Optional Omarchy bar widget
  └── status.json + localhost API
```

Quickshell 不承载 Bot 或 scheduler，只显示 working/action-needed/unread 状态并打开 Web UI。

## 5. ComputerBroker

### 5.1 统一 Computer 工具

不能依赖每个 Agent 各自不同的 GUI 能力。网关通过同一套 computer-use-linux 工具向九个 Bot 提供：

- observe accessibility tree；
- screenshot；
- list/focus windows；
- click/type/key/scroll；
- 打开应用和 URL；
- 桌面通知。

优先以 MCP 暴露；没有完整 MCP host 能力的 Agent 由 adapter 注册等价 custom tools。相同操作必须使用相同 schema 和审批规则。

### 5.2 独占控制租约

同一时刻只能有一个执行主体发送桌面输入：

```ts
interface ComputerLease {
  holder: ActorRef | "human";
  runId?: string;
  acquiredAt: string;
  expiresAt: string;
}
```

- Bot 在 click/type/key 前申请 lease；
- screenshot/只读观察可以并发，但必须避免读取敏感窗口；
- 其他 Bot 进入 `waiting_for_computer` 队列；
- lease 有 heartbeat、最大时长和 finally 释放；
- 浏览器导航、登录和输入不得交错执行；
- Bot 崩溃或 adapter 断开立即撤销 lease。

文件、模型推理和独立终端任务可以并行。对同一项目的并发写入使用 task lock 或 Git worktree，而不是用桌面 lease 粗暴串行全部工作。

### 5.3 Take over / I’m done

用户点击 `Take over`：

1. 停止 Bot 的输入动作并等待当前原子操作结束；
2. lease 转给 `human`；
3. Run 进入 `waiting_for_input`；
4. 保持 Computer 画面和上下文。

用户点击 `I’m done`：

1. 记录可选说明；
2. 重新观察当前窗口和页面；
3. lease 释放给等待中的 Run；
4. Bot 从新状态继续，不能假设页面未变化。

本机用户的真实键鼠活动优先于 Bot。检测到人工操作时应暂停自动输入，不能争抢控制权。

## 6. 权限和 Action needed

公共策略：

```ts
type PermissionPolicy = "ask" | "trusted";
```

即使 `trusted`，以下操作仍默认进入 Action needed：

- 登录、验证码、密码和密钥；
- 购买、支付和提交订单；
- 对外发送消息、邮件或发布内容；
- 删除云端数据；
- 修改账号、权限和安全设置；
- 绕过浏览器或系统安全提示。

审批卡包含：Bot、Task、Computer 截图、目标应用、动作、影响范围和允许/拒绝选项。浏览器断连、超时、服务重启一律 fail closed。

Agent 原生 tool approval 与 ComputerBroker approval 是两层检查，任一拒绝都不能执行。

## 7. Memory、Skills 和 Teach a task

### 7.1 两级记忆

- role memory：属于一个具体 Bot role 的岗位经验、偏好和历史结论；
- Bot memory：同一 Agent Bot 下多个角色可共享的能力与经验；
- workspace memory：跨 Bot、跨角色共享的项目事实和 handoff 摘要。

原生 Agent session 是模型上下文权威来源；SQLite memory 是结构化长期索引。写入长期记忆必须有来源、时间、scope，并允许用户查看和删除。

### 7.2 Skills

优先使用 Agent 原生 skill discovery。共享 skill 存放在通用 `~/.agents/skills`，Agent 专用路径由 Omarchy 和各 CLI 自己处理。不要复制系统 skill 内容到数据库。

### 7.3 Teach a task

完整实现需要：

1. 用户开启演示；
2. ComputerBroker 记录语义操作、窗口、必要截图和用户说明；
3. 指定 Bot 将轨迹整理为 draft skill/routine；
4. 用户审阅路径范围、参数和敏感步骤；
5. 在沙盒/测试目标上回放验证；
6. 用户明确发布后才能定时运行。

首版可以先支持“从完成的 Run 保存为 Routine”，桌面演示学习在 ComputerBroker 稳定后加入，但数据模型从一开始保留 provenance。

## 8. Handoff 与多 Bot 协作

Handoff 是由网关协调的显式事件，不依赖某个 Agent 私有 subagent：

```ts
interface Handoff {
  id: string;
  from: ActorRef;
  to: ActorRef;
  taskId: string;
  summary: string;
  artifacts: ArtifactRef[];
  requestedAt: string;
  acceptedAt?: string;
}
```

流程：

1. 来源 Bot 给出目标、当前状态、产物和阻塞；
2. coordinator 检查目标 Bot ready、预算和 cwd 权限；
3. 目标 Bot 接受后创建 child task；
4. 结果回到原 channel；
5. 来源 Bot 或用户决定下一步。

handoff 可以发生在同一 Bot 的两个角色之间，也可以跨 Bot。系统可以按模板创建新角色，但不能由此创建第十种 Agent runtime；新角色仍归属于现有九个 Bot 之一。高权限或长期角色的自动创建需要用户确认。

## 9. 统一 Bot 体验

每个 ready Bot 都必须支持：

- direct chat 与 channel；
- 原生会话恢复；
- 流式文本和结构化工具卡；
- Agent 工具与 Omarchy Computer；
- 权限审批；
- abort；
- 文本、图片、文件；
- Task/Run 状态；
- Routine；
- memory；
- handoff；
- 通知和 Action needed。

其中 Routine、memory、handoff、Computer lease 由 omarchy-bot orchestration 提供，因此不能因为底层 Agent 没有同名原生功能而出现 Bot 差异。Agent 私有 reasoning、usage、plan、subagent 等仍通过 typed native event 保留。

## 10. Web UI

### 10.1 左侧栏

- 九个 Bot，可展开查看多个 role 及其 missing/ready/working/action-needed 状态；
- channels；
- 搜索；
- routines；
- 固定和未读。

Omarchy 默认 Agent 对应的 Bot 首次排在首位，但不自动授予更多权限。

### 10.2 主区域

- direct/channel 消息；
- task 状态与 owner；
- tool cards；
- handoff；
- artifacts；
- Action needed；
- native event 详情。

### 10.3 Computer 面板

- 当前画面和活动应用；
- 当前 lease holder；
- working/waiting/taken-over；
- Take over / I’m done；
- 最近动作和审批记录；
- 紧急停止全部 Bot 输入。

## 11. Tauri 与远程连接（MVP 后）

Tauri 是客户端外壳，不内嵌或复制 Agent runtime：

```text
Tauri client
  ├── bot/thread/task UI
  ├── Computer stream and remote input
  ├── local encrypted credential store
  └── REST + WebSocket client
          ↓
secure tunnel / paired TLS
          ↓
omarchy-bot.service on Omarchy
```

要求：

- local Web UI 与 Tauri 共用同一版本化 API 和事件协议；
- 首选 Tailscale/WireGuard 等私网通道；不默认把服务端口暴露到公网；
- 首次设备配对必须在 Omarchy 本机确认，生成可撤销的 device identity；
- token 短时有效并绑定设备，长期私钥存入 Tauri/系统安全凭据库；
- WebSocket 支持断线重连、event cursor 和幂等命令，断线期间不重放 click/type/approval；
- 远程 Computer 输入仍必须获取同一个独占 lease；
- 开启远程 Take over、读取敏感窗口、发送键盘输入时显示本机通知和可见状态；
- Omarchy 本机用户可随时 emergency stop、撤销设备和关闭远程访问；
- 远程断线立即释放或冻结 human lease，不能让 Bot 根据过期界面继续操作；
- Tauri 安装包、自动更新和发布产物必须签名。

远程可用性受 Omarchy 主机在线、未休眠以及网络通道可达限制；Tauri 不是云端执行器。

## 12. API

```text
GET    /api/bots
POST   /api/bots/:id/recheck
PATCH  /api/bots/:id

GET    /api/threads
POST   /api/threads
POST   /api/threads/:id/messages
GET    /api/threads/:id/messages

GET    /api/tasks
POST   /api/tasks/:id/abort
POST   /api/tasks/:id/handoff

GET    /api/routines
POST   /api/routines
PATCH  /api/routines/:id
POST   /api/routines/:id/run

POST   /api/permissions/:id/respond
POST   /api/computer/take-over
POST   /api/computer/release
POST   /api/computer/emergency-stop
POST   /api/attachments

GET    /api/events                 WebSocket upgrade
```

远程管理补充接口：

```text
POST   /api/devices/pair/start
POST   /api/devices/pair/confirm
GET    /api/devices
DELETE /api/devices/:id
POST   /api/remote/disable
```

远程客户端可以通过私网通道发起 pairing challenge，但最终确认和设备授权必须在 Omarchy 本机完成；challenge/response 不通过普通聊天 WebSocket 传输。

## 13. 存储

```text
~/.config/omarchy-bot/config.json
~/.local/share/omarchy-bot/
  db.sqlite
  attachments/
  artifacts/
  conformance/
  memory/
  routine-runs/
~/.local/state/omarchy-bot/
  status.json
  logs/
```

SQLite 保存 Bot 索引、threads、tasks、runs、routines、handoffs、审批和 memory metadata。Agent 原生 transcript 仍由各 Agent 管理。

## 14. 实施阶段

### M1：Pi Bot 和共享 Computer

- Bot/Thread/Task/Run 状态机；
- Pi SDK；
- ComputerBroker 与独占 lease；
- 权限、Action needed、Take over/I’m done；
- direct chat；
- conformance suite。

### M2：九 Bot 完整接入

- 其余八个官方富接口；
- 每个 ready Bot 通过相同聊天、Computer、审批、取消和附件测试；
- 不通过者保持 unavailable，禁止弱路径降级。

### M3：持续工作

- RoutineScheduler；
- Bot/workspace memory；
- 通知；
- missed-run policy；
- 从成功 Run 保存为 Routine。

### M4：Bot 团队

- channel；
- mention/router；
- handoff；
- child task；
- hop/预算/循环限制。

### M5：Omarchy 与演示学习

- bar widget；
- Computer activity 状态；
- Teach a task；
- 响应式本地 Web UI。

### M6（MVP 后）：Tauri Remote

- Tauri desktop shell；
- device pairing/revocation；
- Tailscale/WireGuard 优先的远程 discovery；
- REST/WebSocket reconnect 与 event cursor；
- 远程 Computer stream、Take over 和本机 emergency stop；
- 签名安装包和自动更新。

## 15. 发布验收

- `BotId === AgentId` 的 runtime 对应关系不可绕过，同时每个 Bot 可拥有多个 `RoleId`；
- 九个目标 Bot 的最低支持版本都有完整认证记录；
- 所有 ready Bot 能使用同一 Computer tool schema；
- 任意时刻最多一个 Bot role 或用户持有输入 lease；
- Take over 后 Bot 不再发送输入；
- `ask` 下没有未经批准的副作用；
- 敏感 Computer 操作即使在 `trusted` 下也进入 Action needed；
- handoff 不产生无限循环；
- Routine 不重复执行，重启后状态可恢复；
- Agent 升级导致能力漂移时自动标为 incompatible；
- 子进程、socket、SSE、Computer lease 和临时附件无泄漏。

Tauri Remote 另需通过：

- 未配对设备无法读取任何 Bot、消息或 Computer 数据；
- 撤销设备后现有 REST/WebSocket 连接立即失效；
- 网络重连不重复发送消息、审批或桌面输入；
- 远程 Take over 在 Omarchy 本机可见并可立即终止；
- 服务未显式启用 remote 时只监听 localhost。
