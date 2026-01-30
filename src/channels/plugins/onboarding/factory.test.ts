import { describe, expect, it, vi } from "vitest";
import type { MoltbotConfig } from "../../../config/config.js";
import type { ChannelOnboardingStatusContext } from "../onboarding-types.js";
import {
  createChannelOnboardingAdapter,
  type AllowFromValidationResult,
  type ChannelOnboardingSpec,
} from "./factory.js";

// Mock detectBinary
vi.mock("../../../commands/onboard-helpers.js", () => ({
  detectBinary: vi.fn().mockResolvedValue(true),
}));

/**
 * Create a minimal test spec for the factory.
 */
function createTestSpec(
  overrides: Partial<ChannelOnboardingSpec<"signal">> = {},
): ChannelOnboardingSpec<"signal"> {
  return {
    channel: "signal",
    label: "Signal",
    listAccountIds: () => ["default"],
    resolveDefaultAccountId: () => "default",
    resolveAccount: () => ({
      config: {},
      configured: false,
    }),
    validateAllowFromEntry: (entry): AllowFromValidationResult => {
      if (!entry.trim()) return { error: "Empty entry" };
      return {};
    },
    allowFromExamples: ["+15555550123"],
    allowFromPlaceholder: "+15555550123",
    docsPath: "/signal",
    ...overrides,
  };
}

describe("createChannelOnboardingAdapter", () => {
  describe("getStatus", () => {
    it("returns channel status", async () => {
      const spec = createTestSpec({
        resolveAccount: () => ({
          config: {},
          configured: true,
        }),
      });
      const adapter = createChannelOnboardingAdapter(spec);
      const ctx: ChannelOnboardingStatusContext = {
        cfg: {},
        accountOverrides: {},
      };
      const status = await adapter.getStatus(ctx);
      expect(status.channel).toBe("signal");
      expect(status.configured).toBe(true);
    });

    it("uses custom getConfiguredStatus", async () => {
      const spec = createTestSpec({
        resolveAccount: () => ({
          config: {},
          configured: false,
        }),
        getConfiguredStatus: () => true,
      });
      const adapter = createChannelOnboardingAdapter(spec);
      const ctx: ChannelOnboardingStatusContext = {
        cfg: {},
        accountOverrides: {},
      };
      const status = await adapter.getStatus(ctx);
      expect(status.configured).toBe(true);
    });

    it("uses custom getStatusLines", async () => {
      const spec = createTestSpec({
        getStatusLines: () => ["Custom status line"],
      });
      const adapter = createChannelOnboardingAdapter(spec);
      const ctx: ChannelOnboardingStatusContext = {
        cfg: {},
        accountOverrides: {},
      };
      const status = await adapter.getStatus(ctx);
      expect(status.statusLines).toEqual(["Custom status line"]);
    });

    it("uses custom getSelectionHint", async () => {
      const spec = createTestSpec({
        getSelectionHint: () => "custom hint",
      });
      const adapter = createChannelOnboardingAdapter(spec);
      const ctx: ChannelOnboardingStatusContext = {
        cfg: {},
        accountOverrides: {},
      };
      const status = await adapter.getStatus(ctx);
      expect(status.selectionHint).toBe("custom hint");
    });

    it("uses custom getQuickstartScore", async () => {
      const spec = createTestSpec({
        getQuickstartScore: () => 42,
      });
      const adapter = createChannelOnboardingAdapter(spec);
      const ctx: ChannelOnboardingStatusContext = {
        cfg: {},
        accountOverrides: {},
      };
      const status = await adapter.getStatus(ctx);
      expect(status.quickstartScore).toBe(42);
    });

    it("respects account override", async () => {
      const resolveAccountMock = vi.fn().mockReturnValue({
        config: {},
        configured: true,
      });
      const spec = createTestSpec({
        resolveAccount: resolveAccountMock,
      });
      const adapter = createChannelOnboardingAdapter(spec);
      const ctx: ChannelOnboardingStatusContext = {
        cfg: {},
        accountOverrides: { signal: "work" },
      };
      await adapter.getStatus(ctx);
      expect(resolveAccountMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "work",
        }),
      );
    });
  });

  describe("dmPolicy", () => {
    it("creates dmPolicy object", () => {
      const spec = createTestSpec();
      const adapter = createChannelOnboardingAdapter(spec);
      expect(adapter.dmPolicy).toBeDefined();
      expect(adapter.dmPolicy?.label).toBe("Signal");
      expect(adapter.dmPolicy?.channel).toBe("signal");
      expect(adapter.dmPolicy?.policyKey).toBe("channels.signal.dmPolicy");
      expect(adapter.dmPolicy?.allowFromKey).toBe("channels.signal.allowFrom");
    });

    it("getCurrent returns default pairing", () => {
      const spec = createTestSpec();
      const adapter = createChannelOnboardingAdapter(spec);
      const cfg: MoltbotConfig = {};
      expect(adapter.dmPolicy?.getCurrent(cfg)).toBe("pairing");
    });

    it("getCurrent returns configured policy", () => {
      const spec = createTestSpec();
      const adapter = createChannelOnboardingAdapter(spec);
      const cfg: MoltbotConfig = {
        channels: {
          signal: {
            dmPolicy: "allowlist",
          },
        },
      };
      expect(adapter.dmPolicy?.getCurrent(cfg)).toBe("allowlist");
    });

    it("setPolicy updates config", () => {
      const spec = createTestSpec();
      const adapter = createChannelOnboardingAdapter(spec);
      const cfg: MoltbotConfig = {};
      const result = adapter.dmPolicy?.setPolicy(cfg, "allowlist");
      expect(result?.channels?.signal?.dmPolicy).toBe("allowlist");
    });
  });

  describe("disable", () => {
    it("disables channel", () => {
      const spec = createTestSpec();
      const adapter = createChannelOnboardingAdapter(spec);
      const cfg: MoltbotConfig = {
        channels: {
          signal: {
            enabled: true,
          },
        },
      };
      const result = adapter.disable?.(cfg);
      expect(result?.channels?.signal?.enabled).toBe(false);
    });
  });
});

describe("AllowFromValidationResult", () => {
  it("allows normalized values", () => {
    const validateEntry = (entry: string): AllowFromValidationResult => {
      if (entry.startsWith("+")) {
        return { normalized: entry.toUpperCase() };
      }
      return { error: "Must start with +" };
    };

    expect(validateEntry("+123")).toEqual({ normalized: "+123" });
    expect(validateEntry("123")).toEqual({ error: "Must start with +" });
  });
});
