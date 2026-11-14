// Next calls `register` once when the server starts, which is where bad config should stop it.
import { getConfig } from './config.ts';
import { getAccessConfig } from './http/access-config.ts';

export function register(): void {
  // This exact form lets Next drop the block from its Edge build, where process.exit doesn't exist.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      getConfig();
      // Fails closed: live mode needs codes and a persistent store; record mode needs codes, and
      // neither starts with a committed code it shouldn't trust (WU-22 plan D4, deviation 1).
      getAccessConfig();
    } catch (error) {
      // Next logs a throw from here and keeps serving, so exit explicitly. ConfigError messages
      // hold variable names only, never values.
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}
