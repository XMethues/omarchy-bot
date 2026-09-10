import { useEffect, useState, type FormEvent, type JSX, type RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as stylex from "@stylexjs/stylex";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
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
import type { McpConnectionDto, PluginAccountDto, SaveMcpBody } from "@omarchy-bot/protocol";
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
});

type Section = "services" | "mcp" | "skills" | "setup";

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

function PublisherSetup({ initial, busy, onSave }: { initial: string | null; busy: boolean; onSave(url: string | null): void }): JSX.Element {
  const [url, setUrl] = useState(initial ?? "");
  return <form onSubmit={(event) => { event.preventDefault(); onSave(url.trim() || null); }}>
    <VStack gap={3}>
      <Heading level={2}>Publisher backend</Heading>
      <Text>The project-owned Vercel backend provides the formal skills.sh catalog and confidential OAuth exchanges. Business data goes directly between this Omarchy host and the provider. User tokens stay on this host.</Text>
      <TextInput label="Publisher HTTPS origin" value={url} onChange={setUrl} placeholder="Your deployed publisher origin" width="100%" isDisabled={busy} />
      <Text color="secondary">No public endpoint is assumed. Leave empty to remove the catalog/authorization endpoint. Existing account refresh remains bound to its original publisher. Never enter a client secret here.</Text>
      <Button label={busy ? "Saving…" : "Save backend"} type="submit" isDisabled={busy} />
      <Banner status="warning" title="Local client only" description="The daemon control API is not an authenticated remote-access boundary. Do not expose it publicly. Publisher callback support is limited to localhost and private-network client origins." />
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
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [pages, setPages] = useState<(string | undefined)[]>([]);
  const [detailId, setDetailId] = useState<string>();
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
  const catalog = useQuery({ queryKey: ["skill-catalog", state.data?.cloudUrl, search, cursor], queryFn: () => api.searchSkills(search, cursor), enabled: section === "skills" && Boolean(state.data?.cloudUrl) && detailId === undefined, retry: false });
  const detail = useQuery({ queryKey: ["skill-detail", state.data?.cloudUrl, detailId], queryFn: () => api.skillDetail(detailId!), enabled: section === "skills" && detailId !== undefined, retry: false });
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
    <Text color="secondary">Available to every Bot. Configuration updates start on the next turn, without interrupting current work. Provider revocation is enforced when the provider rejects access, including during current turns.</Text>
    <div {...stylex.props(styles.row)} aria-label="Plugin sections">
      {(["services", "mcp", "skills", "setup"] as const).map((id) => <Button key={id} label={id === "mcp" ? "MCP" : id[0]!.toUpperCase() + id.slice(1)} variant={section === id ? "primary" : "secondary"} size="sm" aria-pressed={section === id} onClick={() => setSection(id)} />)}
    </div>
    {change.isError ? <Banner status="error" title="Change not completed" description={apiErrorMessage(change.error, "Plugin operation failed.")} /> : null}
    {busy ? <Text role="status">Applying change…</Text> : notice ? <Text role="status">{notice}</Text> : null}
    {data.cloudError ? <Banner status="warning" title="Publisher backend unavailable" description={data.cloudError} /> : null}
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
        <a href={provider.documentationUrl} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.link)}>Provider setup and access requirements</a>
        {provider.setupReason ? <Banner status="warning" title="Publisher setup required" description={provider.setupReason} /> : null}
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
        {!data.cloudUrl ? <Text color="secondary">Configure the publisher backend under Setup to authorize service accounts.</Text> : null}
        <div {...stylex.props(styles.cards)}>{data.providers.flatMap((entry) => entry.services.map((card) => {
          const count = data.accounts.filter((account) => account.providerId === entry.id && account.enabledServices.includes(card.id) && account.status === "connected").length;
          return <div key={card.id} {...stylex.props(styles.card)}><Item label={card.name} description={`${card.description} ${count ? `${count} enabled account${count === 1 ? "" : "s"}.` : "No enabled accounts."}`} onClick={() => setSelectedService(card.id)} /><Text color="secondary">{entry.mode === "mcp" ? "Official MCP" : "Official API"}{entry.setupReason ? " · Setup required" : ""}</Text></div>;
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

    {section === "skills" ? <VStack gap={3}>
      <Heading level={2}>Skills</Heading><Text color="secondary">Browse the formal skills.sh catalog through the publisher backend. Installation retains the complete source folder, and automatic updates check every six hours. New versions apply to the next turn.</Text>
      <Heading level={3}>Installed for every Bot</Heading>
      {data.skills.length ? <Button label="Check updates" variant="secondary" isDisabled={busy || !data.cloudUrl} onClick={() => execute(() => api.updateSkills(), "Update check completed. See each skill’s status below.")} /> : <Text color="secondary">No managed skills installed.</Text>}
      {data.skills.map((skill) => <VStack key={skill.id} gap={2} {...stylex.props(styles.card)}>
        <Heading level={4}>{skill.name}</Heading><Text>{skill.description}</Text><Text color="secondary">{skill.source}</Text>
        <Switch label={`Enable ${skill.name}`} value={skill.enabled} isDisabled={busy} onChange={(enabled) => execute(() => api.setSkillEnabled(skill.id, enabled))} />
        <details><summary>Installed revision</summary><code {...stylex.props(styles.code)}>{skill.revision}</code><Text color="secondary">{skill.lastCheckedAt ? `Checked ${new Date(skill.lastCheckedAt).toLocaleString()}` : `Installed ${new Date(skill.installedAt).toLocaleString()}`}</Text></details>
        {skill.error ? <Banner status="warning" title="Update unavailable; installed version retained" description={skill.error} /> : null}
        <Button label="Remove" variant="ghost" size="sm" isDisabled={busy} onClick={() => setConfirm({ kind: "skill", id: skill.id, name: skill.name })} />
      </VStack>)}
      <Heading level={3}>Native Agent skills · Read-only</Heading>
      {data.nativeError ? <Banner status="warning" title="Native resources unavailable" description={data.nativeError} /> : data.nativeSkills.length ? data.nativeSkills.map((skill) => <Item key={skill.path} label={skill.name} description={`${skill.description} · ${skill.agentId}`} />) : <Text color="secondary">No native skills were discovered. Existing native configuration is never edited here.</Text>}
      <Heading level={3}>skills.sh catalog</Heading>
      {!data.cloudUrl ? <VStack gap={2}><Text color="secondary">The official API needs a deployed Vercel backend with OIDC enabled. No anonymous catalog fallback is used.</Text><Button label="Open Setup" variant="secondary" onClick={() => setSection("setup")} /></VStack> : detailId ? <>
        <Button label="Back to catalog" variant="ghost" onClick={() => setDetailId(undefined)} />
        {detail.isPending ? <Text>Loading skill…</Text> : detail.isError ? <Banner status="error" title="Skill detail unavailable" description={apiErrorMessage(detail.error, "Could not load this skill.")} /> : detail.data ? <VStack gap={2}>
          <Heading level={4}>{detail.data.name}</Heading><Text>{detail.data.description}</Text><a href={detail.data.url} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.link)}>View on skills.sh</a>
          <Button label={data.skills.some((skill) => skill.id === detailId) ? "Installed" : "Install"} isDisabled={busy || data.skills.some((skill) => skill.id === detailId)} onClick={() => execute(() => api.installSkill(detailId), "Skill installed. Use / in the composer, or let the Agent discover it on the next turn.")} />
          <Text color="secondary">Review skills before installing. Skill instructions and supporting scripts are third-party content. Installation does not execute those scripts; the Agent may use them when you invoke the skill.</Text>
          {detail.data.content ? <div {...stylex.props(styles.document)}><Markdown>{detail.data.content}</Markdown></div> : <Text color="secondary">The catalog has no text snapshot. Installation resolves the complete original source; missing or unsafe content is rejected.</Text>}
        </VStack> : null}
      </> : <>
        <form onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); setCursor(undefined); setPages([]); }}><VStack gap={2}><TextInput label="Search skills.sh" value={searchDraft} onChange={setSearchDraft} width="100%" placeholder="Search by task or skill name" /><Button label="Search" type="submit" variant="secondary" isDisabled={searchDraft.trim().length === 1} /></VStack></form>
        {catalog.isPending ? <Text>Loading catalog…</Text> : catalog.isError ? <VStack gap={2}><Banner status="error" title="Catalog unavailable" description={apiErrorMessage(catalog.error, "The official catalog could not be reached.")} /><Button label="Retry catalog" variant="secondary" onClick={() => void catalog.refetch()} /></VStack> : catalog.data?.skills.length ? catalog.data.skills.map((skill) => <Item key={skill.id} label={skill.name} description={`${skill.source}${skill.installs === undefined ? "" : ` · ${skill.installs.toLocaleString()} installs`}`} onClick={() => setDetailId(skill.id)} />) : <Text color="secondary">No matching skills.</Text>}
        <div {...stylex.props(styles.row)}>{pages.length ? <Button label="Previous" variant="secondary" onClick={() => { setCursor(pages.at(-1)); setPages((current) => current.slice(0, -1)); }} /> : null}{catalog.data?.nextCursor ? <Button label="Next" variant="secondary" onClick={() => { setPages((current) => [...current, cursor]); setCursor(catalog.data!.nextCursor); }} /> : null}</div>
      </>}
    </VStack> : null}

    {section === "setup" ? <PublisherSetup key={data.cloudUrl ?? "unset"} initial={data.cloudUrl} busy={busy} onSave={(url) => execute(() => api.configurePlugins(url))} /> : null}
  </VStack>;
}
