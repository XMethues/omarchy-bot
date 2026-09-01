# 插件运行时决策

## 当前决策：延期

插件系统不是首版九个多角色 Bot、共享 Computer、Routine 和 handoff 的必要条件。公共插件 API 会带来生命周期、权限、兼容和供应链承诺，不应与核心产品和九个 Agent adapter 同时开发。

因此：

- M1–M4 不引入 Cordis，也不实现对外 mini-cordis；
- core 内部只使用普通 TypeScript 接口和显式 service composition；
- 等统一 Agent 契约稳定且社区确有扩展需求后再做决策。

## 为什么不直接依赖 Cordis

调查得到的有效结论仍然成立：

- `@cordisjs/core` 稳定 npm 通道与 4.x 开发线存在版本落差；
- DeepSeek Harness 采用 vendor 并维护自己的补丁，而不是把它当作无维护成本依赖；
- omarchy-bot 目前只需要少量 DI、生命周期和 disposer 语义，没必要提前接入完整 loader/HMR 体系。

在完成实现和生命周期测试前，不对自研运行时给出代码量或工期承诺。

## 内部扩展点

首版可以保留普通接口，不承诺第三方兼容：

```ts
interface AgentAdapterFactory {
  id: string;
  create(ctx: AdapterContext): AgentAdapter;
}

interface Lifecycle {
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

路由、事件监听器和子进程都必须显式返回 disposer，并由 service owner 逆序清理。这个约束不需要插件框架。

## 重新评估条件

只有同时满足以下条件才设计公共插件 API：

1. 九个 Bot 的 Agent 与 Computer conformance 长期稳定；
2. 至少存在三个不能通过配置或内置模块解决的真实第三方扩展需求；
3. 有权限 manifest、安装来源、升级/回滚和故障隔离方案；
4. 有能力维护 semver 和插件作者文档。

届时重新比较：

- 小型自研 runtime；
- vendor Cordis；
- 进程隔离插件 host；
- 不提供代码插件，只提供声明式 webhook/MCP/skill 扩展。

安全上优先考虑声明式或进程隔离方案，不能把 manifest 权限声明误当作真正的运行时沙箱。
