import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { Dialog } from "@astryxdesign/core/Dialog";
import { DialogHeader } from "@astryxdesign/core/Dialog";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { RadioList } from "@astryxdesign/core/RadioList";
import { RadioListItem } from "@astryxdesign/core/RadioList";
import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/VStack";
import { Banner } from "@astryxdesign/core/Banner";
import type { AgentDto } from "@omarchy-bot/protocol";
import { api, apiErrorMessage } from "../lib/api.ts";

interface CreateBotDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (botId: string) => void;
}

/**
 * One simple creation dialog (workspace-redesign §4): Name, Job/Instructions,
 * Agent. Unavailable agents stay visible but disabled with plain-language
 * guidance; creation selects the new bot and opens a blank conversation.
 */
export function CreateBotDialog({ isOpen, onClose, onCreated }: CreateBotDialogProps): JSX.Element {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError(undefined);
    void api
      .listAgents()
      .then((list) => {
        if (cancelled) return;
        setAgents(list);
        const ready = list.find((agent) => agent.status === "ready");
        setAgentId((previous) => (previous !== "" ? previous : ready?.id ?? ""));
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(apiErrorMessage(loadError, "Agents could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const reset = useCallback((): void => {
    setName("");
    setInstructions("");
    setAgentId("");
    setError(undefined);
  }, []);

  const submit = useCallback(async (): Promise<void> => {
    if (name.trim().length === 0) {
      setError("Name is required.");
      return;
    }
    const selectedAgent = agents.find((agent) => agent.id === agentId);
    if (selectedAgent === undefined) {
      setError("Pick an available agent.");
      return;
    }
    setCreating(true);
    try {
      const bot = await api.createBot({ name: name.trim(), instructions, agentId: selectedAgent.id });
      reset();
      onCreated(bot.id);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, "The bot could not be created."));
    } finally {
      setCreating(false);
    }
  }, [name, instructions, agentId, onCreated, onClose, reset]);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          reset();
        }
      }}
      width={520}
    >
      <DialogHeader title="Create a bot" subtitle="Name your teammate, describe its job, and pick the agent that runs it." />
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <VStack padding={4} gap={4}>
          {error !== undefined ? <Banner status="error" title={error} /> : null}
          <TextInput label="Name" value={name} onChange={setName} placeholder="e.g. Release Shepherd" isRequired data-testid="create-bot-name" />
          <TextArea label="Job / Instructions" value={instructions} onChange={setInstructions} placeholder="What should this bot do?" data-testid="create-bot-instructions" />
          <RadioList label="Agent" value={agentId} onChange={setAgentId} data-testid="create-bot-agent">
            {agents.map((a) => (
              <RadioListItem
                key={a.id}
                value={a.id}
                label={`${a.displayName}${a.version !== "unknown" && a.version !== "" ? ` · v${a.version}` : ""}`}
                isDisabled={a.status !== "ready"}
                description={a.status === "ready" ? "Ready" : a.guidance ?? a.reason ?? a.status}
              />
            ))}
          </RadioList>
          <Button label={creating ? "Creating…" : "Create bot"} variant="primary" type="button" onClick={() => void submit()} isLoading={creating} data-testid="create-bot-submit" />
        </VStack>
      </form>
    </Dialog>
  );
}
