import { detectBinary } from "../../../commands/onboard-helpers.js";
import type { IMessageAccountConfig } from "../../../config/types.js";
import {
  listIMessageAccountIds,
  resolveDefaultIMessageAccountId,
  resolveIMessageAccount,
} from "../../../imessage/accounts.js";
import { normalizeIMessageHandle } from "../../../imessage/targets.js";
import { normalizeAccountId } from "../../../routing/session-key.js";
import { formatDocsLink } from "../../../terminal/links.js";
import type { ChannelOnboardingAdapter } from "../onboarding-types.js";
import { setChannelProperty } from "./common.js";
import {
  createChannelOnboardingAdapter,
  type AllowFromValidationResult,
  type ChannelOnboardingSpec,
} from "./factory.js";
import { promptAccountId } from "./helpers.js";

const channel = "imessage" as const;

/**
 * Validate an iMessage allowFrom entry.
 * Supports:
 * - Phone numbers (E.164)
 * - Email addresses
 * - chat_id:123
 * - chat_guid:...
 * - chat_identifier:...
 */
function validateIMessageAllowFromEntry(entry: string): AllowFromValidationResult {
  const trimmed = entry.trim();
  if (!trimmed) return { error: "Empty entry" };

  // Wildcard
  if (trimmed === "*") return {};

  // chat_id:123
  if (trimmed.toLowerCase().startsWith("chat_id:")) {
    const id = trimmed.slice("chat_id:".length).trim();
    if (!/^\d+$/.test(id)) {
      return { error: `Invalid chat_id: ${entry}` };
    }
    return { normalized: `chat_id:${id}` };
  }

  // chat_guid:...
  if (trimmed.toLowerCase().startsWith("chat_guid:")) {
    const guid = trimmed.slice("chat_guid:".length).trim();
    if (!guid) {
      return { error: "Invalid chat_guid entry" };
    }
    return { normalized: `chat_guid:${guid}` };
  }

  // chat_identifier:...
  if (trimmed.toLowerCase().startsWith("chat_identifier:")) {
    const identifier = trimmed.slice("chat_identifier:".length).trim();
    if (!identifier) {
      return { error: "Invalid chat_identifier entry" };
    }
    return { normalized: `chat_identifier:${identifier}` };
  }

  // Handle (phone number or email)
  const normalized = normalizeIMessageHandle(trimmed);
  if (!normalized) {
    return { error: `Invalid handle: ${entry}` };
  }

  return { normalized };
}

/**
 * iMessage onboarding spec for the factory.
 */
const imessageOnboardingSpec: ChannelOnboardingSpec<"imessage", IMessageAccountConfig> = {
  channel,
  label: "iMessage",

  // Account management
  listAccountIds: listIMessageAccountIds,
  resolveDefaultAccountId: resolveDefaultIMessageAccountId,
  resolveAccount: ({ cfg, accountId }) => {
    const resolved = resolveIMessageAccount({ cfg, accountId });
    return {
      config: resolved.config,
      configured: resolved.configured,
    };
  },

  // Binary detection
  binaryName: "imsg",
  getBinaryPath: (_cfg, accountConfig) => accountConfig.cliPath ?? "imsg",

  // Status display
  getStatusLines: ({ configured, binaryDetected }) => {
    const lines = [`iMessage: ${configured ? "configured" : "needs setup"}`];
    if (binaryDetected !== undefined) {
      lines.push(`imsg: ${binaryDetected ? "found" : "missing"}`);
    }
    return lines;
  },
  getSelectionHint: ({ binaryDetected }) => (binaryDetected ? "imsg found" : "imsg missing"),
  getQuickstartScore: ({ binaryDetected }) => (binaryDetected ? 1 : 0),

  // AllowFrom validation
  validateAllowFromEntry: validateIMessageAllowFromEntry,
  allowFromExamples: [
    "+15555550123",
    "user@example.com",
    "chat_id:123",
    "chat_guid:... or chat_identifier:...",
  ],
  allowFromPlaceholder: "+15555550123, user@example.com, chat_id:123",
  allowFromHelpNote: [
    "Allowlist iMessage DMs by handle or chat target.",
    "Examples:",
    "- +15555550123",
    "- user@example.com",
    "- chat_id:123",
    "- chat_guid:... or chat_identifier:...",
    "Multiple entries: comma-separated.",
  ],

  // Docs
  docsPath: "/imessage",
  nextStepsNote: [
    "This is still a work in progress.",
    "Ensure Moltbot has Full Disk Access to Messages DB.",
    "Grant Automation permission for Messages when prompted.",
    "List chats with: imsg chats --limit 20",
  ],

  // Custom configure to handle CLI path prompting
  customConfigure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const imessageOverride = accountOverrides.imessage?.trim();
    const defaultIMessageAccountId = resolveDefaultIMessageAccountId(cfg);
    let imessageAccountId = imessageOverride
      ? normalizeAccountId(imessageOverride)
      : defaultIMessageAccountId;

    if (shouldPromptAccountIds && !imessageOverride) {
      imessageAccountId = await promptAccountId({
        cfg,
        prompter,
        label: "iMessage",
        currentId: imessageAccountId,
        listAccountIds: listIMessageAccountIds,
        defaultAccountId: defaultIMessageAccountId,
      });
    }

    let next = cfg;
    const resolvedAccount = resolveIMessageAccount({
      cfg: next,
      accountId: imessageAccountId,
    });

    let resolvedCliPath = resolvedAccount.config.cliPath ?? "imsg";
    const cliDetected = await detectBinary(resolvedCliPath);

    if (!cliDetected) {
      const entered = await prompter.text({
        message: "imsg CLI path",
        initialValue: resolvedCliPath,
        validate: (value) => (value?.trim() ? undefined : "Required"),
      });
      resolvedCliPath = String(entered).trim();
      if (!resolvedCliPath) {
        await prompter.note("imsg CLI path required to enable iMessage.", "iMessage");
      }
    }

    if (resolvedCliPath) {
      next = setChannelProperty(next, channel, imessageAccountId, {
        enabled: true,
        cliPath: resolvedCliPath,
      });
    }

    await prompter.note(
      [
        "This is still a work in progress.",
        "Ensure Moltbot has Full Disk Access to Messages DB.",
        "Grant Automation permission for Messages when prompted.",
        "List chats with: imsg chats --limit 20",
        `Docs: ${formatDocsLink("/imessage", "imessage")}`,
      ].join("\n"),
      "iMessage next steps",
    );

    return { cfg: next, accountId: imessageAccountId };
  },
};

/**
 * iMessage onboarding adapter created via factory.
 */
export const imessageOnboardingAdapter: ChannelOnboardingAdapter =
  createChannelOnboardingAdapter(imessageOnboardingSpec);
