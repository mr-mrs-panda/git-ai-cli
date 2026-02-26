import { describe, expect, test } from "bun:test";
import { sanitizeDirectorySegment } from "./worktree.ts";

describe("worktree folder name sanitization", () => {
  test("keeps valid characters and lowercases", () => {
    expect(sanitizeDirectorySegment("Social-Media_Master.1")).toBe("social-media_master.1");
  });

  test("replaces invalid characters with hyphens", () => {
    expect(sanitizeDirectorySegment("feature/social media master")).toBe("feature-social-media-master");
  });

  test("collapses duplicate separators and trims edges", () => {
    expect(sanitizeDirectorySegment("___hello///world---")).toBe("hello-world");
  });

  test("returns empty string when nothing valid remains", () => {
    expect(sanitizeDirectorySegment("////")).toBe("");
  });
});

