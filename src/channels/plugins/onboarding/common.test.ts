import { describe, expect, it } from "vitest";
import type { MoltbotConfig } from "../../../config/config.js";
import {
  disableChannel,
  enableChannel,
  parseAllowFromInput,
  setChannelAllowFrom,
  setChannelDmPolicy,
  setChannelProperty,
} from "./common.js";

describe("parseAllowFromInput", () => {
  it("splits on commas", () => {
    expect(parseAllowFromInput("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("splits on semicolons", () => {
    expect(parseAllowFromInput("a;b;c")).toEqual(["a", "b", "c"]);
  });

  it("splits on newlines", () => {
    expect(parseAllowFromInput("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("handles mixed delimiters", () => {
    expect(parseAllowFromInput("a,b;c\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("trims whitespace", () => {
    expect(parseAllowFromInput("  a  ,  b  ")).toEqual(["a", "b"]);
  });

  it("filters empty entries", () => {
    expect(parseAllowFromInput("a,,b,")).toEqual(["a", "b"]);
  });

  it("handles empty string", () => {
    expect(parseAllowFromInput("")).toEqual([]);
  });
});

describe("setChannelDmPolicy", () => {
  const baseCfg: MoltbotConfig = {};

  it("sets dmPolicy on channel", () => {
    const result = setChannelDmPolicy(baseCfg, "signal", "allowlist");
    expect(result.channels?.signal?.dmPolicy).toBe("allowlist");
  });

  it("adds wildcard to allowFrom for open policy", () => {
    const result = setChannelDmPolicy(baseCfg, "signal", "open");
    expect(result.channels?.signal?.dmPolicy).toBe("open");
    expect(result.channels?.signal?.allowFrom).toContain("*");
  });

  it("preserves existing allowFrom when adding wildcard", () => {
    const cfg: MoltbotConfig = {
      channels: {
        signal: {
          allowFrom: ["+15555550123"],
        },
      },
    };
    const result = setChannelDmPolicy(cfg, "signal", "open");
    expect(result.channels?.signal?.allowFrom).toContain("+15555550123");
    expect(result.channels?.signal?.allowFrom).toContain("*");
  });

  it("does not add wildcard for non-open policies", () => {
    const result = setChannelDmPolicy(baseCfg, "signal", "pairing");
    expect(result.channels?.signal?.allowFrom).toBeUndefined();
  });
});

describe("setChannelAllowFrom", () => {
  const baseCfg: MoltbotConfig = {};

  it("sets allowFrom for default account", () => {
    const result = setChannelAllowFrom(baseCfg, "signal", "default", ["+15555550123"]);
    expect(result.channels?.signal?.allowFrom).toEqual(["+15555550123"]);
  });

  it("sets allowFrom for named account", () => {
    const result = setChannelAllowFrom(baseCfg, "signal", "work", ["+15555550123"]);
    expect(result.channels?.signal?.accounts?.work?.allowFrom).toEqual(["+15555550123"]);
  });

  it("preserves existing channel config", () => {
    const cfg: MoltbotConfig = {
      channels: {
        signal: {
          enabled: true,
          account: "+19995550123",
        },
      },
    };
    const result = setChannelAllowFrom(cfg, "signal", "default", ["+15555550123"]);
    expect(result.channels?.signal?.enabled).toBe(true);
    expect(result.channels?.signal?.account).toBe("+19995550123");
    expect(result.channels?.signal?.allowFrom).toEqual(["+15555550123"]);
  });
});

describe("enableChannel", () => {
  it("enables a channel", () => {
    const cfg: MoltbotConfig = {};
    const result = enableChannel(cfg, "signal");
    expect(result.channels?.signal?.enabled).toBe(true);
  });

  it("preserves existing config", () => {
    const cfg: MoltbotConfig = {
      channels: {
        signal: {
          account: "+15555550123",
        },
      },
    };
    const result = enableChannel(cfg, "signal");
    expect(result.channels?.signal?.enabled).toBe(true);
    expect(result.channels?.signal?.account).toBe("+15555550123");
  });
});

describe("disableChannel", () => {
  it("disables a channel", () => {
    const cfg: MoltbotConfig = {
      channels: {
        signal: {
          enabled: true,
        },
      },
    };
    const result = disableChannel(cfg, "signal");
    expect(result.channels?.signal?.enabled).toBe(false);
  });
});

describe("setChannelProperty", () => {
  const baseCfg: MoltbotConfig = {};

  it("sets properties for default account", () => {
    const result = setChannelProperty(baseCfg, "signal", "default", {
      enabled: true,
      account: "+15555550123",
    });
    expect(result.channels?.signal?.enabled).toBe(true);
    expect(result.channels?.signal?.account).toBe("+15555550123");
  });

  it("sets properties for named account", () => {
    const result = setChannelProperty(baseCfg, "signal", "work", {
      enabled: true,
      account: "+15555550123",
    });
    expect(result.channels?.signal?.accounts?.work?.enabled).toBe(true);
    expect(result.channels?.signal?.accounts?.work?.account).toBe("+15555550123");
  });

  it("preserves existing channel config for named account", () => {
    const cfg: MoltbotConfig = {
      channels: {
        signal: {
          enabled: true,
          cliPath: "/usr/bin/signal-cli",
        },
      },
    };
    const result = setChannelProperty(cfg, "signal", "work", {
      account: "+15555550123",
    });
    expect(result.channels?.signal?.enabled).toBe(true);
    expect(result.channels?.signal?.cliPath).toBe("/usr/bin/signal-cli");
    expect(result.channels?.signal?.accounts?.work?.account).toBe("+15555550123");
  });
});
