import { detectBinary } from "../../../commands/onboard-helpers.js";
import { installSignalCli } from "../../../commands/signal-install.js";
import type { SignalAccountConfig } from "../../../config/types.js";
import { normalizeAccountId } from "../../../routing/session-key.js";
import {
  listSignalAccountIds,
  resolveDefaultSignalAccountId,
  resolveSignalAccount,
} from "../../../signal/accounts.js";
import { formatDocsLink } from "../../../terminal/links.js";
import { formatCliCommand } from "../../../cli/command-format.js";
import { normalizeE164 } from "../../../utils.js";
import type { ChannelOnboardingAdapter } from "../onboarding-types.js";
import { setChannelProperty } from "./common.js";
import {
  createChannelOnboardingAdapter,
  type AllowFromValidationResult,
  type ChannelOnboardingSpec,
} from "./factory.js";
import { promptAccountId } from "./helpers.js";

const channel = "signal" as const;

/**
 * Check if a string looks like a UUID.
 */
function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Validate a Signal allowFrom entry.
 * Supports:
 * - E.164 phone numbers (+15555550123)
 * - UUID entries (uuid:123e4567-e89b-12d3-a456-426614174000)
 * - Raw UUIDs (detected and normalized to uuid: prefix)
 */
function validateSignalAllowFromEntry(entry: string): AllowFromValidationResult {
  const trimmed = entry.trim();
  if (!trimmed) return { error: "Empty entry" };

  // Wildcard
  if (trimmed === "*") return {};

  // UUID with prefix
  if (trimmed.toLowerCase().startsWith("uuid:")) {
    const uuid = trimmed.slice("uuid:".length).trim();
    if (!uuid) {
      return { error: "Invalid uuid entry" };
    }
    return { normalized: `uuid:${uuid}` };
  }

  // Raw UUID (looks like UUID without prefix)
  if (isUuidLike(trimmed)) {
    return { normalized: `uuid:${trimmed}` };
  }

  // E.164 phone number
  const normalized = normalizeE164(trimmed);
  if (!normalized) {
    return { error: `Invalid entry: ${entry}` };
  }

  return { normalized };
}

/**
 * Normalize a Signal allowFrom entry.
 */
function normalizeSignalAllowFromEntry(entry: string): string {
  const trimmed = entry.trim();
  if (trimmed === "*") return "*";
  if (trimmed.toLowerCase().startsWith("uuid:")) {
    return `uuid:${trimmed.slice(5).trim()}`;
  }
  if (isUuidLike(trimmed)) {
    return `uuid:${trimmed}`;
  }
  return normalizeE164(trimmed) ?? trimmed;
}

/**
 * Signal onboarding spec for the factory.
 */
const signalOnboardingSpec: ChannelOnboardingSpec<"signal", SignalAccountConfig> = {
  channel,
  label: "Signal",

  // Account management
  listAccountIds: listSignalAccountIds,
  resolveDefaultAccountId: resolveDefaultSignalAccountId,
  resolveAccount: ({ cfg, accountId }) => {
    const resolved = resolveSignalAccount({ cfg, accountId });
    return {
      config: resolved.config,
      configured: resolved.configured,
    };
  },

  // Binary detection
  binaryName: "signal-cli",
  getBinaryPath: (_cfg, accountConfig) => accountConfig.cliPath ?? "signal-cli",

  // Status display
  getStatusLines: ({ cfg, configured, binaryDetected }) => {
    const cliPath = cfg.channels?.signal?.cliPath ?? "signal-cli";
    return [
      `Signal: ${configured ? "configured" : "needs setup"}`,
      `signal-cli: ${binaryDetected ? "found" : "missing"} (${cliPath})`,
    ];
  },
  getSelectionHint: ({ binaryDetected }) =>
    binaryDetected ? "signal-cli found" : "signal-cli missing",
  getQuickstartScore: ({ binaryDetected }) => (binaryDetected ? 1 : 0),

  // AllowFrom validation
  validateAllowFromEntry: validateSignalAllowFromEntry,
  normalizeAllowFromEntry: normalizeSignalAllowFromEntry,
  allowFromExamples: ["+15555550123", "uuid:123e4567-e89b-12d3-a456-426614174000"],
  allowFromPlaceholder: "+15555550123, uuid:123e4567-e89b-12d3-a456-426614174000",
  allowFromHelpNote: [
    "Allowlist Signal DMs by sender id.",
    "Examples:",
    "- +15555550123",
    "- uuid:123e4567-e89b-12d3-a456-426614174000",
    "Multiple entries: comma-separated.",
  ],

  // Docs
  docsPath: "/signal",

  // Custom configure to handle signal-cli installation
  customConfigure: async ({
    cfg,
    runtime,
    prompter,
    accountOverrides,
    shouldPromptAccountIds,
    options,
  }) => {
    const signalOverride = accountOverrides.signal?.trim();
    const defaultSignalAccountId = resolveDefaultSignalAccountId(cfg);
    let signalAccountId = signalOverride
      ? normalizeAccountId(signalOverride)
      : defaultSignalAccountId;

    if (shouldPromptAccountIds && !signalOverride) {
      signalAccountId = await promptAccountId({
        cfg,
        prompter,
        label: "Signal",
        currentId: signalAccountId,
        listAccountIds: listSignalAccountIds,
        defaultAccountId: defaultSignalAccountId,
      });
    }

    let next = cfg;
    const resolvedAccount = resolveSignalAccount({
      cfg: next,
      accountId: signalAccountId,
    });
    const accountConfig = resolvedAccount.config;
    let resolvedCliPath = accountConfig.cliPath ?? "signal-cli";
    let cliDetected = await detectBinary(resolvedCliPath);

    // Offer to install signal-cli
    if (options?.allowSignalInstall) {
      const wantsInstall = await prompter.confirm({
        message: cliDetected
          ? "signal-cli detected. Reinstall/update now?"
          : "signal-cli not found. Install now?",
        initialValue: !cliDetected,
      });
      if (wantsInstall) {
        try {
          const result = await installSignalCli(runtime);
          if (result.ok && result.cliPath) {
            cliDetected = true;
            resolvedCliPath = result.cliPath;
            await prompter.note(`Installed signal-cli at ${result.cliPath}`, "Signal");
          } else if (!result.ok) {
            await prompter.note(result.error ?? "signal-cli install failed.", "Signal");
          }
        } catch (err) {
          await prompter.note(`signal-cli install failed: ${String(err)}`, "Signal");
        }
      }
    }

    if (!cliDetected) {
      await prompter.note(
        "signal-cli not found. Install it, then rerun this step or set channels.signal.cliPath.",
        "Signal",
      );
    }

    // Prompt for Signal account (phone number)
    let account = accountConfig.account ?? "";
    if (account) {
      const keep = await prompter.confirm({
        message: `Signal account set (${account}). Keep it?`,
        initialValue: true,
      });
      if (!keep) account = "";
    }

    if (!account) {
      account = String(
        await prompter.text({
          message: "Signal bot number (E.164)",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }

    if (account) {
      next = setChannelProperty(next, channel, signalAccountId, {
        enabled: true,
        account,
        cliPath: resolvedCliPath ?? "signal-cli",
      });
    }

    await prompter.note(
      [
        'Link device with: signal-cli link -n "Moltbot"',
        "Scan QR in Signal → Linked Devices",
        `Then run: ${formatCliCommand("moltbot gateway call channels.status --params '{\"probe\":true}'")}`,
        `Docs: ${formatDocsLink("/signal", "signal")}`,
      ].join("\n"),
      "Signal next steps",
    );

    return { cfg: next, accountId: signalAccountId };
  },
};

/**
 * Signal onboarding adapter created via factory.
 */
export const signalOnboardingAdapter: ChannelOnboardingAdapter =
  createChannelOnboardingAdapter(signalOnboardingSpec);
