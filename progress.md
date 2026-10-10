# Gameplay rules progress

Original prompt: 按游戏性评估推荐开始修改，并使用 step-5-preview 测试。

## Scope

First iteration: hard command boundaries, truce protection, replay-safe action budget,
bounded free actions, accurate effect feedback, and runtime/model QA. Preserve existing
visual style and save format. Regional maps and economic/battle rebalance are subsequent work.

## QA inventory

- Ordinary player/faction cannot directly capture or advance dates.
- Truce rejection must precede deployment, resource payment and budget reservation.
- Player and faction AI spend their own six-point budgets; retreat remains available.
- Propaganda/sabotage costs silver and cannot repeat on the same target within a turn.
- Own fundraising caps and third-party/consent restrictions apply.
- Save/load preserves budgets and cooldowns; next turn restores them.
- Model JSON cannot select debug/system privileges.
- Command panel shows remaining action points at desktop and narrow viewports.
- Remove non-functional right-click actions instead of promising absent mechanics.
- Existing victory adjudication, diplomacy and legacy saves remain intact.
- Explore malformed quantities, rejected-first-order index mapping, bad calendar output,
  excessive battle flavor effects, and depleted-budget model requests.

## Status

Rules and UI implementation complete. Full regression plus six real-provider response
replays: 24 files / 323 tests passed. Typecheck, ESLint and frontend/backend builds passed.
Oxlint has the same 41 diagnostics as the unmodified base, with no new diagnostics.
See docs/gameplay-rules-first-pass.md for scope, evidence and reproduction.

The standard browser-game script's initial capture was black; a final run with more
frame/pause time correctly captured the rendered map and onboarding screen. Full-page
Playwright screenshots confirm the map renders. Browser UI automation encountered slow
pointer actions in the Pixi/Chromium environment; this is not treated as a passing full
gameplay run. Desktop (1440x1000) and mobile (375x812) command-panel full-page screenshots
were inspected. The mobile modal is x=12, width=351, and the action budget is fully visible.
Real-response browser replay recruited successfully (6 -> 5 points, silver 1200 -> 1198,
food 720 -> 719); at zero points a subsequent model-approved recruit was rejected with
an explicit UI reason and no further silver/food debit. No page errors observed.
Final UI replay after feedback refinement showed "已执行 0 条，未执行 1 条".
Changes committed and pushed on fix/gameplay-rule-boundaries; PR #1 remains open.
Static preview built separately; it does not include a running model backend.

## Follow-up

- Long-horizon model gameplay and economic balance remain untested.
- Regional topology, supply lines and midgame objectives are not part of this patch.
- Full transactional rollback after regular animation failures remains future work.
- Clean up baseline lint diagnostics and code-split the oversized main bundle separately.

## Terminology clarification

User request: 好的开始修改吧，另外你看看下一步做什么？

Unified UI, failure messages, event descriptions, AI contexts and model smoke-test wording
to "回合行动点". The UI explicitly says it is unrelated to API quotas and recovers at turn end.
No costs, point counts, model/provider settings or save schema changed.
Added two terminology regression tests; 24 files / 325 tests passed (including replay of
the six previously collected provider responses, not six additional paid API calls).
ESLint, typecheck and frontend/backend builds passed; Oxlint remains 41 unchanged baseline
diagnostics. Next-step recommendation is documented in docs/gameplay-next-steps.md:
first legal attack connectivity and previews, then lightweight supply, then economy/AI pacing.
Desktop/mobile command-panel screenshots inspected; the API distinction is fully visible.
Standard browser-game smoke script captured the map and onboarding correctly; no page errors
in the separate command-panel check. Browser closed after QA.

## Connectivity milestone

User request: Remove the API-quota explanation and continue the recommended gameplay goals.

Removed that explanation from active UI/prompts/scripts/rule docs. Added 375-city topology:
979 shared-boundary land links plus four explicit sea lanes, with deterministic generation,
source hash and synthetic corner/short-boundary/override tests. Paths only traverse own
cities, with opposing endpoints permitted for battle. UI, AI context and execution share
the same guard. Previewed and paid costs include every route segment and all field forces.
New battles persist route metadata; older route-less events remain readable.

First full regression after integration: 26 files / 345 tests passed; another five topology
generation tests passed separately. Typecheck, ESLint and both builds passed; Oxlint has
the same 41 baseline diagnostics. Browser desktop/mobile screenshots inspected: illegal
Guang'an -> Beijing disabled, valid Guang'an -> Chongqing battle and Guang'an -> Nanchong
transfer executed; after both, points=4, treasury=1195.6, granary=716.7. Sea preview Taiwan
-> Fuzhou showed 313km, silver12.5/food9.4 at 1k, including the sea multiplier. No page errors.
Browser closed. Next milestone: lightweight supply and occupation consolidation.

## Supply and consolidation milestone

Added initial regional hubs for every owned starting component plus ready level-3
cities as supply centres. Own connected paths (including explicit sea lanes) provide
supply; disconnected sources retain attack permission but have effective attacking
strength multiplied by 0.8. Captures and agreed cessions under new rules take two
world turns to consolidate, produce half tax/food meanwhile, and do not discount upkeep.
Pending cities may be transit nodes but cannot be hubs. New battles explicitly version
the supply rule; old captures/battles keep legacy behaviour. Capture dates and remaining
turns survive event replay and save/load.

UI and AI now show supply/consolidation status and share tuning labels. Actual paid
march costs are returned through the scheduler to historical execution feedback.
Battle logs use the same frozen supply snapshot as the round's formula, including
when asynchronous flavor or other battle effects change city status before reporting.

Final regression: 28 files / 366 tests passed, including six earlier provider responses
replayed offline (no new provider calls). Frontend/backend builds, typecheck, ESLint,
topology --check and git diff --check passed. Oxlint remains the same 41 baseline errors;
the final main bundle is 774.74kB minified / 226.72kB gzip with the existing size warning.

QA inventory and observed checks:
- Source/target/kind/troop controls: legal land, illegal enemy transit, own transfer,
  zero new deployment with existing forces, sea costs (prior connectivity checks).
- End-to-end actual battle: Guang'an -> Chongqing 1k, confirmation feedback reported
  silver2.5/food1.9; state points6->5, treasury1200->1197.5, granary720->718.1.
- Off-happy-path staged source isolation: attack remains legal but shows 20% penalty.
- Newly captured Nanchong level-3 hub: two turns pending, tax/food50%, source still
  unsupplied; two dateAdvance events restore supply and remove integration message.
- Desktop1440x1000 and mobile375x812 screenshots inspected, primary preview controls,
  warnings and confirmations fit. Mobile panel x13, width349, document width375.
- No page errors observed. Native pointer click and keyboard Enter were unreliable
  in sandbox Pixi/Chromium; execution used DOM click dispatch and verified real state.
  This is not claimed as a complete real-input browser compatibility test.
- Required browser-game helper initially captured black before rendering settled;
  rerun at180frames/pause3000 captured the rendered map/onboarding and was inspected.
  It is a startup smoke test; separate gameplay screenshots cover the implemented UI.
Browser closed after QA.

Next: reproducible 20-40-turn economy/scripted-agent benchmark before balancing.
Real model long-game evaluation remains separate. Full animation-failure transactional
rollback, baseline lint cleanup, chunk splitting, and naval/ally-transit rules remain open.

## Economy and strategy benchmark milestone

User merged PR #3 and requested the next recommended step. Started from master423a835
on feat/economy-strategy-benchmark. Built an opt-in 40-turn integration harness: 12
factions, three scripted policies with three deterministic ordering/tiebreak seeds,
plus one severe food-zero stress fixture. Real guards, payments, action points,
topology, supply, occupation and battle settlement remain active; animations and
LLM flavor are mocked. No new provider calls or diplomacy/world events. Baseline
and current exports each contain4800 faction-turn rows,9600 total.

Observed: all idle factions remain solvent/fed40turns; recruit rush3579attempts,
1023rejections(28.6%),10factions experience arrears,894arrear-faction-turns. A conservative
script has2966attempts,zero preflighted rejections,66arrear-faction-turns and1333battle
starts/1194capture events. These are scripted policy contrasts, not LLM improvement,
independent statistical samples, unique captures or an empirical victory claim.
Conservative action cap3/turn also limits six-point utilization to50%.

Food-zero stress exposed small-garrison integer-rounding immunity and deployed troop
immunity. New economic events carry attritionVersion2; both force pools lose2% with
minimum0.1k, rounded at0.1k, never belowzero. Old unversioned events retain exact
old replay behavior. Debt warnings now use actual projected balances even when
current net income ispositive. Production and harness share buildEconomicTickEvent.
All regular-policy per-turn rows before/after were identical; stress field10k→4.7k
after40turns instead of remaining10k. Do not extrapolate this extreme fixture.

Added shared static economic outlook, three-turn reserve/recruitment advice and
phase guidance to faction/minor/player/advisor contexts. Advice remains soft, never
revokes command permissions. Player command panel shows goal/net income/runway and
total-batch recruitment recommendation, explicitly excluding future battle/territory
changes. No tax/food/upkeep/supply/occupation coefficient retuning.

Verification: full386tests/30filespassed, including complete long-matrix export and
six old real-response replays. Typecheck, ESLint and both builds passed. Oxlint41
baseline errors unchanged; main bundle778.52kB/gzip228.44kB still oversized.
Desktop1440x1000 and mobile375x812 healthy/scarcity screenshots reviewed; primary
input/buttons and forecast fit with no horizontaloverflow. Mobile inputregion
x25,width325,bottom408.3. Healthy SCC net7.8/186,recruitlimit15.6k; food-zero SCC
net7.8/-90,grainrunway0,recruitlimit0. No pageerrors; browser closed. Opening the
existing panel used DOM clickdispatch due known native input issues in sandbox.

Computed report and summary generated by scripts/summarize_economy_benchmark.mjs.
Next: real-model multi-order budget/goal evaluation, then regional/node objectives.
Full animation rollback and chunk/lint debt remain separate work.

Final follow-up: parallel full regression plus long legacy matrix caused one5-second
AI-context timeout. Avoided concurrent heavy suites and bounded AI prompt sampling
to16 source cities/16examples, prioritising borders and troop strength; no restriction
on campaign UI or execution legality. New regression proves an unlisted source may
still execute a legal attack. Serial final full regression:30files/387tests passed.
ESLint/build/typecheck passed; Oxlint remains41baseline errors. Legacy-switch export
reproduced all4800baseline rows exactly. Browser startup smoke rerun/inspected separately
from forecast QA. Final bundle size is recorded in the build log, not tuned here.
