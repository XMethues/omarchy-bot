import type { JSX } from "react";
import { useCallback, useEffect, useState } from "react";
import { Switch } from "@astryxdesign/core/Switch";

export const VOICE_AUTO_SEND_STORAGE_KEY = "settings:v1:auto-send-voice";

function readStoredValue(): boolean {
  try {
    return window.localStorage.getItem(VOICE_AUTO_SEND_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Browser-local voice preference. Absence and malformed values both mean off. */
export function useVoiceAutoSendSetting(): readonly [boolean, (enabled: boolean) => void] {
  const [value, setValue] = useState(readStoredValue);
  const update = useCallback((enabled: boolean): void => {
    setValue(enabled);
    try {
      window.localStorage.setItem(VOICE_AUTO_SEND_STORAGE_KEY, enabled ? "true" : "false");
    } catch {
      // Privacy-mode storage failures keep the setting for this page lifetime.
    }
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === VOICE_AUTO_SEND_STORAGE_KEY) setValue(event.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [value, update] as const;
}

export interface VoiceSettingsControlProps {
  value: boolean;
  onChange: (enabled: boolean) => void;
}

export function VoiceSettingsControl({ value, onChange }: VoiceSettingsControlProps): JSX.Element {
  return (
    <Switch
      label="Auto-send voice transcriptions"
      description="Send successful voice transcriptions after inserting them into their original conversation draft."
      value={value}
      onChange={onChange}
      data-testid="voice-auto-send"
    />
  );
}
