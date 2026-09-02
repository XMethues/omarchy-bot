import type { ChangeEvent, JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";
import type { BotDto, BotViewDto } from "@omarchy-bot/protocol";
import { api, apiErrorMessage } from "../lib/api.ts";
import { AvatarView } from "./AvatarView.tsx";

export interface ProfileDialogProps {
  bot: BotViewDto;
  open: boolean;
  onClose: () => void;
  onUpdated: (bot: BotDto) => void;
}

type BusyAction = "save" | "variation" | "upload" | "recipe";

/** Profile fields and avatar choices for one Bot. The Agent is display-only. */
export function ProfileDialog({ bot, open, onClose, onUpdated }: ProfileDialogProps): JSX.Element {
  const [current, setCurrent] = useState<BotDto>(bot);
  const [name, setName] = useState(bot.name);
  const [instructions, setInstructions] = useState(bot.instructions);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<BusyAction | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setCurrent(bot);
    setName(bot.name);
    setInstructions(bot.instructions);
    setPrompt("");
    setBusy(undefined);
    setError(undefined);
  }, [bot, open]);

  const acceptUpdate = useCallback(
    (updated: BotDto): void => {
      setCurrent(updated);
      setName(updated.name);
      setInstructions(updated.instructions);
      onUpdated(updated);
    },
    [onUpdated],
  );

  const save = useCallback(async (): Promise<void> => {
    if (name.trim().length === 0) {
      setError("Name is required.");
      return;
    }
    setBusy("save");
    setError(undefined);
    try {
      acceptUpdate(await api.patchBot(bot.id, { name: name.trim(), instructions }));
    } catch (updateError) {
      setError(apiErrorMessage(updateError, "The profile could not be saved."));
    } finally {
      setBusy(undefined);
    }
  }, [acceptUpdate, bot.id, instructions, name]);

  const newVariation = useCallback(async (): Promise<void> => {
    setBusy("variation");
    setError(undefined);
    try {
      acceptUpdate(await api.generateAvatar(bot.id));
    } catch (updateError) {
      setError(apiErrorMessage(updateError, "A new avatar variation could not be created."));
    } finally {
      setBusy(undefined);
    }
  }, [acceptUpdate, bot.id]);

  const upload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      if (file === undefined) return;
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        setError("Choose a PNG, JPEG, or WebP image.");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        setError("Choose an image no larger than 8MB.");
        return;
      }
      setBusy("upload");
      setError(undefined);
      try {
        acceptUpdate(await api.uploadAvatar(bot.id, file));
      } catch (updateError) {
        setError(apiErrorMessage(updateError, "The image could not be uploaded."));
      } finally {
        setBusy(undefined);
      }
    },
    [acceptUpdate, bot.id],
  );

  const createRecipe = useCallback(async (): Promise<void> => {
    const description = prompt.trim();
    if (description.length === 0) {
      setError("Describe the avatar you want.");
      return;
    }
    setBusy("recipe");
    setError(undefined);
    try {
      acceptUpdate(await api.avatarRecipe(bot.id, { prompt: description }));
      setPrompt("");
    } catch (updateError) {
      setError(apiErrorMessage(updateError, "The avatar description could not be applied."));
    } finally {
      setBusy(undefined);
    }
  }, [acceptUpdate, bot.id, prompt]);

  const disabled = busy !== undefined;

  return (
    <Dialog isOpen={open} onOpenChange={(isOpen) => !isOpen && onClose()} width={560} purpose="form">
      <DialogHeader title="Bot profile" subtitle="Shape this teammate's identity while keeping its Agent fixed." />
      <VStack padding={4} gap={4}>
        {error !== undefined ? <Banner status="error" title={error} /> : null}
        <HStack gap={3} align="center">
          <AvatarView avatar={current.avatar} name={current.name} size={96} activity="selected" />
          <VStack gap={0.5}>
            <Text type="label-lg">Current avatar</Text>
            <Text color="secondary">Rendered locally and kept deterministic.</Text>
          </VStack>
        </HStack>

        <TextInput label="Name" value={name} onChange={(value) => setName(value.slice(0, 80))} isRequired data-testid="profile-name" />
        <TextArea
          label="Job / Instructions"
          value={instructions}
          onChange={setInstructions}
          maxLength={8000}
          placeholder="What should this bot do?"
          data-testid="profile-instructions"
        />
        <Text color="secondary">Agent: {bot.agentId}. To use another Agent, create a new bot.</Text>
        <Button
          label={busy === "save" ? "Saving…" : "Save profile"}
          variant="primary"
          type="button"
          isLoading={busy === "save"}
          isDisabled={disabled && busy !== "save"}
          onClick={() => void save()}
          data-testid="profile-save"
        />

        <VStack gap={2}>
          <Text type="label-lg">Avatar choices</Text>
          <HStack gap={2} wrap="wrap">
            <Button
              label={busy === "variation" ? "Creating…" : "New variation"}
              variant="secondary"
              type="button"
              isLoading={busy === "variation"}
              isDisabled={disabled && busy !== "variation"}
              onClick={() => void newVariation()}
              data-testid="avatar-variation"
            />
            <Button
              label={busy === "upload" ? "Uploading…" : "Upload image"}
              variant="secondary"
              type="button"
              isLoading={busy === "upload"}
              isDisabled={disabled}
              onClick={() => fileInput.current?.click()}
              data-testid="avatar-upload-button"
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void upload(event)}
              style={{ display: "none" }}
              data-testid="avatar-upload-input"
            />
          </HStack>
          <TextArea
            label="Describe avatar"
            value={prompt}
            onChange={setPrompt}
            maxLength={2000}
            placeholder="A calm geometric teammate with crisp blue shapes"
            data-testid="avatar-prompt"
          />
          <Button
            label={busy === "recipe" ? "Creating…" : "Create from description"}
            variant="secondary"
            type="button"
            isLoading={busy === "recipe"}
            isDisabled={disabled && busy !== "recipe"}
            onClick={() => void createRecipe()}
            data-testid="avatar-recipe-submit"
          />
        </VStack>
      </VStack>
    </Dialog>
  );
}
