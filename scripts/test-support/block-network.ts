// Vitest setup file for every project except `contract` (WU-08 plan D10). The contract suite must
// reach whatever host API_BASE_URL names, and it makes no LLM calls in-process.
import { installNetworkGuard, recordingAllowed } from './llm-guard.ts';

if (!recordingAllowed(process.env)) installNetworkGuard();
