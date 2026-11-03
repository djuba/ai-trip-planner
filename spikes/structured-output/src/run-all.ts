// NON-PRODUCTION SPIKE (WU-03). See ../README.md.
//
// Runs every probe in order. Offline probes always run; live phases run only when
// ANTHROPIC_API_KEY is set (about 15 small calls, well under $0.10).
const probes = ['q5-failures.ts', 'q1-q4-structured.ts', 'q3-constructs.ts', 'q7-use-object.ts'];

for (const probe of probes) {
  console.log(`\n##### ${probe}`);
  await import(`./${probe}`);
}

export {};
