# Omarchy Agent 集成调查

> 2026-09-01，本机 Omarchy 4.0.2。本文只记录 Omarchy 自身提供的能力；各 Agent 的程序化协议见 [agents-integration.md](./agents-integration.md)。

## 1. Omarchy 实际提供什么

Omarchy 没有统一 Agent API。它提供的是：

1. 九个 CLI 的安装与默认选择；
2. 一个交互式终端启动器；
3. 默认 Agent prompt/crash 辅助命令；
4. 官方 Omarchy 与 crash diagnosis skills；
5. 与聊天无关的订阅用量 bar 插件。

### 1.1 默认 Agent 选择器

`omarchy default agent` 识别：

```text
pi, omp, opencode, claude, codex, grok, gemini, copilot, crush
```

实现位于 `/usr/bin/omarchy-default-agent`：

- 通过 `mise use -g <package>` 安装/启用 CLI；
- 将用户选择写入 `~/.config/omarchy/defaults/agent`；
- 选择后立即启动 Agent。

**Omarchy 出厂不选择任何默认 Agent。** 本机当前文件内容是 `pi`，这只表示本机用户选择了 Pi，不表示 Pi 是发行版默认值。

程序可以用以下只读命令发现用户选择：

```bash
omarchy default agent
```

不要通过解析配置文件复制 Omarchy 的选择逻辑，也不要调用带名称的 `omarchy default agent <name>` 做静默安装，因为该命令具有安装并启动 TUI 的副作用。

### 1.2 交互式启动器不是网关协议

`/usr/bin/omarchy-agent` 根据选择拼出交互式命令，再通过统一 app-id 启动终端：

```text
org.omarchy.agent
```

它还会对多数 Agent 加入 unattended/auto-approval 参数，例如 `--yolo`、`--allow-all`、`bypassPermissions` 或 `--approve-for-me`。

因此：

- `omarchy agent` 适合用户从菜单或快捷键打开 TUI；
- omarchy-bot 只能用它发现产品行为，**不能把它当作聊天 adapter**；
- 网关必须直接启动各 Agent 的官方 RPC/ACP/SDK/server 接口；
- 网关不得继承这些自动批准参数。

相关命令：

```bash
omarchy agent
omarchy agent --inline
omarchy agent prompt "Review this project"
omarchy agent crash <pid>
```

其中 `agent prompt` 仍然主要是带初始 prompt 的交互启动，并非统一 headless API。

## 2. Omarchy skills

官方 skills 位于：

```text
/usr/share/omarchy/default/agents/skills/omarchy/
/usr/share/omarchy/default/agents/skills/diagnose-crash/
```

安装/迁移会链接到通用和部分 Agent 专用目录：

```text
~/.agents/skills/
~/.claude/skills/
~/.codex/skills/
~/.pi/agent/skills/
```

这属于 Agent Skills 资源发现，不是协议层。omarchy-bot 应让 Agent 使用其原生 discovery，不复制 skill 内容。

## 3. `omarchy.agents` bar 插件

该插件只显示订阅 usage/limits。数据来自：

```text
~/.local/state/omarchy/agents/usage/*.json
```

当前 Omarchy 自带 collector 是 Claude、Codex、Fireworks。它与：

- 默认 Agent 选择；
- 已安装的九个 CLI；
- 聊天会话；
- Agent adapter registry

都不是同一个概念。

可复用的是它的**解耦模式**：后台进程原子写轻量状态文件，Quickshell 插件监听并渲染。omarchy-bot 的可选 bar widget 可以同样读取：

```text
~/.local/state/omarchy-bot/status.json
```

## 4. Omarchy Shell 插件边界

Quickshell 插件适合：

- bar widget；
- panel/overlay；
- 通知与轻量控制入口。

Bun daemon、Agent 子进程、数据库和 scheduler 应运行在独立 systemd user service 中，不能塞进 Quickshell 进程。

建议形态：

```text
omarchy-bot.service
  ├── Agent adapters
  ├── HTTP/WebSocket API
  ├── persistence
  └── scheduler

Omarchy shell plugin（可选）
  ├── 监听 status.json
  └── 打开 Web UI / 显示未读状态
```

一个 `bar-widget` 本身可以带 popup panel；没有必要仅为了弹出面板同时声明独立 `panel` kind。

## 5. Hooks、通知和定时任务

可以复用：

- `omarchy hook install <type> <file>`；
- `~/.config/omarchy/hooks/<name>.d/`；
- `omarchy notification`/`notify-send`；
- systemd user service/timer；
- `omarchy capture ...`。

`omarchy reminder` 是提醒功能，不是通用任务调度 API。Automations 应由 omarchy-bot 自己持久化和执行，Omarchy hook 仅作为可选触发源。

## 6. 对项目的直接约束

1. 固定一个 Agent runtime 对应一个长期 Bot，最多九个 Bot；每个 Bot 可以创建多个持久角色，角色不新增 adapter 类型；
2. 启动时读取 `omarchy default agent`，将对应 Bot 排在首位；
3. 允许用户启用其他通过兼容认证的已安装 Agent Bot；
4. 不调用 `omarchy agent` 承载 Web 对话；
5. 当前 Omarchy 桌面、浏览器、终端和文件系统就是九个 Bot 共享的 Computer；
6. 所有 GUI 输入通过统一 ComputerBroker 独占租约执行，不能让多个 Agent 同时争抢桌面；
7. 不修改 `/usr/share/omarchy/`；
8. Quickshell 仅做可选 UI，不承载 Bot、scheduler 或 adapter；
9. MVP 远程访问默认关闭，服务只监听 localhost；MVP 后的 Tauri 客户端通过本机确认的设备配对和加密私网通道连接，不改变 Bot 在 Omarchy 上执行的事实；
10. Agent 的统一接入和权限规则以 [agents-integration.md](./agents-integration.md) 为准。

## 7. 本机一手来源

- `/usr/bin/omarchy-default-agent`
- `/usr/bin/omarchy-agent`
- `/usr/bin/omarchy-agent-prompt`
- `/usr/bin/omarchy-agent-crash`
- `/usr/share/omarchy/install/user/first-run/setup-agent.hook`
- `/usr/share/omarchy/shell/plugins/agents/README.md`
- `/usr/share/omarchy/shell/plugins/agents/manifest.json`
