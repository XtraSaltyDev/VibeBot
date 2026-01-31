import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { VoiceCallConfigSchema } from "./config.js";
import { CallManager } from "./manager.js";
import type {
  HangupCallInput,
  InitiateCallInput,
  InitiateCallResult,
  PlayTtsInput,
  ProviderWebhookParseResult,
  StartListeningInput,
  StopListeningInput,
  WebhookContext,
  WebhookVerificationResult,
} from "./types.js";
import type { VoiceCallProvider } from "./providers/base.js";

class FakeProvider implements VoiceCallProvider {
  readonly name = "plivo" as const;
  readonly playTtsCalls: PlayTtsInput[] = [];
  readonly hangupCalls: HangupCallInput[] = [];

  verifyWebhook(_ctx: WebhookContext): WebhookVerificationResult {
    return { ok: true };
  }
  parseWebhookEvent(_ctx: WebhookContext): ProviderWebhookParseResult {
    return { events: [], statusCode: 200 };
  }
  async initiateCall(_input: InitiateCallInput): Promise<InitiateCallResult> {
    return { providerCallId: "request-uuid", status: "initiated" };
  }
  async hangupCall(input: HangupCallInput): Promise<void> {
    this.hangupCalls.push(input);
  }
  async playTts(input: PlayTtsInput): Promise<void> {
    this.playTtsCalls.push(input);
  }
  async startListening(_input: StartListeningInput): Promise<void> {}
  async stopListening(_input: StopListeningInput): Promise<void> {}
}

describe("CallManager", () => {
  it("upgrades providerCallId mapping when provider ID changes", async () => {
    const config = VoiceCallConfigSchema.parse({
      enabled: true,
      provider: "plivo",
      fromNumber: "+15550000000",
    });

    const storePath = path.join(os.tmpdir(), `moltbot-voice-call-test-${Date.now()}`);
    const manager = new CallManager(config, storePath);
    manager.initialize(new FakeProvider(), "https://example.com/voice/webhook");

    const { callId, success, error } = await manager.initiateCall("+15550000001");
    expect(success).toBe(true);
    expect(error).toBeUndefined();

    // The provider returned a request UUID as the initial providerCallId.
    expect(manager.getCall(callId)?.providerCallId).toBe("request-uuid");
    expect(manager.getCallByProviderCallId("request-uuid")?.callId).toBe(callId);

    // Provider later reports the actual call UUID.
    manager.processEvent({
      id: "evt-1",
      type: "call.answered",
      callId,
      providerCallId: "call-uuid",
      timestamp: Date.now(),
    });

    expect(manager.getCall(callId)?.providerCallId).toBe("call-uuid");
    expect(manager.getCallByProviderCallId("call-uuid")?.callId).toBe(callId);
    expect(manager.getCallByProviderCallId("request-uuid")).toBeUndefined();
  });

  it("speaks initial message on answered for notify mode (non-Twilio)", async () => {
    const config = VoiceCallConfigSchema.parse({
      enabled: true,
      provider: "plivo",
      fromNumber: "+15550000000",
    });

    const storePath = path.join(os.tmpdir(), `moltbot-voice-call-test-${Date.now()}`);
    const provider = new FakeProvider();
    const manager = new CallManager(config, storePath);
    manager.initialize(provider, "https://example.com/voice/webhook");

    const { callId, success } = await manager.initiateCall(
      "+15550000002",
      undefined,
      { message: "Hello there", mode: "notify" },
    );
    expect(success).toBe(true);

    manager.processEvent({
      id: "evt-2",
      type: "call.answered",
      callId,
      providerCallId: "call-uuid",
      timestamp: Date.now(),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provider.playTtsCalls).toHaveLength(1);
    expect(provider.playTtsCalls[0]?.text).toBe("Hello there");
  });

  it("hangs up inbound calls from numbers not in allowlist", async () => {
    const config = VoiceCallConfigSchema.parse({
      enabled: true,
      provider: "plivo",
      fromNumber: "+15550000000",
      inboundPolicy: "allowlist",
      allowFrom: ["+15551234567"],
    });

    const storePath = path.join(os.tmpdir(), `moltbot-voice-call-test-${Date.now()}`);
    const provider = new FakeProvider();
    const manager = new CallManager(config, storePath);
    manager.initialize(provider, "https://example.com/voice/webhook");

    // Inbound call from a number NOT in the allowlist
    manager.processEvent({
      id: "evt-inbound-rejected",
      type: "call.ringing",
      callId: "inbound-call-id",
      providerCallId: "provider-call-123",
      direction: "inbound",
      from: "+15559999999",
      to: "+15550000000",
      timestamp: Date.now(),
    });

    // Allow async hangup call to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(provider.hangupCalls).toHaveLength(1);
    expect(provider.hangupCalls[0]?.providerCallId).toBe("provider-call-123");
    expect(provider.hangupCalls[0]?.reason).toBe("hangup-bot");

    // Call should not be tracked since it was rejected
    expect(manager.getCallByProviderCallId("provider-call-123")).toBeUndefined();
  });

  it("accepts inbound calls from numbers in allowlist", async () => {
    const config = VoiceCallConfigSchema.parse({
      enabled: true,
      provider: "plivo",
      fromNumber: "+15550000000",
      inboundPolicy: "allowlist",
      allowFrom: ["+15551234567"],
    });

    const storePath = path.join(os.tmpdir(), `moltbot-voice-call-test-${Date.now()}`);
    const provider = new FakeProvider();
    const manager = new CallManager(config, storePath);
    manager.initialize(provider, "https://example.com/voice/webhook");

    // Inbound call from a number IN the allowlist
    manager.processEvent({
      id: "evt-inbound-accepted",
      type: "call.ringing",
      callId: "inbound-call-id-2",
      providerCallId: "provider-call-456",
      direction: "inbound",
      from: "+15551234567",
      to: "+15550000000",
      timestamp: Date.now(),
    });

    // Allow async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Hangup should NOT be called
    expect(provider.hangupCalls).toHaveLength(0);

    // Call should be tracked
    const call = manager.getCallByProviderCallId("provider-call-456");
    expect(call).toBeDefined();
    expect(call?.from).toBe("+15551234567");
  });
});
