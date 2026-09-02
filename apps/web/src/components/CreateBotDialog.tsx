import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import type { AgentDto, AgentStatusDto } from "@omarchy-bot/protocol";
import { api, apiErrorMessage } from "../lib/api.ts";

interface CreateBotDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (botId: string) => void;
}

type InvalidField = "name" | "agent";

const AGENT_STATUS_DESCRIPTION: Record<AgentStatusDto, string> = {
  ready: "Ready to work",
  checking: "Checking availability",
  missing: "Not available in this installation",
  unconfigured: "Needs setup before it can run a bot",
  incompatible: "Needs an update or setup check before it can run a bot",
  offline: "Not responding right now",
};

/** Creates a teammate from the available local agents. */
export function CreateBotDialog({ isOpen, onClose, onCreated }: CreateBotDialogProps): JSX.Element {
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [agentId, setAgentId] = useState("");
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [invalidField, setInvalidField] = useState<InvalidField | undefined>(undefined);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [creating, setCreating] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const agentListRef = useRef<HTMLDivElement>(null);

  const loadAgents = useCallback(async (): Promise<void> => {
    setLoadingAgents(true);
    setError(undefined);
    try {
      const list = await api.listAgents();
      setAgents(list);
      const ready = list.find((agent) => agent.status === "ready");
      setAgentId(ready?.id ?? "");
    } catch (loadError) {
      setAgents([]);
      setAgentId("");
      setError(apiErrorMessage(loadError, "Available agents couldn’t be loaded. Check your connection and try again."));
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setAgents([]);
    setAgentId("");
    setInvalidField(undefined);
    void loadAgents();
  }, [isOpen, loadAgents]);

  const reset = useCallback((): void => {
    setName("");
    setInstructions("");
    setAgentId("");
    setAgents([]);
    setError(undefined);
    setInvalidField(undefined);
    setLoadingAgents(false);
  }, []);

  const submit = useCallback(async (): Promise<void> => {
    if (name.trim().length === 0) {
      setInvalidField("name");
      setError("Give this bot a name.");
      nameRef.current?.focus();
      return;
    }
    const selectedAgent = agents.find((agent) => agent.id === agentId && agent.status === "ready");
    if (selectedAgent === undefined) {
      setInvalidField("agent");
      setError("Pick an agent that is ready to work.");
      agentListRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();
      return;
    }
    setCreating(true);
    setInvalidField(undefined);
    setError(undefined);
    try {
      const bot = await api.createBot({ name: name.trim(), instructions, agentId: selectedAgent.id });
      reset();
      onCreated(bot.id);
      onClose();
    } catch (createError) {
      setError(apiErrorMessage(createError, "This bot couldn’t be created. Check your connection and try again."));
      nameRef.current?.focus();
    } finally {
      setCreating(false);
    }
  }, [name, instructions, agents, agentId, onCreated, onClose, reset]);

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
      purpose="form"
    >
      <DialogHeader title="Create a bot" subtitle="Name your teammate, describe its job, and pick the agent that runs it." />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <VStack padding={4} gap={4}>
          {error !== undefined ? <Banner status="error" title={error} /> : null}
          <TextInput
            ref={nameRef}
            autoFocus
            label="Name"
            value={name}
            onChange={(value) => {
              setName(value);
              if (invalidField === "name" && value.trim().length > 0) setInvalidField(undefined);
            }}
            placeholder="e.g. Release Shepherd"
            isRequired
            {...(invalidField === "name" ? { status: { type: "error" as const, message: "Enter a name." } } : {})}
            width="100%"
            data-testid="create-bot-name"
          />
          <TextArea
            label="Job / Instructions"
            value={instructions}
            onChange={setInstructions}
            placeholder="What should this bot do?"
            width="100%"
            data-testid="create-bot-instructions"
          />
          {loadingAgents ? (
            <EmptyState
              icon={<Icon icon="clock" size="lg" />}
              title="Checking agents"
              description="Finding agents that are ready to run this bot."
              isCompact
            />
          ) : agents.length === 0 ? (
            <EmptyState
              icon={<Icon icon="warning" size="lg" />}
              title="No agents available"
              description="Try again to check for agents that can run a bot."
              actions={<Button label="Check again" variant="secondary" onClick={() => void loadAgents()} />}
              isCompact
            />
          ) : (
            <RadioList
              ref={agentListRef}
              label="Agent"
              value={agentId}
              onChange={(value) => {
                setAgentId(value);
                setInvalidField(undefined);
              }}
              {...(invalidField === "agent" ? { status: { type: "error" as const, message: "Choose an agent that is ready." } } : {})}
              width="100%"
              data-testid="create-bot-agent"
            >
              {agents.map((agent) => (
                <RadioListItem
                  key={agent.id}
                  value={agent.id}
                  label={agent.displayName}
                  isDisabled={agent.status !== "ready"}
                  description={AGENT_STATUS_DESCRIPTION[agent.status]}
                />
              ))}
            </RadioList>
          )}
          <Button
            label="Create bot"
            variant="primary"
            type="submit"
            isLoading={creating}
            isDisabled={loadingAgents || agents.length === 0}
            data-testid="create-bot-submit"
          />
        </VStack>
      </form>
    </Dialog>
  );
}
