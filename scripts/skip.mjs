// Placeholder for a gate step whose target does not exist yet (WU-02 D8).
// Prints what was skipped and which work unit makes it real, then exits 0.
// Usage: node scripts/skip.mjs "<what>" "<WU-xx that makes it real>"
const [what = 'step', unit = 'a later work unit'] = process.argv.slice(2);
console.log(`SKIPPED: ${what} (not implemented yet; becomes real in ${unit})`);
