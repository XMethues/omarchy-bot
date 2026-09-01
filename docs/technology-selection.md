# 运行时、前端与 UI 技术选型

> 研究快照：2026-09-01。目标是完整接入九个 Agent，并把 omarchy-bot 作为一个 Omarchy Shell 插件交付。

## 1. 结论

```text
用户安装的产品：Omarchy Shell plugin
Shell UI：       QML / Qt Quick
主 daemon：      TypeScript on Bun
Agent workers：  TypeScript on Bun
完整 Web UI：    React 19 + Vite
UI design system：Astryx（跟随 npm latest，经内部 UI adapter 使用）
应用样式：       Tailwind CSS 4 + Astryx token bridge
前端基础设施：   TanStack Router + Query + Virtual + Form
持久化：         SQLite（仅 daemon 写入）
未来桌面端：     同一 React UI + Tauri；Rust 只负责薄 host
```

不再为 daemon 和普通 worker 同时携带 Node 与 Bun。Bun 是统一 TypeScript runtime；Agent 自带的 Codex/Grok/Gemini/Crush/Copilot 等 native/app-server 进程仍是独立上游 runtime，不属于 omarchy-bot 的 JavaScript runtime。

## 2. Bun 统一运行时

### 2.1 实测与上游依据

在本机 Bun 1.4.0 上对研究时版本做了无模型调用 smoke test：

| SDK | 结果 | 结论/限制 |
|---|---|---|
| Pi 0.84.4 | import 成功；`createAgentSession()` + in-memory session 创建/销毁成功 | Pi 自身也用 Bun 构建官方 standalone binary；仍需完整 conformance |
| OMP 18.0.11 | 官方 SDK 明确要求 Bun 1.3.14+ | 原生主路径 |
| Claude Agent SDK 0.3.252 | import 成功；上游 changelog 明确支持 `bun build --compile`，仓库也用 `bun:test` | 真正 prompt/session/hook 测试进入付费 conformance |
| Copilot SDK 1.0.11 | import 成功；显式传入 platform executable 后，client start、`getStatus()`、stop 成功，protocol version 3 | 不使用默认 runtime discovery；不使用 experimental in-process FFI |

Copilot 有一个必须写进 adapter 的细节：在 Bun 下直接使用默认 `new CopilotClient()`，本机 smoke test 无法从 SDK 包位置解析 hoisted `@github/copilot-linux-x64`。worker 必须自行解析已验证的 platform executable，并显式配置：

```ts
new CopilotClient({
  connection: RuntimeConnection.forStdio({ path: resolvedCopilotExecutable }),
});
```

Copilot SDK 源码本身检查 `process.versions.bun`，且会对 JavaScript wrapper 选择 Node；显式指向 native platform executable 时则直接 spawn executable。omarchy-bot 只采用后者，所以不需要为 Copilot worker 常驻或捆绑 Node。

### 2.2 统一后的进程

```text
Bun daemon
  ├── Bun SDK worker: pi
  ├── Bun SDK worker: omp
  ├── Bun SDK worker: claude
  ├── Bun SDK worker: opencode
  ├── Bun SDK worker: copilot → native Copilot runtime
  ├── Bun protocol worker: codex → codex app-server
  ├── Bun protocol worker: grok → ACP + x.ai
  ├── Bun protocol worker: gemini → ACP
  └── Bun protocol worker: crush → HTTP/SSE server
```

统一 runtime 不代表取消 worker 隔离。worker 仍用于隔离 SDK 依赖、崩溃、session 和版本升级。

### 2.3 支持政策

- Bun 兼容性是每个锁定 Agent 版本的 release gate，而不是“能 import 就算支持”。
- conformance 至少覆盖 session 创建/恢复、stream、tool、approval、abort、attachments、history 和 dispose。
- 上游升级若破坏 Bun 路径，该 Bot 进入 `incompatible`；不能静默降级到 headless、PTY 或低能力协议。
- production release 固定 Bun 版本，systemd unit 使用绝对路径，不依赖用户交互式 shell 的 `mise` shim。
- daemon/workers 按需启动；不要因为九个 Bot 而常驻九个 worker。
- 开发与构建也使用 Bun workspace、`bun.lock`、`bun test`；Vite/TanStack/Astryx 均可由 Bun 驱动。
- user install 交付预构建产物和固定 Bun runtime，不能在 QML 中动态执行未经验证的包安装。

## 3. “Omarchy 插件”与后台服务

用户安装的是 Omarchy 插件，但插件只是产品入口：

```text
~/.config/omarchy/plugins/<id>/
  manifest.json
  BarWidget.qml / Panel.qml / Service.qml
  setup/launcher metadata

systemd --user
  omarchy-bot.service
    Bun daemon + workers + SQLite + localhost API
```

Omarchy 官方插件安装器只 clone 文件、验证 manifest 和切换 enabled 状态；它不运行 install hooks、依赖安装或 sudo。安全的首次安装流程是：

1. `omarchy plugin add ...` 安装 QML 插件；
2. 插件检测 daemon/service；
3. 未安装时显示 Setup、版本、来源与权限；
4. 用户明确确认后，用户级 setup 校验并安装 release，注册 `systemd --user` service；
5. QML 只读取摘要状态、显示 Action needed/通知并打开完整 Web UI。

不要把 daemon 作为 QML `Process` 的长期子进程。`omarchy-shell` 重载不应终止 Routine、Agent Run 或 SQLite writer。

## 4. React 与 Solid

### 4.1 结论

MVP 使用 **React 19**。Solid 2 GA 后可以做 spike，但当前不选。

研究时：

- React 19 是 stable；
- Solid npm `latest` 仍为 1.9.x，Solid 2 位于 RC channel；
- Stable TanStack React Router/Query/Form/Virtual 已覆盖 React 19；
- Solid 2 要联动 TanStack Solid Router 2 RC、Solid Query 6 RC；
- stable Solid Router/Query/Virtual 的 peer range 仍主要指向 Solid 1。

### 4.2 本产品对比

| 维度 | React 19 | Solid 2 RC |
|---|---|---|
| 稳定性 | stable | 多包联动 RC |
| streaming 更新 | 需要选择性订阅和批量投影，足够可控 | fine-grained reactivity 更自然 |
| TanStack | stable adapter 完整 | Solid 2 adapter 仍在迁移 |
| Agent/chat UI | Astryx 等完整 React design system 可用 | 选择较少 |
| 无障碍和复杂交互 | 生态最强 | primitives 可用但规模较小 |
| Tauri 共享 | 支持 | 支持 |

React 性能约束：

- token delta 按 animation frame/短时间窗合并；
- 每个 turn/message/status 独立选择性订阅；
- WebSocket 先进入 framework-neutral projection store；
- 长 transcript 使用 TanStack Virtual；
- Computer frame 直接更新 canvas/video，不进入 React state tree。

## 5. UI framework：Astryx

### 5.1 Astryx 调查

Astryx 是 Meta 开源的 MIT React 19 + StyleX design system。研究版本为 `@astryxdesign/core` 0.5.2，官方仍标记 **Beta**。它声称源于 Meta 内部八年使用、覆盖 13,000+ apps；这说明交互设计经过真实使用，但不等于开源 npm API 已稳定。

它对 omarchy-bot 的匹配度很高：

- 150/170+ accessible components；
- `AppShell`、SideNav、BottomSheet、Dialog/AlertDialog、Toast、Table、CommandPalette；
- 专门的 `ChatLayout`、`ChatMessageList`、`ChatMessage`、`ChatComposer`、`ChatToolCalls`；
- streaming scroll、`aria-busy`、IME、reduced-motion 等细节已有实现；
- Markdown、CodeBlock、Citation、attachment/file input；
- theme、dark mode、i18n、RTL；
- Vite 直接使用预构建 JS/CSS，不要求 StyleX build plugin；
- CSS variables 可主题化，也能和 Tailwind 共存；
- CLI 提供 agent-readable docs、templates、codemods 和 `swizzle` 源码导出。

风险：

- npm 仍是 0.x Beta，changelog 显示 API 和实现仍快速变化；
- 引入 StyleX runtime 与 Astryx CSS layer；
- `ChatMessageList` 本身不是 virtualizer，长会话仍要由我们组合 TanStack Virtual；
- Agent 原生 reasoning、approval、artifact、computer lease 没有现成统一组件，仍需产品组件；
- 不应把 Agent 输出安全完全委托给任一 UI 库的 Markdown 默认配置。

### 5.2 采用与升级政策

只采用 **Astryx**。shadcn、AI Elements、Radix 和 React Aria component suites 不进入依赖树，也不从它们的 registry 复制组件。避免两套 primitive、focus/portal、token 和升级模型并存。

omarchy-bot 首屏就是 AI chat + tool calls + app shell，Astryx 已经提供最接近的可访问组件和模板。通过内部语义层隔离上游 API，但不冻结上游版本：

```text
apps/web/features/*
        ↓ only import
packages/ui                 # omarchy-bot-owned semantic components
        ↓
@astryxdesign/*             # follow npm latest channel
```

规则：

1. `package.json` 跟随 Astryx npm `latest` channel，不写精确版本；提交 `bun.lock` 保证每个已构建 commit 可复现；
2. Renovate/定时 CI 发现新版本后立即整体更新 `core`、theme、CLI 和 StyleX 兼容组，不等待人工季度升级；
3. feature code 禁止直接 import Astryx；
4. `packages/ui` 暴露 `BotChat`, `ToolCall`, `ApprovalDialog`, `TaskStatus`, `ComputerSurface` 等产品语义组件；
5. 使用 neutral theme + Omarchy token overrides，不直接复制 Meta 产品外观；
6. 产品专属布局使用 Tailwind CSS 4 和 Astryx 官方 `tailwind-theme.css` token bridge，不再引入另一套颜色/间距 token；
7. 每次 Astryx 更新必须通过 visual regression、keyboard、axe、screen-reader smoke 和 UI conformance；失败时修复 adapter 后前进，不能静默发布损坏版本；
8. 长 transcript 自己接 TanStack Virtual；
9. 对 Markdown 使用明确 allowlist/sanitization，并测试 streaming partial syntax；
10. Astryx 缺失能力在 `packages/ui` 中使用 React/DOM 和 Astryx tokens 自行实现，不引入或复制 shadcn。

如果 Astryx 出现无法修复的架构阻塞，必须另开 design decision **整体替换** design system；不允许在同一产品中逐步混用两套系统。

## 6. TanStack 生态取舍

| 产品 | 是否采用 | 用途与边界 |
|---|---|---|
| TanStack Router | 是 | 类型安全路由和 search params，Web/Tauri 共用路由树 |
| TanStack Query | 是 | REST snapshot、point read、command mutation、重连 reconciliation |
| TanStack Virtual | 是 | 长 transcript、事件日志、Task/Run 列表 |
| TanStack Form | 是 | Role、Routine、权限策略和设备配置 |
| TanStack Table | 按需 | 管理型表格出现后再引入；Astryx 负责视觉，TanStack 负责 headless data model |
| TanStack Start | 否 | 已有 Bun daemon/API，不需要第二个 full-stack server、SSR 或 server function |
| TanStack DB | MVP 否 | 当前 Beta；daemon SQLite 才是权威状态 |
| TanStack Store | 暂不绑定 | 先定义 framework-neutral event projection contract |

状态分工：

```text
TanStack Query
  REST snapshots, point reads, command mutations, reconnect reconciliation

EventProjectionStore
  ordered WebSocket events, cursor, optimistic markers,
  task/run/computer/approval live projections

React local state
  drafts, open panels, focus, temporary selection
```

TanStack Query 不能代替事件流。不能把每个 token delta 变成 query refetch。

## 7. 推荐前端栈

```text
React 19
Vite SPA（由 Bun 驱动）
Astryx latest-tracked + internal packages/ui adapter
Tailwind CSS 4 + Astryx token bridge
TanStack Router
TanStack Query
TanStack Virtual
TanStack Form
Vitest/Bun test + Testing Library
Playwright（浏览器和未来 Tauri E2E）
```

不采用 TanStack Start。daemon 托管生产静态资源和 `/api/*`；开发时 Vite 代理 localhost daemon。未来 Tauri 加载相同构建产物并替换 transport/credential host。

## 8. 官方依据

- Omarchy Shell plugin：<https://github.com/omacom/omarchy/tree/quattro/shell>
- Pi SDK：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md>
- OMP SDK：<https://github.com/can1357/oh-my-pi/blob/main/docs/sdk.md>
- Claude Agent SDK：<https://github.com/anthropics/claude-agent-sdk-typescript>
- GitHub Copilot SDK：<https://github.com/github/copilot-sdk>
- React：<https://react.dev/>
- Solid：<https://github.com/solidjs/solid>
- Astryx：<https://astryx.atmeta.com/>、<https://github.com/facebook/astryx>
- TanStack Router / Start：<https://tanstack.com/router>
- TanStack Query：<https://tanstack.com/query>
- TanStack Form：<https://tanstack.com/form>
- TanStack Virtual：<https://tanstack.com/virtual>
- TanStack DB：<https://tanstack.com/db>
