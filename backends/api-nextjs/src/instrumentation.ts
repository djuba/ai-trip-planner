// Next calls `register` once when the server starts, which is where bad config should stop it.
import { getConfig } from './config.ts';

export function register(): void {
  // This exact form lets Next drop the block from its Edge build, where process.exit doesn't exist.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      getConfig();
    } catch (error) {
      // Next logs a throw from here and keeps serving, so exit explicitly. ConfigError messages
      // hold variable names only, never values.
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}
