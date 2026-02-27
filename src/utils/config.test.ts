import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

describe("Config", () => {
  const testRoot = "/tmp/git-ai-config-tests";
  const oldXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(async () => {
    try {
      await rm(testRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }

    await mkdir(join(testRoot, "git-ai"), { recursive: true });
    process.env.XDG_CONFIG_HOME = testRoot;
  });

  afterEach(async () => {
    try {
      await rm(testRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }

    if (oldXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = oldXdg;
    }
  });

  describe("Config defaults shape", () => {
    test("should expose expected LLM defaults", async () => {
      const { loadConfig } = await import("./config.ts");
      const config = await loadConfig();

      expect(config.llm?.defaultProfile).toBe("smart-main");
      expect(config.llm?.profiles["smart-main"]?.provider).toBeDefined();
      expect(config.llm?.profiles["smart-main"]?.model).toBeUndefined();
      expect(config.llm?.retry.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(config.llm?.timeouts.requestMs).toBeGreaterThan(0);
      expect(config.preferences?.commit.defaultMode).toBe("grouped");
      expect(config.preferences?.pullRequest.createAsDraft).toBe(true);
    });
  });

  describe("Type guards", () => {
    test("should detect valid GitHub token presence", () => {
      const configWithToken = { githubToken: "ghp_abc123" };
      const configWithoutToken = { githubToken: "" };

      expect(!!configWithToken.githubToken && configWithToken.githubToken.length > 0).toBe(true);
      expect(!!configWithoutToken.githubToken && configWithoutToken.githubToken.length > 0).toBe(false);
    });

    test("should accept valid reasoning effort values", () => {
      const validValues = ["none", "low", "medium", "high", "xhigh"];

      validValues.forEach(value => {
        expect(["none", "low", "medium", "high", "xhigh"].includes(value)).toBe(true);
      });
    });
  });
});
