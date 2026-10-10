/** Summarize one checkpointed real-model pressure run without publishing saves or prompts. */
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const [input, prefix] = process.argv.slice(2);
assert(
  input && prefix,
  "Usage: node scripts/report-tactical-pressure.mjs input.json output-prefix",
);
const source = JSON.parse(readFileSync(input, "utf8"));
assert.equal(source.cases.length, 1, "Do not silently combine independent scenarios");
const sample = source.cases[0];
const records = sample.records;
const round = (value) => Math.round(value * 10) / 10;
const rows = records.map((record, index) => {
  assert.equal(record.step, index + 1);
  assert.equal(record.parseSucceeded, true);
  assert.equal(record.error, undefined);
  if (index) {
    const previous = records[index - 1].state;
    assert.equal(record.state.turn, previous.turn + 1);
    assert.equal(
      Date.parse(`${record.state.date}T00:00:00Z`) - Date.parse(`${previous.date}T00:00:00Z`),
      7 * 86400000,
    );
  }
  const costs = record.receipts.reduce(
    (sum, receipt) => ({
      points: sum.points + receipt.spentPoints,
      silver: sum.silver + receipt.spentSilver,
      food: sum.food + receipt.spentFood,
    }),
    { points: 0, silver: 0, food: 0 },
  );
  const city = (gb) => record.state.cities.find((item) => item.gb === gb);
  const zhaotong = city("156530600");
  const events = record.events.filter((event) =>
    ["attack", "capture", "battleEnd"].includes(event.type),
  );
  return {
    decision: record.step,
    worldTurn: record.state.turn,
    date: record.state.date,
    advice: record.initiative.kind,
    planned: record.plannedOrders.length,
    preflightRefused: record.planningRefusals.length,
    executed: record.execution.filter((result) => result.ok).length,
    executionRefused: record.execution.filter((result) => !result.ok).length,
    spentPoints: costs.points,
    spentSilver: round(costs.silver),
    spentFood: round(costs.food),
    zhaotongOwner: zhaotong.owner,
    zhaotongTroops: zhaotong.troops,
    zhaotongMorale: zhaotong.morale,
    zhaotongFort: zhaotong.fort,
    yunSilver: record.state.yun.silver,
    yunFood: record.state.yun.food,
    battleEnds: events
      .filter((event) => event.type === "battleEnd")
      .map((event) => `${event.toName}:${event.reason}`)
      .join(";"),
    captures: events
      .filter((event) => event.type === "capture")
      .map((event) => `${event.targetGb}:${event.actor}`)
      .join(";"),
    orders: record.plannedOrders.map((order) => JSON.stringify(order)).join(";"),
  };
});
const sum = (key) => round(rows.reduce((value, row) => value + row[key], 0));
const statuses = source.requests.reduce((counts, request) => {
  counts[request.status] = (counts[request.status] ?? 0) + 1;
  return counts;
}, {});
const successful = source.requests.filter((request) => request.status === 200);
assert.equal(successful.length, rows.length);
const durations = successful.map((request) => request.elapsedMs).sort((a, b) => a - b);
const summary = {
  scenario: sample.scenario,
  targetDecisions: source.plannedTurnsPerCase,
  validDecisions: rows.length,
  complete: rows.length >= source.plannedTurnsPerCase,
  includesPreviousOneDecision: true,
  newlyCompletedDecisions: rows.length - 1,
  requests: source.requests.length,
  statuses,
  planned: sum("planned"),
  preflightRefused: sum("preflightRefused"),
  executed: sum("executed"),
  executionRefused: sum("executionRefused"),
  spentPoints: sum("spentPoints"),
  pointUtilization: round((sum("spentPoints") / (6 * rows.length)) * 100),
  spentSilver: sum("spentSilver"),
  spentFood: sum("spentFood"),
  retreatOrders: records
    .flatMap((record) => record.plannedOrders)
    .filter((order) => order.order === "stopBattle").length,
  successfulRequestMedianMs:
    durations.length % 2
      ? durations[Math.floor(durations.length / 2)]
      : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2,
  captures: rows
    .filter((row) => row.captures)
    .map((row) => ({
      decision: row.decision,
      date: row.date,
      captures: row.captures,
      battleEnds: row.battleEnds,
    })),
};
const evidence = {
  sourceCommit: "80442f28cbf07ab595c7dfe7b1a9af1277b87897",
  method: source.method,
  constraints: source.constraints,
  setup: sample.setup,
  summary,
  rows,
  decisions: records.map((record) => ({
    step: record.step,
    initiative: record.initiative,
    controller: record.controller,
    plannedOrders: record.plannedOrders,
    planningRefusals: record.planningRefusals,
    execution: record.execution,
    receipts: record.receipts,
    state: record.state,
    militaryEvents: record.events.filter((event) =>
      ["attack", "capture", "battleEnd", "moraleChange"].includes(event.type),
    ),
  })),
  requests: source.requests.map(({ scenario, turn, status, elapsedMs, finishReason, error }) => ({
    scenario,
    turn,
    status,
    elapsedMs,
    finishReason,
    error,
  })),
};
const headers = Object.keys(rows[0]);
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
writeFileSync(
  `${prefix}.csv`,
  [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(",")),
  ].join("\n") + "\n",
);
writeFileSync(`${prefix}.json`, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
