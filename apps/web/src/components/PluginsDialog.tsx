import { useEffect, useState, type FormEvent, type JSX, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as stylex from "@stylexjs/stylex";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { Item } from "@astryxdesign/core/Item";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import { SKILL_CATALOG_PAGE_SIZE, type InstalledSkillDto, type McpConnectionDto, type PluginAccountDto, type PluginStateDto, type SaveMcpBody } from "@omarchy-bot/protocol";
import { api, apiErrorMessage } from "../lib/api.ts";
import { BottomSheetWithReturnFocus } from "./BottomSheetWithReturnFocus.tsx";

const styles = stylex.create({
  root: { minWidth: 0, width: "100%", maxWidth: 1120, overflowWrap: "anywhere" },
  row: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--spacing-2)", minWidth: 0 },
  cards: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: "var(--spacing-2)" },
  card: { padding: "var(--spacing-3)", borderWidth: 1, borderStyle: "solid", borderColor: "var(--color-border)", borderRadius: "var(--radius-container)", minWidth: 0 },
  code: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", minWidth: 0, fontSize: "0.85rem" },
  link: { color: "var(--color-text-accent)", textDecoration: "underline" },
  document: { maxHeight: "45vh", overflow: "auto", minWidth: 0 },
  skillGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: "var(--spacing-4)", minWidth: 0 },
  skillCard: { minWidth: 0, display: "flex", flexDirection: "column" },
  skillBody: { display: "flex", flexDirection: "column", gap: "var(--spacing-2)", flexGrow: 1, minWidth: 0 },
  skillActions: { marginTop: "auto", paddingTop: "var(--spacing-3)", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--spacing-2)" },
  skillDescription: { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" },
  search: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "var(--spacing-3)", alignItems: "end" },
  pager: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "var(--spacing-2)" },
  skeleton: { height: 14, width: "75%", backgroundColor: "var(--color-border)", borderRadius: "var(--radius-container)", marginBottom: "var(--spacing-3)" },
});

type Section = "services" | "mcp" | "skills";

function McpEditor({ initial, busy, onSave, onCancel }: {
  initial?: McpConnectionDto; busy: boolean; onSave(body: SaveMcpBody): Promise<void>; onCancel(): void;
}): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [transport, setTransport] = useState<"stdio" | "http">(initial?.transport.type ?? "http");
  const [url, setUrl] = useState(initial?.transport.type === "http" ? initial.transport.url : "");
  const [command, setCommand] = useState(initial?.transport.type === "stdio" ? initial.transport.command : "");
  const [args, setArgs] = useState(initial?.transport.type === "stdio" ? JSON.stringify(initial.transport.args, null, 2) : "[]");
  const [secrets, setSecrets] = useState("");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(undefined);
    try {
      let values: Record<string, string> | undefined;
      if (secrets.trim()) {
        const parsed: unknown = JSON.parse(secrets);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) throw new Error("Credentials must be a JSON object with string values.");
        values = parsed as Record<string, string>;
      }
      if (!name.trim()) throw new Error("Enter a connection name.");
      if (transport === "http") {
        const endpoint = new URL(url);
        if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("Use an HTTP or HTTPS MCP endpoint.");
        await onSave({ name: name.trim(), enabled, transport: { type: "http", url: endpoint.href, ...(values === undefined ? {} : { headers: values }) } });
      } else {
        const arguments_: unknown = JSON.parse(args);
        if (!Array.isArray(arguments_) || arguments_.some((value) => typeof value !== "string")) throw new Error("Arguments must be a JSON array of strings.");
        if (!command.trim()) throw new Error("Enter the MCP server executable.");
        await onSave({ name: name.trim(), enabled, transport: { type: "stdio", command: command.trim(), args: arguments_, ...(values === undefined ? {} : { env: values }) } });
      }
    } catch (failure) {
      setError(failure instanceof SyntaxError ? "Enter valid JSON for arguments and credentials." : apiErrorMessage(failure, "Connection could not be saved."));
    }
  };
  const savedKeys = initial?.transport.type === "http" ? initial.transport.headerKeys : initial?.transport.envKeys ?? [];
  return <form onSubmit={(event) => void submit(event)}>
    <VStack gap={3}>
      <Heading level={3}>{initial ? "Edit MCP connection" : "Add MCP connection"}</Heading>
      {error ? <Banner status="error" title="Connection not saved" description={error} /> : null}
      <TextInput label="Connection name" value={name} onChange={setName} width="100%" isRequired isDisabled={busy} />
      <div {...stylex.props(styles.row)} aria-label="MCP transport">
        <Button label="HTTP" variant={transport === "http" ? "primary" : "secondary"} aria-pressed={transport === "http"} isDisabled={busy} onClick={() => { setTransport("http"); setSecrets(""); }} />
        <Button label="stdio" variant={transport === "stdio" ? "primary" : "secondary"} aria-pressed={transport === "stdio"} isDisabled={busy} onClick={() => { setTransport("stdio"); setSecrets(""); }} />
      </div>
      {transport === "http" ? <TextInput label="MCP endpoint URL" value={url} onChange={setUrl} placeholder="https://…/mcp" width="100%" isRequired isDisabled={busy} /> : <>
        <TextInput label="Executable" value={command} onChange={setCommand} placeholder="An installed executable or absolute path" width="100%" isRequired isDisabled={busy} />
        <TextArea label="Arguments (JSON array)" value={args} onChange={setArgs} width="100%" isDisabled={busy} />
        <Text color="secondary">Commands and arguments are displayed. Put credentials in environment variables, not arguments. Installing a server package is separate from adding its connection.</Text>
      </>}
      <TextArea label={transport === "http" ? "Headers (write-only JSON object)" : "Environment (write-only JSON object)"} value={secrets} onChange={setSecrets} width="100%" isDisabled={busy} />
      <Text color="secondary">{savedKeys.length ? `Saved keys: ${savedKeys.join(", ")}. ` : ""}Leave blank to keep saved values. Enter {"{}"} to clear them. Saved values are never returned to this client.</Text>
      <Switch label="Enable for every Bot" value={enabled} onChange={setEnabled} isDisabled={busy} />
      <div {...stylex.props(styles.row)}><Button label={busy ? "Saving…" : "Save"} type="submit" isDisabled={busy} /><Button label="Cancel" variant="ghost" isDisabled={busy} onClick={onCancel} /></div>
    </VStack>
  </form>;
}

function AccountLabel({ account, busy, onSave }: { account: PluginAccountDto; busy: boolean; onSave(label: string): void }): JSX.Element {
  const [label, setLabel] = useState(account.label);
  return <form onSubmit={(event) => { event.preventDefault(); if (label.trim()) onSave(label.trim()); }}>
    <VStack gap={1}>
      <TextInput label="Account label" value={label} onChange={setLabel} width="100%" isDisabled={busy} />
      <Button label="Save label" type="submit" variant="secondary" size="sm" isDisabled={busy || !label.trim() || label.trim() === account.label} />
    </VStack>
  </form>;
}


export function PluginsDialog({ open, onClose, mobileReturnFocusRef }: {
  open: boolean;
  onClose: () => void;
  mobileReturnFocusRef: RefObject<HTMLElement | null>;
}): JSX.Element {
  const { isMobile } = useAppShellMobile();
  const onOpenChange = (nextOpen: boolean): void => { if (!nextOpen) onClose(); };
  const content = (
    <Layout
      height="fill"
      padding={6}
      defaultHasDividers
      header={<DialogHeader title="Plugins" onOpenChange={onOpenChange} />}
      content={
        <LayoutContent isScrollable label="Global plugins" data-testid="plugins-dialog">
          <PluginsContent />
        </LayoutContent>
      }
    />
  );
  return isMobile ? (
    <BottomSheetWithReturnFocus
      label="Plugins"
      returnFocusRef={mobileReturnFocusRef}
      isOpen={open}
      onOpenChange={onOpenChange}
      height="tall"
    >
      {content}
    </BottomSheetWithReturnFocus>
  ) : (
    <Dialog
      isOpen={open}
      onOpenChange={onOpenChange}
      width={1120}
      maxHeight="90dvh"
      padding={6}
      style={{ height: "min(52rem, 90dvh)", overflow: "hidden" }}
    >
      {content}
    </Dialog>
  );
}

function PluginsContent(): JSX.Element {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ["plugins"], queryFn: () => api.plugins(), refetchInterval: 10_000, retry: false });
  const [section, setSection] = useState<Section>("services");
  const [selectedService, setSelectedService] = useState<string>();
  const [editing, setEditing] = useState<McpConnectionDto | "new">();
  const [confirm, setConfirm] = useState<{ kind: "mcp" | "skill" | "account"; id: string; name: string }>();
  const [notice, setNotice] = useState("");
  const change = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => {
      await action();
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["plugins"] }), queryClient.invalidateQueries({ queryKey: ["plugin-commands"] })]);
    },
  });
  const run = async (action: () => Promise<unknown>, message = "Saved. Changes apply on the next turn."): Promise<void> => {
    setNotice("");
    await change.mutateAsync(action);
    setNotice(message);
  };
  const execute = (action: () => Promise<unknown>, message?: string): void => { void run(action, message).catch(() => undefined); };
  const provider = state.data?.providers.find((entry) => entry.services.some((service) => service.id === selectedService));
  const service = provider?.services.find((entry) => entry.id === selectedService);
  const busy = change.isPending;

  useEffect(() => { setConfirm(undefined); setNotice(""); change.reset(); }, [section]);

  const authorize = (providerId: PluginAccountDto["providerId"], accountId?: string): void => {
    // Open synchronously so browser popup protection does not discard the consent tab.
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    execute(async () => {
      try {
        const result = await api.authorizePlugin({ providerId, returnUrl: window.location.origin, ...(accountId === undefined ? {} : { accountId }) });
        if (popup) popup.location.replace(result.url);
        else window.location.assign(result.url);
      } catch (error) { popup?.close(); throw error; }
    }, "Complete authorization in the provider tab, then return here.");
  };

  if (state.isPending) return <Text>Loading global plugins…</Text>;
  if (state.isError || !state.data) return <VStack gap={2}><Banner status="error" title="Plugins could not load" description={apiErrorMessage(state.error, "Daemon is unavailable.")} /><Button label="Retry" onClick={() => void state.refetch()} /></VStack>;
  const data = state.data;

  return <VStack gap={4} {...stylex.props(styles.root)} data-testid="plugins-section">
    <Text color="secondary">Plugins are shared across Bots. Changes apply on their next turn.</Text>
    <div {...stylex.props(styles.row)} aria-label="Plugin sections">
      {(["services", "mcp", "skills"] as const).map((id) => <Button key={id} label={id === "mcp" ? "MCP" : id[0]!.toUpperCase() + id.slice(1)} variant={section === id ? "primary" : "secondary"} size="sm" aria-pressed={section === id} onClick={() => setSection(id)} />)}
    </div>
    {change.isError ? <Banner status="error" title="Change not completed" description={apiErrorMessage(change.error, "Plugin operation failed.")} /> : null}
    {busy ? <Text role="status">Applying change…</Text> : notice ? <Text role="status">{notice}</Text> : null}
    {data.cloudError ? <Banner status="warning" title="Online services are temporarily unavailable" description="Your installed Skills and local connections are unchanged. Please try again later." /> : null}
    {confirm ? <VStack gap={2} {...stylex.props(styles.card)}>
      <Heading level={2}>{confirm.kind === "account" ? "Disconnect" : "Remove"} {confirm.name}?</Heading>
      <Text>{confirm.kind === "account" ? "Remove the locally stored grant. Current turns retain their snapshot until they finish. For immediate revocation, remove the application’s access at the provider. Other accounts are unaffected." : "This stops making it available to new turns. Current turns finish using their existing snapshot."}</Text>
      <div {...stylex.props(styles.row)}><Button label="Confirm removal" isDisabled={busy} onClick={() => execute(async () => {
        if (confirm.kind === "mcp") await api.deleteMcp(confirm.id);
        else if (confirm.kind === "skill") await api.removeSkill(confirm.id);
        else await api.disconnectPluginAccount(confirm.id);
        setConfirm(undefined);
      })} /><Button label="Cancel" variant="ghost" isDisabled={busy} onClick={() => setConfirm(undefined)} /></div>
    </VStack> : null}

    {section === "services" ? <VStack gap={3}>
      {provider && service ? <>
        <Button label="All services" variant="ghost" onClick={() => setSelectedService(undefined)} />
        <Heading level={2}>{service.name}</Heading><Text>{service.description}</Text>
        <Text color="secondary">These accounts belong to the shared {provider.name} account pool. The Agent receives each account’s label and identity; it chooses the account for the task.</Text>
        {provider.setupReason ? <Banner status="warning" title="Connection unavailable" description="This service is not available yet. Please check back later." /> : null}
        {data.accounts.filter((account) => account.providerId === provider.id).map((account) => <VStack key={account.id} gap={2} {...stylex.props(styles.card)}>
          <Heading level={3}>{account.label}</Heading><Text color="secondary">{account.identity}</Text><Text color="secondary">{account.id}</Text>
          <Switch label={`Use for ${service.name}`} value={account.enabledServices.includes(service.id)} isDisabled={busy} onChange={(enabled) => execute(() => api.setPluginService(account.id, service.id, enabled))} />
          {account.error ? <Banner status={account.status === "reauthorize" ? "error" : "warning"} title={account.status === "reauthorize" ? "Reconnect required" : "Connection needs attention"} description={account.error} /> : null}
          <details><summary>Account label and granted permissions</summary><VStack gap={2}><AccountLabel key={account.label} account={account} busy={busy} onSave={(label) => execute(() => api.labelPluginAccount(account.id, label))} /><Text color="secondary">{account.grantedScopes.length ? account.grantedScopes.join("\n") : "Permissions are managed by the provider’s MCP application."}</Text></VStack></details>
          <div {...stylex.props(styles.row)}><Button label="Reconnect" variant="secondary" size="sm" isDisabled={busy || Boolean(provider.setupReason)} onClick={() => authorize(provider.id, account.id)} /><Button label="Disconnect" variant="ghost" size="sm" isDisabled={busy} onClick={() => setConfirm({ kind: "account", id: account.id, name: account.label })} /></div>
        </VStack>)}
        {!data.accounts.some((account) => account.providerId === provider.id) ? <Text color="secondary">No {provider.name} accounts connected.</Text> : null}
        <Button label="Add account" isDisabled={busy || Boolean(provider.setupReason)} onClick={() => authorize(provider.id)} />
        <Text color="secondary">First consent requests the supported {provider.name} service group. You can disable individual cards afterward. Expanded permissions require reconnecting for consent.</Text>
      </> : <>
        <Heading level={2}>Services</Heading>
        <div {...stylex.props(styles.cards)}>{data.providers.flatMap((entry) => entry.services.map((card) => {
          const count = data.accounts.filter((account) => account.providerId === entry.id && account.enabledServices.includes(card.id) && account.status === "connected").length;
          return <div key={card.id} {...stylex.props(styles.card)}><Item label={card.name} description={`${card.description} ${count ? `${count} enabled account${count === 1 ? "" : "s"}.` : "No enabled accounts."}`} onClick={() => setSelectedService(card.id)} /><Text color="secondary">{entry.setupReason ? "Not available yet" : "Ready to connect"}</Text></div>;
        }))}</div>
      </>}
    </VStack> : null}

    {section === "mcp" ? <VStack gap={3}>
      <Heading level={2}>Custom MCP connections</Heading><Text color="secondary">Local stdio and remote HTTP, including legacy SSE endpoints. Adding a connection does not install a server or change native Agent configuration.</Text>
      {editing !== undefined ? <McpEditor key={editing === "new" ? "new" : editing.id} {...(editing === "new" ? {} : { initial: editing })} busy={busy} onCancel={() => setEditing(undefined)} onSave={async (body) => { await run(() => api.saveMcp(editing === "new" ? null : editing.id, body)); setEditing(undefined); }} /> : <Button label="Add MCP" onClick={() => setEditing("new")} isDisabled={busy} />}
      {!data.mcp.length && editing === undefined ? <Text color="secondary">No custom MCP connections. Add an endpoint or a locally installed server.</Text> : null}
      {data.mcp.map((connection) => <VStack key={connection.id} gap={2} {...stylex.props(styles.card)}>
        <Heading level={3}>{connection.name}</Heading><Text color="secondary">{connection.transport.type === "http" ? connection.transport.url : `${connection.transport.command} ${connection.transport.args.join(" ")}`}</Text>
        <Switch label={`Enable ${connection.name}`} value={connection.enabled} isDisabled={busy} onChange={(enabled) => execute(() => api.setMcpEnabled(connection.id, enabled))} />
        <Text>{connection.status === "connected" ? `${connection.toolCount} tools discovered` : connection.status === "unchecked" ? "Not checked yet" : "Connection failed"}</Text>
        {connection.error ? <Banner status="error" title="MCP error" description={connection.error} /> : null}
        <div {...stylex.props(styles.row)}><Button label="Check" size="sm" variant="secondary" isDisabled={busy} onClick={() => execute(() => api.checkMcp(connection.id), "Connection check completed. See its reported status below.")} /><Button label="Edit" size="sm" variant="secondary" isDisabled={busy} onClick={() => setEditing(connection)} /><Button label="Remove" size="sm" variant="ghost" isDisabled={busy} onClick={() => setConfirm({ kind: "mcp", id: connection.id, name: connection.name })} /></div>
      </VStack>)}
    </VStack> : null}

    {section === "skills" ? <SkillsPanel data={data} busy={busy} execute={execute} onRemove={(skill) => setConfirm({ kind: "skill", id: skill.id, name: skill.name })} /> : null}

  </VStack>;
}

function SkillsPanel({ data, busy, execute, onRemove }: {
  data: PluginStateDto;
  busy: boolean;
  execute(action: () => Promise<unknown>, message?: string): void;
  onRemove(skill: InstalledSkillDto): void;
}): JSX.Element {
  const [view, setView] = useState<"discover" | "installed">("discover");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string>();
  const cursor = !search && page > 0 ? String(page) : undefined;
  const catalog = useQuery({
    queryKey: ["skill-catalog", data.cloudUrl, search, cursor],
    queryFn: () => api.searchSkills(search, cursor),
    enabled: view === "discover" && detailId === undefined,
    retry: false,
    staleTime: 60_000,
  });
  const detail = useQuery({
    queryKey: ["skill-detail", data.cloudUrl, detailId],
    queryFn: () => api.skillDetail(detailId!),
    enabled: view === "discover" && detailId !== undefined,
    retry: false,
  });
  const installedCount = data.skills.length + data.nativeSkills.length;
  const pageSize = search ? SKILL_CATALOG_PAGE_SIZE : catalog.data?.pageSize ?? SKILL_CATALOG_PAGE_SIZE;
  const total = catalog.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const visibleSkills = search ? catalog.data?.skills.slice(page * pageSize, (page + 1) * pageSize) : catalog.data?.skills;
  const canNext = catalog.isSuccess && (search ? page + 1 < pageCount : Boolean(catalog.data.nextCursor));
  const selectedInstalled = data.skills.find((skill) => skill.id === detailId);
  const pagination = <nav {...stylex.props(styles.pager)} aria-label="Skills pagination">
    <Button label="Previous" variant="secondary" size="sm" isDisabled={page === 0 || catalog.isFetching} onClick={() => setPage((current) => current - 1)} />
    <Text role="status">{catalog.isPending ? "Loading…" : catalog.isError ? "Unavailable" : `Page ${page + 1} of ${pageCount}`}</Text>
    <Button label="Next" variant="secondary" size="sm" isDisabled={!canNext || catalog.isFetching} onClick={() => setPage((current) => current + 1)} />
  </nav>;

  return <VStack gap={4} data-testid="skills-panel">
    <div {...stylex.props(styles.pager)}>
      <Heading level={2}>Skills</Heading>
      <div {...stylex.props(styles.row)} aria-label="Skill views">
        <Button label="Discover" variant={view === "discover" ? "primary" : "secondary"} size="sm" aria-pressed={view === "discover"} onClick={() => setView("discover")} />
        <Button label={`Installed (${installedCount})`} variant={view === "installed" ? "primary" : "secondary"} size="sm" aria-pressed={view === "installed"} onClick={() => setView("installed")} />
      </div>
    </div>
    {view === "installed" ? <VStack gap={4}>
      <div {...stylex.props(styles.pager)}>
        <Heading level={3}>Installed with Omarchy Bot · {data.skills.length}</Heading>
        {data.skills.length ? <Button label="Check updates" size="sm" variant="secondary" isDisabled={busy} onClick={() => execute(() => api.updateSkills(), "Update check completed. See each skill’s status below.")} /> : null}
      </div>
      <Text color="secondary">Shared across Bots. Updates are checked every six hours. Disabled Skills stay installed but are not offered to the Agent.</Text>
      {data.skills.length ? <div {...stylex.props(styles.skillGrid)} aria-label="Skills installed with Omarchy Bot">
        {data.skills.map((skill) => <Card key={skill.id} padding={4} xstyle={styles.skillCard} role="article" aria-label={skill.name}>
          <div {...stylex.props(styles.skillBody)}>
            <Heading level={4}>{skill.name}</Heading>
            <Text {...stylex.props(styles.skillDescription)}>{skill.description}</Text>
            <Text color="secondary">{skill.source}</Text>
            <Switch label={`Enable ${skill.name}`} value={skill.enabled} isDisabled={busy} onChange={(enabled) => execute(() => api.setSkillEnabled(skill.id, enabled))} />
            <details><summary>Version and updates</summary><code {...stylex.props(styles.code)}>{skill.revision}</code><Text color="secondary">{skill.lastCheckedAt ? `Checked ${new Date(skill.lastCheckedAt).toLocaleString()}` : `Installed ${new Date(skill.installedAt).toLocaleString()}`}</Text></details>
            {skill.error ? <Banner status="warning" title="Update unavailable; installed version retained" description={skill.error} /> : null}
            <div {...stylex.props(styles.skillActions)}><Text color="secondary">{skill.enabled ? "Enabled" : "Disabled"}</Text><Button label="Remove" aria-label={`Remove ${skill.name}`} variant="ghost" size="sm" isDisabled={busy} onClick={() => onRemove(skill)} /></div>
          </div>
        </Card>)}
      </div> : <Card padding={4}><VStack gap={2}>
        <Text>No Skills installed from the catalog yet.{data.nativeSkills.length ? ` Your ${data.nativeSkills.length} Agent-provided Skills are listed below.` : ""}</Text>
        <Button label="Discover Skills" variant="secondary" onClick={() => { setView("discover"); setDetailId(undefined); }} />
      </VStack></Card>}
      <Heading level={3}>Provided by your Agent · {data.nativeSkills.length}</Heading>
      <Text color="secondary">Already discovered by the Agent. These Skills are read-only here and do not need to be installed again.</Text>
      {data.nativeError ? <Banner status="warning" title="Agent Skills could not be refreshed" description="Previously discovered Skills may still be listed. Try again later." /> : null}
      <div {...stylex.props(styles.skillGrid)} aria-label="Agent-provided Skills">
        {data.nativeSkills.map((skill) => <Card key={`${skill.agentId}:${skill.path}`} padding={4} variant="muted" xstyle={styles.skillCard} role="article" aria-label={skill.name}>
          <div {...stylex.props(styles.skillBody)}>
            <Heading level={4}>{skill.name}</Heading>
            <Text {...stylex.props(styles.skillDescription)}>{skill.description}</Text>
            <div {...stylex.props(styles.skillActions)}><Text color="secondary">{skill.agentId === "pi" ? "Pi" : skill.agentId}</Text><Text color="secondary">Read-only</Text></div>
          </div>
        </Card>)}
      </div>
      {!data.nativeError && !data.nativeSkills.length ? <Text color="secondary">No Agent-provided Skills were discovered.</Text> : null}
    </VStack> : detailId ? <VStack gap={3}>
      <Button label="Back to catalog" variant="ghost" onClick={() => setDetailId(undefined)} />
      {detail.isPending ? <Text role="status">Loading skill…</Text> : detail.isError ? <VStack gap={2}><Banner status="error" title="Skill detail unavailable" description="This Skill could not be loaded. Please try again." /><Button label="Retry" variant="secondary" onClick={() => void detail.refetch()} /></VStack> : detail.data ? <>
        <Card padding={4}><VStack gap={3}>
          <Heading level={3}>{detail.data.name}</Heading><Text>{detail.data.description}</Text><Text color="secondary">{detail.data.source}</Text>
          <div {...stylex.props(styles.pager)}>
            <a href={detail.data.url} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.link)}>View on skills.sh</a>
            <Button label={selectedInstalled ? "Installed" : "Install"} isDisabled={busy || Boolean(selectedInstalled)} onClick={() => execute(() => api.installSkill(detailId), "Skill installed. Use / in the composer, or let the Agent discover it on the next turn.")} />
          </div>
        </VStack></Card>
        <Text color="secondary">Review third-party instructions before installing. The complete Skill folder is saved, but its scripts do not run during installation.</Text>
        {detail.data.content ? <div {...stylex.props(styles.document)}><Markdown>{detail.data.content}</Markdown></div> : <Text color="secondary">No text preview is available. Installation checks the original source.</Text>}
      </> : null}
    </VStack> : <VStack gap={3}>
      <Text color="secondary">Find new capabilities for your Bots in the skills.sh catalog.</Text>
      <form {...stylex.props(styles.search)} onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); setPage(0); }}>
        <TextInput label="Search skills.sh" value={searchDraft} onChange={setSearchDraft} width="100%" placeholder="Search by task or skill name" />
        <Button label="Search" type="submit" variant="secondary" isDisabled={searchDraft.trim().length === 1 || searchDraft.trim().length > 256} />
      </form>
      {catalog.isSuccess ? <div {...stylex.props(styles.pager)}>
        <Text color="secondary">{total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} of ${total.toLocaleString()} ${search ? "matches" : "trending Skills"}` : "0 matches"}</Text>
        {search ? <Button label="Clear search" variant="ghost" size="sm" onClick={() => { setSearch(""); setSearchDraft(""); setPage(0); }} /> : null}
      </div> : null}
      {catalog.data?.searchLimit && total >= catalog.data.searchLimit ? <Text color="secondary">Showing the top {catalog.data.searchLimit} matches. Refine your search to narrow the results.</Text> : null}
      {pagination}
      {catalog.isPending ? <>
        <Text role="status">Loading Skills…</Text>
        <div {...stylex.props(styles.skillGrid)} aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <Card key={index} padding={4} minHeight={150}><div {...stylex.props(styles.skeleton)} /><div {...stylex.props(styles.skeleton)} /></Card>)}</div>
      </> : catalog.isError ? <VStack gap={2}><Banner status="error" title="Catalog unavailable" description="Skills could not be loaded. Your installed Skills are unchanged." /><Button label="Retry catalog" variant="secondary" onClick={() => void catalog.refetch()} /></VStack> : visibleSkills?.length ? <div {...stylex.props(styles.skillGrid)} aria-label="Skill catalog" data-testid="skill-catalog-grid">
        {visibleSkills.map((skill) => {
          const installed = data.skills.find((entry) => entry.id === skill.id);
          return <Card key={skill.id} padding={4} minHeight={170} xstyle={styles.skillCard} role="article" aria-label={skill.name}>
            <div {...stylex.props(styles.skillBody)}>
              <Heading level={3}>{skill.name}</Heading><Text color="secondary">{skill.source}</Text>
              {skill.description ? <Text {...stylex.props(styles.skillDescription)}>{skill.description}</Text> : null}
              <div {...stylex.props(styles.skillActions)}>
                <Text color="secondary">{installed ? installed.enabled ? "Enabled" : "Installed · Disabled" : skill.installs === undefined ? "Available" : `${skill.installs.toLocaleString()} installs`}</Text>
                <Button label="View skill" aria-label={`View ${skill.name}`} variant="secondary" size="sm" onClick={() => setDetailId(skill.id)} />
              </div>
            </div>
          </Card>;
        })}
      </div> : <Card padding={4}><VStack gap={2}><Heading level={3}>No matching Skills</Heading><Text color="secondary">Try another name or describe the task you want your Bot to do.</Text></VStack></Card>}
      {catalog.isSuccess && Boolean(visibleSkills?.length) ? pagination : null}
    </VStack>}
  </VStack>;
}
