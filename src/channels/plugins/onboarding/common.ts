/**
 * Common utilities for channel onboarding adapters.
 *
 * These utilities reduce code duplication across channel-specific onboarding
 * implementations by providing shared patterns for:
 * - Parsing allowFrom input
 * - Config mutation with account-aware merging
 * - DM policy setting
 */

import type { MoltbotConfig } from "../../../config/config.js";
import type { DmPolicy } from "../../../config/types.js";
import { DEFAULT_ACCOUNT_ID } from "../../../routing/session-key.js";
import type { ChannelId } from "../types.js";
import { addWildcardAllowFrom } from "./helpers.js";

/**
 * Parse comma/semicolon/newline-separated allowFrom input into array.
 * This pattern is duplicated across all channel adapters.
 */
export function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// Helper to safely get channel config as an object for spreading
function getChannelConfigObject(cfg: MoltbotConfig, channel: ChannelId): Record<string, unknown> {
  const channelCfg = cfg.channels?.[channel];
  return (channelCfg && typeof channelCfg === "object" ? channelCfg : {}) as Record<
    string,
    unknown
  >;
}

// Helper to safely get accounts from channel config
function getAccountsObject(channelCfg: Record<string, unknown>): Record<string, unknown> {
  const accounts = channelCfg.accounts;
  return (accounts && typeof accounts === "object" ? accounts : {}) as Record<string, unknown>;
}

// Helper to safely get account config
function getAccountConfigObject(
  accounts: Record<string, unknown>,
  accountId: string,
): Record<string, unknown> {
  const accountCfg = accounts[accountId];
  return (accountCfg && typeof accountCfg === "object" ? accountCfg : {}) as Record<
    string,
    unknown
  >;
}

/**
 * Set DM policy for a channel, adding wildcard to allowFrom for "open" policy.
 * This pattern is duplicated across signal, telegram, imessage adapters.
 */
export function setChannelDmPolicy(
  cfg: MoltbotConfig,
  channel: ChannelId,
  dmPolicy: DmPolicy,
): MoltbotConfig {
  const channelCfg = getChannelConfigObject(cfg, channel);
  const currentAllowFrom = channelCfg.allowFrom as Array<string | number> | undefined;
  const allowFrom = dmPolicy === "open" ? addWildcardAllowFrom(currentAllowFrom) : undefined;

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [channel]: {
        ...channelCfg,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

/**
 * Set allowFrom for a channel, handling default vs multi-account configs.
 * This pattern is duplicated across all channel adapters.
 */
export function setChannelAllowFrom(
  cfg: MoltbotConfig,
  channel: ChannelId,
  accountId: string,
  allowFrom: string[],
): MoltbotConfig {
  const channelCfg = getChannelConfigObject(cfg, channel);

  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [channel]: {
          ...channelCfg,
          allowFrom,
        },
      },
    };
  }

  const accounts = getAccountsObject(channelCfg);
  const accountCfg = getAccountConfigObject(accounts, accountId);

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [channel]: {
        ...channelCfg,
        accounts: {
          ...accounts,
          [accountId]: {
            ...accountCfg,
            allowFrom,
          },
        },
      },
    },
  };
}

/**
 * Enable a channel (set enabled: true).
 */
export function enableChannel(cfg: MoltbotConfig, channel: ChannelId): MoltbotConfig {
  const channelCfg = getChannelConfigObject(cfg, channel);
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [channel]: {
        ...channelCfg,
        enabled: true,
      },
    },
  };
}

/**
 * Disable a channel (set enabled: false).
 */
export function disableChannel(cfg: MoltbotConfig, channel: ChannelId): MoltbotConfig {
  const channelCfg = getChannelConfigObject(cfg, channel);
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [channel]: {
        ...channelCfg,
        enabled: false,
      },
    },
  };
}

/**
 * Set a channel property for either default or multi-account config.
 */
export function setChannelProperty<T>(
  cfg: MoltbotConfig,
  channel: ChannelId,
  accountId: string,
  props: Record<string, T>,
): MoltbotConfig {
  const channelCfg = getChannelConfigObject(cfg, channel);

  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        [channel]: {
          ...channelCfg,
          ...props,
        },
      },
    };
  }

  const accounts = getAccountsObject(channelCfg);
  const accountCfg = getAccountConfigObject(accounts, accountId);

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [channel]: {
        ...channelCfg,
        accounts: {
          ...accounts,
          [accountId]: {
            ...accountCfg,
            enabled: (accountCfg.enabled as boolean | undefined) ?? true,
            ...props,
          },
        },
      },
    },
  };
}
