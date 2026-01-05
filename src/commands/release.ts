import { createRelease } from "../services/release.ts";

export interface ReleaseCommandOptions {
  autoYes?: boolean;
}

export async function release(options: ReleaseCommandOptions = {}): Promise<void> {
  const { autoYes = false } = options;

  try {
    await createRelease({ autoYes });
  } catch (error) {
    throw error;
  }
}
