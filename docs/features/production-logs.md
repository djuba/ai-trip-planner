# Production logs: acceptance criteria

What the API may write to its logs, which Cloud Logging keeps for the hosted service. The decision is the [WU-23a plan](../plans/WU-23a.md) (D8). Logs carry LLM usage and latency (`[llm]` lines), discard signals, gate decisions with labels, and error names and stacks. They never carry what a user typed, an invite code, a code's hash or a token.

- **AC-LOG-01:** Given the built server in replay mode, when requests sent with a fresh invite code go through extract, recommend and present, and another ends in an upstream failure (502), then no line on the server's stdout or stderr contains a recorded request message (the cassette keys fix the messages), the code or the code's hash, and the run does log `[llm]` usage lines and `"event":"gate"` lines.
- **AC-LOG-02:** Given an unhandled error in a route handler, then the log line holds the error's name and stack (or its string form), never the error object's other properties, which may carry a request body.
