/** Whitelist public gameplay evidence. Never exports prompts, saves or reasoning. */
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const [output, sourceCommit, ...inputs] = process.argv.slice(2);
assert(output && sourceCommit && inputs.length,
  'Usage: node scripts/report-tactical-setbacks.mjs output.json source-commit private-run.json [...]');
const military = new Set(['attack', 'capture', 'battleStart', 'battleEnd', 'moraleChange']);
const runs = inputs.map((path, index) => {
  const source = JSON.parse(readFileSync(path, 'utf8'));
  return {
    run: index + 1, method: source.method, focusedContext: source.focusedContext ?? false,
    requests: source.requests.map(({ scenario, status, elapsedMs, finishReason, error, content }) => ({
      scenario, status, elapsedMs, finishReason,
      contentPresent: typeof content === 'string' && content.trim().length > 0,
      error: error ? { type: error.type, message: error.message } : undefined,
    })),
    cases: source.cases.map(sample => ({
      scenario: sample.scenario, setup: sample.setup,
      validDecisions: sample.decisions.length,
      decisions: sample.decisions.map(({ step, before, initiative, planned, approved,
        execution, receipts, afterDecision, afterSettlement, events }) => ({
        step, before, initiative, planned, approved, execution, receipts,
        afterDecision, afterSettlement,
        militaryEvents: events.filter(e => military.has(e.type)),
      })),
    })),
  };
});
const evidence = {
  sourceCommit, model: 'step-5-preview', runs,
  boundaries: [
    'Independent controlled scenes, not a single continuous game',
    'Normal paid setup and rules engine; other factions idle; no diplomacy or AI flavor',
    'HTTP success without parseable content is not a valid decision',
    'No full save, prompts, credential values or hidden reasoning exported',
  ],
};
writeFileSync(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({
  sourceCommit,
  requests: runs.flatMap(r => r.requests).map(r => ({ scenario: r.scenario, status: r.status,
    contentPresent: r.contentPresent })),
  scenarios: runs.flatMap(r => r.cases).map(c => ({ scenario: c.scenario,
    validDecisions: c.validDecisions,
    planned: c.decisions.reduce((n, d) => n + d.planned.length, 0),
    executed: c.decisions.reduce((n, d) => n + d.execution.filter(e => e.ok).length, 0),
    retreats: c.decisions.flatMap(d => d.planned).filter(o => o.order === 'stopBattle').length,
  })),
}, null, 2));
