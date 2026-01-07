import { createRelease } from "../services/release.ts";

export interface ReleaseCommandOptions {
  autoYes?: boolean;
  includePRs?: boolean;
}

export async function release(options: ReleaseCommandOptions = {}): Promise<void> {
  const { autoYes = false, includePRs = false } = options;

  try {
    await createRelease({ autoYes, includePRs });
  } catch (error) {
    throw error;
  }
}
