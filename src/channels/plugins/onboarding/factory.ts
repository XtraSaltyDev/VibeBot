/**
 * Channel Onboarding Adapter Factory
 *
 * This factory reduces code duplication across channel-specific onboarding
 * implementations by providing a declarative spec-based approach.
 *
 * Instead of each channel implementing 200-300 lines of boilerplate, channels
 * define a spec with their unique validation/normalization logic, and the
 * factory generates the full adapter implementation.
 *
 * Usage:
 * ```ts
 * export const myChannelAdapter = createChannelOnboardingAdapter({
 *   channel: "mychannel",
 *   label: "MyChannel",
 *   listAccountIds: listMyChannelAccountIds,
 *   resolveDefaultAccountId: resolveDefaultMyChannelAccountId,
 *   resolveAccount: resolveMyChannelAccount,
 *   // ... other spec properties
 * });
 * ```
 */

import type { MoltbotConfig } from "../../../config/config.js";
import type { DmPolicy } from "../../../config/types.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../../../routing/session-key.js";
import { formatDocsLink } from "../../../terminal/links.js";
import type { WizardPrompter } from "../../../wizard/prompts.js";
import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingConfigureContext,
  ChannelOnboardingDmPolicy,
  ChannelOnboardingResult,
  ChannelOnboardingStatus,
  ChannelOnboardingStatusContext,
} from "../onboarding-types.js";
import type { ChannelId } from "../types.js";
import {
  disableChannel,
  parseAllowFromInput,
  setChannelAllowFrom,
  setChannelDmPolicy,
} from "./common.js";
import { addWildcardAllowFrom, promptAccountId } from "./helpers.js";

/**
 * Account resolution result from channel-specific resolver.
 */
export type ChannelAccountResolution<TConfig = Record<string, unknown>> = {
  /** The resolved account config (merged with defaults) */
  config: TConfig;
  /** Whether this account is considered "configured" */
  configured: boolean;
};

/**
 * AllowFrom entry validation result.
 */
export type AllowFromValidationResult = {
  /** Validation error message, or undefined if valid */
  error?: string;
  /** Normalized form of the entry (optional) */
  normalized?: string;
};

/**
 * Spec for creating a channel onboarding adapter.
 *
 * This defines the channel-specific behavior while the factory handles
 * the common patterns.
 */
export type ChannelOnboardingSpec<
  TChannel extends ChannelId = ChannelId,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** Channel identifier */
  channel: TChannel;
  /** Human-readable label (e.g., "Signal", "Telegram") */
  label: string;

  // ─── Account Management ─────────────────────────────────────────────
  /** List all configured account IDs for this channel */
  listAccountIds: (cfg: MoltbotConfig) => string[];
  /** Resolve the default account ID */
  resolveDefaultAccountId: (cfg: MoltbotConfig) => string;
  /** Resolve account config for a specific account ID */
  resolveAccount: (params: {
    cfg: MoltbotConfig;
    accountId: string;
  }) => ChannelAccountResolution<TConfig>;

  // ─── Status Detection ───────────────────────────────────────────────
  /** Custom status check (optional, defaults to using resolveAccount.configured) */
  getConfiguredStatus?: (params: {
    cfg: MoltbotConfig;
    accountId: string;
    accountConfig: TConfig;
  }) => Promise<boolean> | boolean;
  /** Generate status lines for display */
  getStatusLines?: (params: {
    cfg: MoltbotConfig;
    configured: boolean;
    binaryDetected?: boolean;
  }) => string[];
  /** Selection hint shown in channel picker */
  getSelectionHint?: (params: { configured: boolean; binaryDetected?: boolean }) => string;
  /** Quickstart score (higher = more recommended) */
  getQuickstartScore?: (params: { configured: boolean; binaryDetected?: boolean }) => number;

  // ─── Binary/CLI Detection (optional) ────────────────────────────────
  /** Name of CLI binary to detect (e.g., "signal-cli", "imsg") */
  binaryName?: string;
  /** Config path for custom binary path (e.g., "channels.signal.cliPath") */
  getBinaryPath?: (cfg: MoltbotConfig, accountConfig: TConfig) => string;

  // ─── AllowFrom Validation ───────────────────────────────────────────
  /** Validate a single allowFrom entry */
  validateAllowFromEntry: (entry: string) => AllowFromValidationResult;
  /** Normalize a validated entry (called after validation passes) */
  normalizeAllowFromEntry?: (entry: string) => string;
  /** Example entries for help text */
  allowFromExamples: string[];
  /** Placeholder for text input */
  allowFromPlaceholder: string;
  /** Custom help note for allowFrom prompt */
  allowFromHelpNote?: string[];

  // ─── Documentation ──────────────────────────────────────────────────
  /** Docs path (e.g., "/signal") */
  docsPath: string;
  /** Next steps note shown after configuration */
  nextStepsNote?: string[];

  // ─── Custom Configure Logic (optional) ──────────────────────────────
  /**
   * Custom configure implementation.
   * If provided, this replaces the default configure flow entirely.
   * Use this for channels with unique setup requirements (like WhatsApp QR).
   */
  customConfigure?: (ctx: ChannelOnboardingConfigureContext) => Promise<ChannelOnboardingResult>;
};

/**
 * Create a DM policy object for a channel.
 */
function createDmPolicy<TChannel extends ChannelId, TConfig extends Record<string, unknown>>(
  spec: ChannelOnboardingSpec<TChannel, TConfig>,
): ChannelOnboardingDmPolicy {
  return {
    label: spec.label,
    channel: spec.channel,
    policyKey: `channels.${spec.channel}.dmPolicy`,
    allowFromKey: `channels.${spec.channel}.allowFrom`,
    getCurrent: (cfg) => {
      const channelCfg = cfg.channels?.[spec.channel];
      return ((channelCfg as { dmPolicy?: DmPolicy })?.dmPolicy ?? "pairing") as DmPolicy;
    },
    setPolicy: (cfg, policy) => setChannelDmPolicy(cfg, spec.channel, policy),
    promptAllowFrom: async (params) => {
      return promptAllowFromForSpec(spec as ChannelOnboardingSpec<TChannel>, params);
    },
  };
}

/**
 * Prompt for allowFrom entries using the spec's validation.
 */
async function promptAllowFromForSpec<
  TChannel extends ChannelId,
  TConfig extends Record<string, unknown>,
>(
  spec: ChannelOnboardingSpec<TChannel, TConfig>,
  params: {
    cfg: MoltbotConfig;
    prompter: WizardPrompter;
    accountId?: string;
  },
): Promise<MoltbotConfig> {
  const accountId =
    params.accountId && normalizeAccountId(params.accountId)
      ? (normalizeAccountId(params.accountId) ?? DEFAULT_ACCOUNT_ID)
      : spec.resolveDefaultAccountId(params.cfg);

  const resolved = spec.resolveAccount({ cfg: params.cfg, accountId });
  const existing = (resolved.config as { allowFrom?: string[] }).allowFrom ?? [];

  // Show help note
  const helpLines = spec.allowFromHelpNote ?? [
    `Allowlist ${spec.label} DMs by sender id.`,
    "Examples:",
    ...spec.allowFromExamples.map((ex) => `- ${ex}`),
    "Multiple entries: comma-separated.",
    `Docs: ${formatDocsLink(spec.docsPath, spec.channel)}`,
  ];
  await params.prompter.note(helpLines.join("\n"), `${spec.label} allowlist`);

  // Prompt for entry
  const entry = await params.prompter.text({
    message: `${spec.label} allowFrom`,
    placeholder: spec.allowFromPlaceholder,
    initialValue: existing[0] ? String(existing[0]) : undefined,
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return "Required";
      const parts = parseAllowFromInput(raw);
      for (const part of parts) {
        if (part === "*") continue;
        const result = spec.validateAllowFromEntry(part);
        if (result.error) return result.error;
      }
      return undefined;
    },
  });

  // Parse and normalize
  const parts = parseAllowFromInput(String(entry));
  const normalized = parts
    .map((part) => {
      if (part === "*") return "*";
      const validation = spec.validateAllowFromEntry(part);
      if (validation.normalized) return validation.normalized;
      if (spec.normalizeAllowFromEntry) return spec.normalizeAllowFromEntry(part);
      return part;
    })
    .filter(Boolean);

  const unique = [...new Set(normalized)];
  return setChannelAllowFrom(params.cfg, spec.channel, accountId, unique);
}

/**
 * Create a channel onboarding adapter from a spec.
 */
export function createChannelOnboardingAdapter<
  TChannel extends ChannelId,
  TConfig extends Record<string, unknown> = Record<string, unknown>,
>(spec: ChannelOnboardingSpec<TChannel, TConfig>): ChannelOnboardingAdapter {
  const dmPolicy = createDmPolicy(spec);

  return {
    channel: spec.channel,

    getStatus: async (ctx: ChannelOnboardingStatusContext): Promise<ChannelOnboardingStatus> => {
      const { cfg, accountOverrides } = ctx;
      const overrideId = accountOverrides[spec.channel]?.trim();
      const defaultAccountId = spec.resolveDefaultAccountId(cfg);
      const accountId = overrideId ? normalizeAccountId(overrideId) : defaultAccountId;
      const resolved = spec.resolveAccount({ cfg, accountId });

      // Check if configured
      let configured = resolved.configured;
      if (spec.getConfiguredStatus) {
        configured = await spec.getConfiguredStatus({
          cfg,
          accountId,
          accountConfig: resolved.config,
        });
      }

      // Detect binary if specified
      let binaryDetected: boolean | undefined;
      if (spec.binaryName) {
        const { detectBinary } = await import("../../../commands/onboard-helpers.js");
        const binaryPath = spec.getBinaryPath
          ? spec.getBinaryPath(cfg, resolved.config)
          : spec.binaryName;
        binaryDetected = await detectBinary(binaryPath);
      }

      // Generate status lines
      const statusLines = spec.getStatusLines
        ? spec.getStatusLines({ cfg, configured, binaryDetected })
        : [`${spec.label}: ${configured ? "configured" : "needs setup"}`];

      // Selection hint
      const selectionHint = spec.getSelectionHint
        ? spec.getSelectionHint({ configured, binaryDetected })
        : configured
          ? "configured"
          : "needs setup";

      // Quickstart score
      const quickstartScore = spec.getQuickstartScore
        ? spec.getQuickstartScore({ configured, binaryDetected })
        : configured
          ? 1
          : 0;

      return {
        channel: spec.channel,
        configured,
        statusLines,
        selectionHint,
        quickstartScore,
      };
    },

    configure: async (ctx: ChannelOnboardingConfigureContext): Promise<ChannelOnboardingResult> => {
      // If custom configure is provided, use it
      if (spec.customConfigure) {
        return spec.customConfigure(ctx);
      }

      const { cfg, prompter, accountOverrides, shouldPromptAccountIds, forceAllowFrom } = ctx;

      // Resolve account ID
      const channelOverride = accountOverrides[spec.channel]?.trim();
      const defaultAccountId = spec.resolveDefaultAccountId(cfg);
      let accountId = channelOverride ? normalizeAccountId(channelOverride) : defaultAccountId;

      if (shouldPromptAccountIds && !channelOverride) {
        accountId = await promptAccountId({
          cfg,
          prompter,
          label: spec.label,
          currentId: accountId,
          listAccountIds: spec.listAccountIds,
          defaultAccountId,
        });
      }

      let next = cfg;

      // Show next steps note if provided
      if (spec.nextStepsNote) {
        await prompter.note(spec.nextStepsNote.join("\n"), `${spec.label} next steps`);
      }

      // Handle forceAllowFrom
      if (forceAllowFrom) {
        next = await promptAllowFromForSpec(spec as ChannelOnboardingSpec<TChannel>, {
          cfg: next,
          prompter,
          accountId,
        });
      }

      return { cfg: next, accountId };
    },

    dmPolicy,

    disable: (cfg: MoltbotConfig) => disableChannel(cfg, spec.channel),
  };
}

/**
 * Helper to set DM policy with wildcard for "open" mode.
 * Useful for channels that need this in their custom configure.
 */
export function setDmPolicyWithWildcard(
  cfg: MoltbotConfig,
  channel: ChannelId,
  dmPolicy: DmPolicy,
): MoltbotConfig {
  const channelCfg = cfg.channels?.[channel];
  const channelCfgObj = (channelCfg && typeof channelCfg === "object" ? channelCfg : {}) as Record<
    string,
    unknown
  >;
  const currentAllowFrom = channelCfgObj.allowFrom as Array<string | number> | undefined;
  const allowFrom = dmPolicy === "open" ? addWildcardAllowFrom(currentAllowFrom) : undefined;

  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [channel]: {
        ...channelCfgObj,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}
