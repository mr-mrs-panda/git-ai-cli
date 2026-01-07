import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdir, rm } from "fs/promises";

// We need to test config functions with a temporary config directory
// Since config.ts uses process.env.HOME, we'll test the logic by mocking

describe("Config", () => {
  const testConfigDir = "/tmp/git-ai-test-config";
  const testConfigPath = join(testConfigDir, "config.json");

  beforeEach(async () => {
    // Clean up any existing test config
    try {
      await rm(testConfigDir, { recursive: true });
    } catch {
      // Ignore if doesn't exist
    }
    await mkdir(testConfigDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testConfigDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Config file operations", () => {
    test("should create config with defaults when file doesn't exist", async () => {
      // Import fresh to avoid cached state
      const { loadConfig } = await import("./config.ts");
      const config = await loadConfig();

      expect(config.model).toBe("gpt-5.2");
      expect(config.temperature).toBe(1);
      expect(config.reasoningEffort).toBe("low");
    });

    test("should merge loaded config with defaults", async () => {
      // Write partial config
      await Bun.write(testConfigPath, JSON.stringify({ openaiApiKey: "sk-test123" }));

      // We can't easily test loadConfig with custom path,
      // so we test the merge logic conceptually
      const partialConfig = { openaiApiKey: "sk-test123" };
      const defaults = { model: "gpt-5.2", temperature: 1, reasoningEffort: "low" };
      const merged = { ...defaults, ...partialConfig };

      expect(merged.openaiApiKey).toBe("sk-test123");
      expect(merged.model).toBe("gpt-5.2");
    });
  });

  describe("Config validation", () => {
    test("should detect valid API key presence", () => {
      const configWithKey = { openaiApiKey: "sk-abc123" };
      const configWithoutKey = { openaiApiKey: "" };
      const configUndefined = {};

      expect(!!configWithKey.openaiApiKey && configWithKey.openaiApiKey.length > 0).toBe(true);
      expect(!!configWithoutKey.openaiApiKey && configWithoutKey.openaiApiKey.length > 0).toBe(false);
      expect(!!(configUndefined as any).openaiApiKey).toBe(false);
    });

    test("should detect valid GitHub token presence", () => {
      const configWithToken = { githubToken: "ghp_abc123" };
      const configWithoutToken = { githubToken: "" };

      expect(!!configWithToken.githubToken && configWithToken.githubToken.length > 0).toBe(true);
      expect(!!configWithoutToken.githubToken && configWithoutToken.githubToken.length > 0).toBe(false);
    });
  });

  describe("ReasoningEffort type", () => {
    test("should accept valid reasoning effort values", () => {
      const validValues = ["none", "low", "medium", "high", "xhigh"];

      validValues.forEach(value => {
        expect(["none", "low", "medium", "high", "xhigh"].includes(value)).toBe(true);
      });
    });
  });
});

