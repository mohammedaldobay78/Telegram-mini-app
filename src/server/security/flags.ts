import type { FlagsSettings } from "@/server/config/settings";
import { AppError } from "@/lib/errors";

export type KillSwitch = keyof FlagsSettings;

export function isEnabled(settings: { flags: FlagsSettings }, flag: KillSwitch): boolean {
  return settings.flags[flag];
}

export function assertEnabled(settings: { flags: FlagsSettings }, flag: KillSwitch): void {
  if (!settings.flags[flag]) {
    throw new AppError("KILL_SWITCHED", `The ${flag} feature is temporarily disabled`, {
      retryable: true,
      details: { flag },
    });
  }
}

export function allFlags(settings: { flags: FlagsSettings }): FlagsSettings {
  return { ...settings.flags };
}
