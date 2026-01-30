import { createRequire } from "node:module";

import {
  chunkByNewline,
  chunkMarkdownText,
  chunkMarkdownTextWithMode,
  chunkText,
  chunkTextWithMode,
  resolveChunkMode,
  resolveTextChunkLimit,
} from "../../auto-reply/chunk.js";
import {
  hasControlCommand,
  isControlCommandMessage,
  shouldComputeCommandAuthorized,
} from "../../auto-reply/command-detection.js";
import { shouldHandleTextCommands } from "../../auto-reply/commands-registry.js";
import {
  createInboundDebouncer,
  resolveInboundDebounceMs,
} from "../../auto-reply/inbound-debounce.js";
import {
  formatAgentEnvelope,
  formatInboundEnvelope,
  resolveEnvelopeFormatOptions,
} from "../../auto-reply/envelope.js";
import { dispatchReplyFromConfig } from "../../auto-reply/reply/dispatch-from-config.js";
import {
  buildMentionRegexes,
  matchesMentionPatterns,
  matchesMentionWithExplicit,
} from "../../auto-reply/reply/mentions.js";
import { dispatchReplyWithBufferedBlockDispatcher } from "../../auto-reply/reply/provider-dispatcher.js";
import { createReplyDispatcherWithTyping } from "../../auto-reply/reply/reply-dispatcher.js";
import { finalizeInboundContext } from "../../auto-reply/reply/inbound-context.js";
import { resolveEffectiveMessagesConfig, resolveHumanDelayConfig } from "../../agents/identity.js";
import { createMemoryGetTool, createMemorySearchTool } from "../../agents/tools/memory-tool.js";
import { removeAckReactionAfterReply, shouldAckReaction } from "../../channels/ack-reactions.js";
import { resolveCommandAuthorizedFromAuthorizers } from "../../channels/command-gating.js";
import { recordInboundSession } from "../../channels/session.js";
import { discordMessageActions } from "../../channels/plugins/actions/discord.js";
import { signalMessageActions } from "../../channels/plugins/actions/signal.js";
import { telegramMessageActions } from "../../channels/plugins/actions/telegram.js";
import { createWhatsAppLoginTool } from "../../channels/plugins/agent-tools/whatsapp-login.js";
import {
  resolveChannelGroupPolicy,
  resolveChannelGroupRequireMention,
} from "../../config/group-policy.js";
import { resolveMarkdownTableMode } from "../../config/markdown-tables.js";
import { resolveStateDir } from "../../config/paths.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import {
  readSessionUpdatedAt,
  recordSessionMetaFromInbound,
  resolveStorePath,
  updateLastRoute,
} from "../../config/sessions.js";
import { getChannelActivity, recordChannelActivity } from "../../infra/channel-activity.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { shouldLogVerbose } from "../../globals.js";
import { convertMarkdownTables } from "../../markdown/tables.js";
import { getChildLogger } from "../../logging.js";
import { normalizeLogLevel } from "../../logging/levels.js";
import { isVoiceCompatibleAudio } from "../../media/audio.js";
import { mediaKindFromMime } from "../../media/constants.js";
import { fetchRemoteMedia } from "../../media/fetch.js";
import { getImageMetadata, resizeToJpeg } from "../../media/image-ops.js";
import { detectMime } from "../../media/mime.js";
import { saveMediaBuffer } from "../../media/store.js";
import { buildPairingReply } from "../../pairing/pairing-messages.js";
import {
  readChannelAllowFromStore,
  upsertChannelPairingRequest,
} from "../../pairing/pairing-store.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { resolveAgentRoute } from "../../routing/resolve-route.js";
import {
  auditTelegramGroupMembership,
  collectTelegramUnmentionedGroupIds,
} from "../../telegram/audit.js";
import { resolveTelegramToken } from "../../telegram/token.js";
import { loadWebMedia } from "../../web/media.js";
import { getActiveWebListener } from "../../web/active-listener.js";
import {
  getWebAuthAgeMs,
  logoutWeb,
  logWebSelfId,
  readWebSelfId,
  webAuthExists,
} from "../../web/auth-store.js";
import { sendMessageWhatsApp, sendPollWhatsApp } from "../../web/outbound.js";
import { registerMemoryCli } from "../../cli/memory-cli.js";
import { formatNativeDependencyHint } from "./native-deps.js";
import { textToSpeechTelephony } from "../../tts/tts.js";
import {
  listLineAccountIds,
  normalizeAccountId as normalizeLineAccountId,
  resolveDefaultLineAccountId,
  resolveLineAccount,
} from "../../line/accounts.js";
import { buildTemplateMessageFromPayload } from "../../line/template-messages.js";
import { createQuickReplyItems } from "../../line/quick-replies.js";

import type { PluginRuntime } from "./types.js";

let cachedVersion: string | null = null;

function resolveVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../../package.json") as { version?: string };
    cachedVersion = pkg.version ?? "unknown";
    return cachedVersion;
  } catch {
    cachedVersion = "unknown";
    return cachedVersion;
  }
}

// Lazily load heavy channel adapters (Slack, Telegram, WhatsApp, LINE, etc.).
const lazyImport = <T>(loader: () => Promise<T>) => {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) cached = loader();
    return cached;
  };
};

const lazyAsync = <TModule, TFunc extends (...args: never[]) => Promise<unknown>>(
  loader: () => Promise<TModule>,
  pick: (mod: TModule) => TFunc,
): TFunc => {
  const load = lazyImport(loader);
  return (async (...args: Parameters<TFunc>) => {
    const mod = await load();
    return await pick(mod)(...args);
  }) as TFunc;
};

const loadDiscordIndex = lazyImport(() => import("../../discord/index.js"));
const loadDiscordAudit = lazyImport(() => import("../../discord/audit.js"));
const loadDiscordDirectory = lazyImport(() => import("../../discord/directory-live.js"));
const loadDiscordProbe = lazyImport(() => import("../../discord/probe.js"));
const loadDiscordResolveChannels = lazyImport(() => import("../../discord/resolve-channels.js"));
const loadDiscordResolveUsers = lazyImport(() => import("../../discord/resolve-users.js"));

const auditDiscordChannelPermissions: typeof import("../../discord/audit.js").auditDiscordChannelPermissions =
  lazyAsync(loadDiscordAudit, (mod) => mod.auditDiscordChannelPermissions);
const listDiscordDirectoryGroupsLive: typeof import("../../discord/directory-live.js").listDiscordDirectoryGroupsLive =
  lazyAsync(loadDiscordDirectory, (mod) => mod.listDiscordDirectoryGroupsLive);
const listDiscordDirectoryPeersLive: typeof import("../../discord/directory-live.js").listDiscordDirectoryPeersLive =
  lazyAsync(loadDiscordDirectory, (mod) => mod.listDiscordDirectoryPeersLive);
const probeDiscord: typeof import("../../discord/probe.js").probeDiscord = lazyAsync(
  loadDiscordProbe,
  (mod) => mod.probeDiscord,
);
const resolveDiscordChannelAllowlist: typeof import("../../discord/resolve-channels.js").resolveDiscordChannelAllowlist =
  lazyAsync(loadDiscordResolveChannels, (mod) => mod.resolveDiscordChannelAllowlist);
const resolveDiscordUserAllowlist: typeof import("../../discord/resolve-users.js").resolveDiscordUserAllowlist =
  lazyAsync(loadDiscordResolveUsers, (mod) => mod.resolveDiscordUserAllowlist);
const sendMessageDiscord: typeof import("../../discord/index.js").sendMessageDiscord = lazyAsync(
  loadDiscordIndex,
  (mod) => mod.sendMessageDiscord,
);
const sendPollDiscord: typeof import("../../discord/index.js").sendPollDiscord = lazyAsync(
  loadDiscordIndex,
  (mod) => mod.sendPollDiscord,
);
const monitorDiscordProvider: typeof import("../../discord/index.js").monitorDiscordProvider =
  lazyAsync(loadDiscordIndex, (mod) => mod.monitorDiscordProvider);

const loadSlackIndex = lazyImport(() => import("../../slack/index.js"));
const loadSlackDirectory = lazyImport(() => import("../../slack/directory-live.js"));
const loadSlackResolveChannels = lazyImport(() => import("../../slack/resolve-channels.js"));
const loadSlackResolveUsers = lazyImport(() => import("../../slack/resolve-users.js"));
const loadSlackActions = lazyImport(() => import("../../agents/tools/slack-actions.js"));

const listSlackDirectoryGroupsLive: typeof import("../../slack/directory-live.js").listSlackDirectoryGroupsLive =
  lazyAsync(loadSlackDirectory, (mod) => mod.listSlackDirectoryGroupsLive);
const listSlackDirectoryPeersLive: typeof import("../../slack/directory-live.js").listSlackDirectoryPeersLive =
  lazyAsync(loadSlackDirectory, (mod) => mod.listSlackDirectoryPeersLive);
const probeSlack: typeof import("../../slack/index.js").probeSlack = lazyAsync(
  loadSlackIndex,
  (mod) => mod.probeSlack,
);
const resolveSlackChannelAllowlist: typeof import("../../slack/resolve-channels.js").resolveSlackChannelAllowlist =
  lazyAsync(loadSlackResolveChannels, (mod) => mod.resolveSlackChannelAllowlist);
const resolveSlackUserAllowlist: typeof import("../../slack/resolve-users.js").resolveSlackUserAllowlist =
  lazyAsync(loadSlackResolveUsers, (mod) => mod.resolveSlackUserAllowlist);
const sendMessageSlack: typeof import("../../slack/index.js").sendMessageSlack = lazyAsync(
  loadSlackIndex,
  (mod) => mod.sendMessageSlack,
);
const monitorSlackProvider: typeof import("../../slack/index.js").monitorSlackProvider = lazyAsync(
  loadSlackIndex,
  (mod) => mod.monitorSlackProvider,
);
const handleSlackAction: typeof import("../../agents/tools/slack-actions.js").handleSlackAction =
  lazyAsync(loadSlackActions, (mod) => mod.handleSlackAction);

const loadTelegramIndex = lazyImport(() => import("../../telegram/index.js"));
const loadTelegramProbe = lazyImport(() => import("../../telegram/probe.js"));

const probeTelegram: typeof import("../../telegram/probe.js").probeTelegram = lazyAsync(
  loadTelegramProbe,
  (mod) => mod.probeTelegram,
);
const sendMessageTelegram: typeof import("../../telegram/index.js").sendMessageTelegram = lazyAsync(
  loadTelegramIndex,
  (mod) => mod.sendMessageTelegram,
);
const monitorTelegramProvider: typeof import("../../telegram/index.js").monitorTelegramProvider =
  lazyAsync(loadTelegramIndex, (mod) => mod.monitorTelegramProvider);

const loadSignalIndex = lazyImport(() => import("../../signal/index.js"));
const probeSignal: typeof import("../../signal/index.js").probeSignal = lazyAsync(
  loadSignalIndex,
  (mod) => mod.probeSignal,
);
const sendMessageSignal: typeof import("../../signal/index.js").sendMessageSignal = lazyAsync(
  loadSignalIndex,
  (mod) => mod.sendMessageSignal,
);
const monitorSignalProvider: typeof import("../../signal/index.js").monitorSignalProvider =
  lazyAsync(loadSignalIndex, (mod) => mod.monitorSignalProvider);

const loadIMessageIndex = lazyImport(() => import("../../imessage/index.js"));
const monitorIMessageProvider: typeof import("../../imessage/index.js").monitorIMessageProvider =
  lazyAsync(loadIMessageIndex, (mod) => mod.monitorIMessageProvider);
const probeIMessage: typeof import("../../imessage/index.js").probeIMessage = lazyAsync(
  loadIMessageIndex,
  (mod) => mod.probeIMessage,
);
const sendMessageIMessage: typeof import("../../imessage/index.js").sendMessageIMessage = lazyAsync(
  loadIMessageIndex,
  (mod) => mod.sendMessageIMessage,
);

const loadWebChannel = lazyImport(() => import("../../channels/web/index.js"));
const loadWebLogin = lazyImport(() => import("../../web/login.js"));
const loadWebLoginQr = lazyImport(() => import("../../web/login-qr.js"));
const loadWhatsAppActions = lazyImport(() => import("../../agents/tools/whatsapp-actions.js"));

const monitorWebChannel: typeof import("../../channels/web/index.js").monitorWebChannel = lazyAsync(
  loadWebChannel,
  (mod) => mod.monitorWebChannel,
);
const loginWeb: typeof import("../../web/login.js").loginWeb = lazyAsync(
  loadWebLogin,
  (mod) => mod.loginWeb,
);
const startWebLoginWithQr: typeof import("../../web/login-qr.js").startWebLoginWithQr = lazyAsync(
  loadWebLoginQr,
  (mod) => mod.startWebLoginWithQr,
);
const waitForWebLogin: typeof import("../../web/login-qr.js").waitForWebLogin = lazyAsync(
  loadWebLoginQr,
  (mod) => mod.waitForWebLogin,
);
const handleWhatsAppAction: typeof import("../../agents/tools/whatsapp-actions.js").handleWhatsAppAction =
  lazyAsync(loadWhatsAppActions, (mod) => mod.handleWhatsAppAction);

const loadLineSend = lazyImport(() => import("../../line/send.js"));
const loadLineProbe = lazyImport(() => import("../../line/probe.js"));
const loadLineMonitor = lazyImport(() => import("../../line/monitor.js"));

const probeLineBot: typeof import("../../line/probe.js").probeLineBot = lazyAsync(
  loadLineProbe,
  (mod) => mod.probeLineBot,
);
const sendMessageLine: typeof import("../../line/send.js").sendMessageLine = lazyAsync(
  loadLineSend,
  (mod) => mod.sendMessageLine,
);
const pushMessageLine: typeof import("../../line/send.js").pushMessageLine = lazyAsync(
  loadLineSend,
  (mod) => mod.pushMessageLine,
);
const pushMessagesLine: typeof import("../../line/send.js").pushMessagesLine = lazyAsync(
  loadLineSend,
  (mod) => mod.pushMessagesLine,
);
const pushFlexMessage: typeof import("../../line/send.js").pushFlexMessage = lazyAsync(
  loadLineSend,
  (mod) => mod.pushFlexMessage,
);
const pushTemplateMessage: typeof import("../../line/send.js").pushTemplateMessage = lazyAsync(
  loadLineSend,
  (mod) => mod.pushTemplateMessage,
);
const pushLocationMessage: typeof import("../../line/send.js").pushLocationMessage = lazyAsync(
  loadLineSend,
  (mod) => mod.pushLocationMessage,
);
const pushTextMessageWithQuickReplies: typeof import("../../line/send.js").pushTextMessageWithQuickReplies =
  lazyAsync(loadLineSend, (mod) => mod.pushTextMessageWithQuickReplies);
const monitorLineProvider: typeof import("../../line/monitor.js").monitorLineProvider = lazyAsync(
  loadLineMonitor,
  (mod) => mod.monitorLineProvider,
);

export function createPluginRuntime(): PluginRuntime {
  return {
    version: resolveVersion(),
    config: {
      loadConfig,
      writeConfigFile,
    },
    system: {
      enqueueSystemEvent,
      runCommandWithTimeout,
      formatNativeDependencyHint,
    },
    media: {
      loadWebMedia,
      detectMime,
      mediaKindFromMime,
      isVoiceCompatibleAudio,
      getImageMetadata,
      resizeToJpeg,
    },
    tts: {
      textToSpeechTelephony,
    },
    tools: {
      createMemoryGetTool,
      createMemorySearchTool,
      registerMemoryCli,
    },
    channel: {
      text: {
        chunkByNewline,
        chunkMarkdownText,
        chunkMarkdownTextWithMode,
        chunkText,
        chunkTextWithMode,
        resolveChunkMode,
        resolveTextChunkLimit,
        hasControlCommand,
        resolveMarkdownTableMode,
        convertMarkdownTables,
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher,
        createReplyDispatcherWithTyping,
        resolveEffectiveMessagesConfig,
        resolveHumanDelayConfig,
        dispatchReplyFromConfig,
        finalizeInboundContext,
        formatAgentEnvelope,
        formatInboundEnvelope,
        resolveEnvelopeFormatOptions,
      },
      routing: {
        resolveAgentRoute,
      },
      pairing: {
        buildPairingReply,
        readAllowFromStore: readChannelAllowFromStore,
        upsertPairingRequest: upsertChannelPairingRequest,
      },
      media: {
        fetchRemoteMedia,
        saveMediaBuffer,
      },
      activity: {
        record: recordChannelActivity,
        get: getChannelActivity,
      },
      session: {
        resolveStorePath,
        readSessionUpdatedAt,
        recordSessionMetaFromInbound,
        recordInboundSession,
        updateLastRoute,
      },
      mentions: {
        buildMentionRegexes,
        matchesMentionPatterns,
        matchesMentionWithExplicit,
      },
      reactions: {
        shouldAckReaction,
        removeAckReactionAfterReply,
      },
      groups: {
        resolveGroupPolicy: resolveChannelGroupPolicy,
        resolveRequireMention: resolveChannelGroupRequireMention,
      },
      debounce: {
        createInboundDebouncer,
        resolveInboundDebounceMs,
      },
      commands: {
        resolveCommandAuthorizedFromAuthorizers,
        isControlCommandMessage,
        shouldComputeCommandAuthorized,
        shouldHandleTextCommands,
      },
      discord: {
        messageActions: discordMessageActions,
        auditChannelPermissions: auditDiscordChannelPermissions,
        listDirectoryGroupsLive: listDiscordDirectoryGroupsLive,
        listDirectoryPeersLive: listDiscordDirectoryPeersLive,
        probeDiscord,
        resolveChannelAllowlist: resolveDiscordChannelAllowlist,
        resolveUserAllowlist: resolveDiscordUserAllowlist,
        sendMessageDiscord,
        sendPollDiscord,
        monitorDiscordProvider,
      },
      slack: {
        listDirectoryGroupsLive: listSlackDirectoryGroupsLive,
        listDirectoryPeersLive: listSlackDirectoryPeersLive,
        probeSlack,
        resolveChannelAllowlist: resolveSlackChannelAllowlist,
        resolveUserAllowlist: resolveSlackUserAllowlist,
        sendMessageSlack,
        monitorSlackProvider,
        handleSlackAction,
      },
      telegram: {
        auditGroupMembership: auditTelegramGroupMembership,
        collectUnmentionedGroupIds: collectTelegramUnmentionedGroupIds,
        probeTelegram,
        resolveTelegramToken,
        sendMessageTelegram,
        monitorTelegramProvider,
        messageActions: telegramMessageActions,
      },
      signal: {
        probeSignal,
        sendMessageSignal,
        monitorSignalProvider,
        messageActions: signalMessageActions,
      },
      imessage: {
        monitorIMessageProvider,
        probeIMessage,
        sendMessageIMessage,
      },
      whatsapp: {
        getActiveWebListener,
        getWebAuthAgeMs,
        logoutWeb,
        logWebSelfId,
        readWebSelfId,
        webAuthExists,
        sendMessageWhatsApp,
        sendPollWhatsApp,
        loginWeb,
        startWebLoginWithQr,
        waitForWebLogin,
        monitorWebChannel,
        handleWhatsAppAction,
        createLoginTool: createWhatsAppLoginTool,
      },
      line: {
        listLineAccountIds,
        resolveDefaultLineAccountId,
        resolveLineAccount,
        normalizeAccountId: normalizeLineAccountId,
        probeLineBot,
        sendMessageLine,
        pushMessageLine,
        pushMessagesLine,
        pushFlexMessage,
        pushTemplateMessage,
        pushLocationMessage,
        pushTextMessageWithQuickReplies,
        createQuickReplyItems,
        buildTemplateMessageFromPayload,
        monitorLineProvider,
      },
    },
    logging: {
      shouldLogVerbose,
      getChildLogger: (bindings, opts) => {
        const logger = getChildLogger(bindings, {
          level: opts?.level ? normalizeLogLevel(opts.level) : undefined,
        });
        return {
          debug: (message) => logger.debug?.(message),
          info: (message) => logger.info(message),
          warn: (message) => logger.warn(message),
          error: (message) => logger.error(message),
        };
      },
    },
    state: {
      resolveStateDir,
    },
  };
}

export type { PluginRuntime } from "./types.js";
