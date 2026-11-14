// Next calls `register` once when the server starts, which is where bad config should stop it.
import { getConfig } from './config.ts';
import { getAccessConfig } from './http/access-config.ts';

export function register(): void {
  // This exact form lets Next drop the block from its Edge build, where process.exit doesn't exist.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      getConfig();
      // Fails closed: live and record need codes, and unless LOCAL_DEV=true the committed codes,
      // the memory store in live mode, record mode and ACCESS_GATE=off are refused (WU-22 D4, dev. 7).
      getAccessConfig();
    } catch (error) {
      // Next logs a throw from here and keeps serving, so exit explicitly. ConfigError messages
      // hold variable names only, never values.
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}
