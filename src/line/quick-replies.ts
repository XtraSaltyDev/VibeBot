import type { messagingApi } from "@line/bot-sdk";

type QuickReply = messagingApi.QuickReply;
type QuickReplyItem = messagingApi.QuickReplyItem;

/**
 * Create quick reply buttons to attach to a message.
 */
export function createQuickReplyItems(labels: string[]): QuickReply {
  const items: QuickReplyItem[] = labels.slice(0, 13).map((label) => ({
    type: "action",
    action: {
      type: "message",
      label: label.slice(0, 20), // LINE limit: 20 chars
      text: label,
    },
  }));
  return { items };
}
