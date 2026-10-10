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

Final browser-helper caveat: the last single-iteration smoke capture was black
despite independent desktop/mobile forecast screenshots rendering correctly.
A three-iteration retry then hung until the sandbox command timed out at630seconds;
the owned helper process tree was terminated and the issue recorded internally.
Do not count this final generic smoke check as passed. The earlier rendered smoke
capture and independent UI/state checks are separate evidence, not proof that this
helper failure is resolved. No code change or new regression result from this retry.

## Live UI play and trusted plan feedback (after PR4 merge)

Started branch feat/model-plan-feedback from merged master09704dc. Actual Chromium
UI onboarding as SCC, route preview Yibin->Zhaotong, user commands via input and
DOM click dispatch (known native input limitations still apply). Real step-5-preview
returned recruit2k then battle6k; two orders executed, paid18.4silver/12.8food,
home4k. Formula settlement captured Zhaotong with5k and occupation2turns.
Next rally10/fortify5/recruit2 all executed, paid11.5silver/2food.

Live bug: first completed world turn toasted1931-04-08 but store date remained
1931-04-01, turn0 and points4. Cloud RAF callback only ran inside the hold interval.
Deterministic2200/4000ms frame-jump tests failed before fix, then passed. Now midpoint
fires after threshold even when skipped; playTimeJump has exactly-once fallback.
Saved/loaded the failure scene through UI; continued on patched code. This replay
has an extra economic tick caused by the failed date, NOT a normal economy sample.
25 real minor-AI recruit/fortify actions executed and generated25 trusted receipts.
Patched live date advanced1931-04-08/turn1/points6. New fortify3+rally5 executed,
paid4.5silver, final1182.2silver/1081.7food/points4. Total32 successful actual actions,
no usable actual invalid-plan sample; do not claim universal zero-rejection quality.

Persisted read-only commandReceipt records caller identity, result/reason, observed
spent points/resources and balances. History scopes receipts to faction, player chat
keeps success/failure markers and refusal reasons, prompts prefer receipts to prose.
Routine receipts excluded from turn summary. Replay is state-neutral. Exception
receipts preserve any observed payment, NOT a claim of transactional rollback.
Actual failed requests showed[object Object] and cleared input; normalized nested
errors in both clients, preserved input on transport/parse failure. UI502 fault
injection separately verified readable error, original input and unchanged state.

Testing used an isolated local secure HTTP relay, NOT production Nest auth. Initial
relay authentication mismatch and4096 output truncation excluded from plan stats;
cap raised16384. Related YUN returned upstream502 three times, so no evidence of
successful enemy retaliation. Temporary test proxy session then expired; refreshed
relay and direct secure probe confirmed200, subsequent live fortify/rally succeeded.
No key/token/env committed; relay stays outside repository. Sanitized four response
payloads in tests/fixtures/live-play-step-5.json; offline replay is NOT another live game.

Verification: full34files/407tests, typecheck, frontend/backend builds passed.
ESLint JS-only configuration passes but excludesTS/Vue; Oxlint41baseline errors remain.
Bundle780.97kB/gzip229.41kB warning remains. Desktop1440x1000/mobile375x812 success
and mobile error screenshots inspected; no pageerrors/new horizontaloverflow.
Browser closed after QA. Generic virtual-time helper remains unresolved.
Next: small southwest goal chain, fast routine AI presentation, aggregate turn summary;
long actual-model strategy/failure-adjustment assessment and full animation rollback remain.

## Southwest goals / faster domestic presentation / focused summary

Latest owner request authorizes continuing the proposed next features. PR5 remains
OPEN, so work branches from e7af649 on feat/southwest-objectives; do not auto-merge.
Scope: optional SCC bridgehead chain, event-replayed progress, three complete ready
turns after integration, no resource reward/global victory change. Trusted faction
domestic fast mode defaults on; only visuals/toasts omitted, not guards/payments.
Summary aggregates own economy/local events, collapses foreign routine changes and
retains raw events; world-start ownership snapshot protects lost-city attribution.

QA inventory before browser checks:
- Start objective through UI; initial/occupation/ready/hold/completed states visible.
- Integration-ending checkpoint does not count early; three full ready turns required.
- Loss of rear/target or supply resets unfinished streak, completion retained.
- Duplicate start, non-SCC, legacy save, save/load and auto-save replay boundaries.
- Fast checkbox on/off/on plus save/load preference; player animations unchanged.
- Fixed25-order batch full-vs-fast has identical events/state/costs, animation25vs0.
- Summary defaults focus own changes, foreign/raw sections open/close, loss/failure
  remains visible and raw events unchanged. Summary must appear above command panel.
- Desktop/mobile startup and densest modal/error/detail states, no clipped controls.
- Browser tests use fixed provider replies, explicitly not new live-model matches.
- Required generic game helper will be run with bounded timeout; existing failure
  is not presumed repaired. Do not count black screenshots/hangs as passed.

Implemented optional SCC southwest scenario, trusted domestic fast presentation,
focused summary and preference persistence. Completion copy/context distinguishes
achieved records from unfinished resettable streaks. Added17 new regression tests
across3 files: final37files/424tests passed with prior real-output
offline replay; typecheck, frontend/backend builds and JS-only ESLint passed.
Oxlint remains41baseline errors. Final main bundle790.75kB/gzip233.22kB warning.

QA found static high-layer dialogs inflated draggable z-counter; removed that
inflation and added regression. Also found mobile legend intercepted Save clicks;
mobile toolbar now has bounded internal scroll, leaving legend unobstructed.
Native Save/Load now work on375x812. Toolbar bottom608 vs legend top686; document
width375. Required command controls bottom<=467.3/right350, goal bottom~633.

Ordinary software WebGL session confirmed first battle, occupation, ready0/3,
summary collapsed/expanded and desktop/mobile visuals. Preliminary DOM-dispatch
trial bypassed a disabled end-turn control and overlapped turns; discarded, not
used as normal gameplay evidence. Later real pointer flow respected busy=false.
Long WebGL script hit120sec REPL limit and subsequent call also timed out.
Recovered by reset per browser guide; used existing Canvas fallback with
--disable-webgl, no business-code or store-state shortcut.

Fresh Canvas session used native Playwright clicks/fill for selection, objective
start, player recruit2+battle6 and five world turns. Fixed sanitized responses,
NOT new actual model calls; related AI idle fixtures prove no enemy intelligence.
Turns/date/progress:1/04-08/occupation1hold0;2/04-15/integratedhold0;
3/04-22/hold1;4/04-29/hold2;5/05-06/completed3. Native checkboxoff, manual save,
checkboxon and manual load restoredfalse+completed3. Auto load restoredtrue+
completed3. Non-SCC native new-game check hides both objective entries.
Expanded raw summary mobile footer remains visible. Final desktop/mobile screenshots
inspected after CSS transitions settled; no new clipping/horizontaloverflow or
pageerrors in completed validation. Browser closed; Vite reused, never restarted.

Generic helper first produced black screenshot despite readable state; final30sec
bounded retry timed out during screenshot and produced no final artifacts.
Explicitly NOT passed, not fixed. Software RAF and Canvas HUD are not real-device
performance metrics or evidence of55FPS. DEV HUD omitted from production.
Next: real-model10-15turn enemy pressure/failure adjustment; animation rollback,
legacy lint, chunk splitting and generic helper remain unresolved.

## Faction initiative and counterattack milestone

Branch feat/faction-initiative starts from merged PR5/PR6 master cb63a5a.
No automatic merge authorization for this new iteration.

- Read-only frontline goals reuse normal campaign previews and execution guards.
  Includes incoming defense, own battle support, supply warnings, recent loss,
  assembly/recapture, consolidation and reachable hostile attack or legal waiting.
- Event-time ownership preserves original-owner loss history; neutral attacker/
  defender loss wording and bounded history. No free troops/resources/points.
- Trusted zero-cost structural/strategic refusal receipts survive save/load and
  inform subsequent context. Clarified gb vs from after three real schema refusals.
- Four short real-model samples: 5+2 initial valid NPC turns, 3+2 restarted valid
  turns; 35 planned, 3 preflight refused, 32 executed. NOT a continuous 12-turn
  model match. Full defense/counterattack pressure runs remain incomplete.
- Initial failure-as-idle harness corrected: transport failure now pauses without
  date advancement. Normal save checkpoints restore identically; later planning
  retries still failed with upstream502. Client45 / relay46 attempts retained.
- Native Canvas fallback browser replay completed onboarding, command, end-turn,
  foreign-summary expansion/scroll and confirmation. Actual first YUN response
  replayed offline, all other responses fixed; no extra live model count.
  Desktop1440x1000/mobile375x812 inspected after notices vanished; no page errors.
- Generic game helper bounded30s exited124, start screenshot/state produced and
  inspected. Not counted as passed. Browser contexts cleaned up.
- 14 initiative tests and full438 regression tests pass (2 opt-in live skipped).
  Typecheck/frontend/server builds and JS ESLint pass; changed-file Oxlint0,
  whole-project41 existing errors; bundle size warning remains.

See docs/faction-initiative.md, faction-initiative-qa.md and
faction-initiative-results.md for exact scope, evidence and limitations.
Next: explain tactical risk/cost and avoid repeated failed plans; complete valid
10–15-turn checkpointed samples in a stable request environment before broadening
campaign content or changing nationwide economy.

## Tactical assessment milestone

PR7 merged into master at 2026-10-10T12:39:49Z, merge89da24b, as explicitly
authorized. New feat/tactical-assessment branch starts there; this iteration
is for a new reviewable PR, not authorized for automatic merging.

- Shared read-only one-settlement assessment reuses the existing battle formula,
  actual route cost distance, current supply and legacy battle version semantics.
  Player and faction context show losses, morale, reserves, fees and reasons,
  explicitly not win probability. Risk never blocks otherwise legal execution.
- Only money-rejected campaign suggestions search smaller legal tenths of k via
  normal previews. Own active fronts can show legal retreat even at zero AP;
  no automatic retreat, extra resources or cost/battle-rule changes.
- Failure advice distinguishes malformed fields, current money, points,
  diplomacy and routes. Unit coverage is not proof of live-model adaptation.
- 24 new tests; full39files/462tests pass, opt-in live2 skipped. Typecheck,
  frontend/server builds and JS ESLint pass; four changed/new code/test files
  Oxlint0. Existing full-project lint debt remains; bundle803.11kB/gzip238.00kB.
- Native Canvas input verified 1k high-risk legal attack, 8k zero reserve,
  9k/0k rejection and move-mode exclusion. Previews preserve state; actual confirm
  charges2.4silver/1.8food/1AP and starts battle without date advancement.
  Desktop1440x1000/mobile375x812 screenshots inspected, no page errors.
  Fixed locally clipped taller panel with initial position and bounded scroll.
- Generic helper this iteration exits0 with inspected onboarding screenshot and
  state only; not an end-to-end gameplay or universal baseline-failure fix.
- One fresh real step-5-preview decision, HTTP200/44573ms/no retry. Context
  advised assembly, but model chose legal10k counterattack+fortify5+recruit3.
  Three executed orders cost3AP/66.1silver/44.4food. One valid decision,
  not12-turn coverage or proof of more cautious strategy/setback learning.

See docs/tactical-assessment.md. Next: checkpointed10-15valid decision rounds,
compare advice with selected plans, test sustained support/withdrawal and
specific setback adjustment before adding systems.

## Checkpointed tactical pressure follow-up

User authorized the proposed long test; no authorization to merge PR8.
Ran original80442f2 gameplay code without rule/prompt changes. Resumed identical
previous one-decision normal save and added11valid decisions, one counterattack
scenario12/12complete, not twelve newly called decisions or two complete cases.

- 41planned/41executed, zero preflight/execution refusals, no retreat/idle turns;
  actual receipts41AP/404.9silver/236.3food, AP use56.9%.
- Recovered Zhaotong at decision6 via defenderCollapse; consolidation then15k
  Luzhou campaign, defended SCC counterattack, captured Luzhou at decision12.
  Fixed SCC recruit/fortify policy did not protect morale; not a human match.
- Request evidence24including prior success:200x12,502x11,401x1. Fresh same
  credential bridge recovered proxy-token expiration, not a quota finding.
  Failed attempts do not count as game turns; finalturn13/1931-07-01.
- Continuation checks current snapshot equality, but discovered historical ID
  reuse after ended battles and runtime reset. nextBattleId scans only current
  battles, while finished battles are deleted; event history and collapse seeds
  can be affected. Report explicit limitation; not fixed in this test.
- Added standalone sanitized reporting script with continuity assertions,
  CSV/JSON artifacts and docs/tactical-pressure-results.md. No new UI/gameplay
  change; prior462regression result remains a prior result, not silently rerun.

Next priority: historical-unique battle IDs and post-load future consistency,
then bilateral morale explanations and explicit legal resource-stress/retreat
scenarios before larger gameplay systems.

## 2026-10-10: historical IDs, bilateral morale, explicit setbacks

User approved this follow-up and merging PR8 after verification. Map attack /
redeploy quick-entry selection is assessment-only, not authorized implementation.

- New battle IDs scan active battles AND historical start/end events. Six normal
  save regressions include ended fronts and four post-load settlements compared
  with uninterrupted execution. Legacy IDs/results remain unchanged.
- UI/AI comparison shows current -> estimated next morale for both sides, explains
  configured collapse threshold20 without a guaranteed result, and removes the
  positive favorable sentence from narrow exchanges classified consider.
- Continuation reporter takes explicit prior-decision count and source commit;
  four Node tests distinguish fresh/resumed runs and invalid prior counts.
- Normal over-recruitment/upkeep produced actual negative silver with six AP;
  one actual recruitment refusal, then two valid model idle decisions. No further
  spending, but persistent deficit not fixed: not proof of economic recovery.
- Independent unfavorable complete-context trial: one valid decision planned
  transfer15k then deploy15k. Transfer succeeded; deploy was rejected against the
  initial5k garrison. Existing batch-order preflight limitation documented, not
  fixed or disguised as model error. Next decision failed after three502s.
- Independent focused two-city trial: one valid model retreat,3k returned normally
  to garrison, no new fees/AP. Next decision failed after three502s. Do not combine
  these trials into a continuous two-turn match or claim all live targets passed.
- Formal evidence15requests:200x5 (one empty content),502x10; valid decisions4
  across budget2/full unfavorable1/focused unfavorable1. Pilot bridge/setup tests
  excluded. Evidence whitelist omits prompts/saves/credentials/hidden reasoning.
- Actual final rerun:40files469offline tests passed,4live tests default skipped;
  three normalized actual-order replay tests included. Four reporter tests separate.
  Typecheck/server+web builds passed;7changed TS/Vue files Oxlint0. Original804kB
  bundle warning and jsdom Canvas warning persist. No new native-map screenshot:
  cloud browser could not reach localhost and sandbox transport unavailable.

See docs/battle-persistence-and-setback-review.md and
docs/map-command-shortcuts-assessment.md. No shortcut/map-picking code changed.

## 2026-10-10: map attack / transfer command selection

User approved implementing the assessed map interaction and merging after validation.
Preserve the existing parchment design and actual execution rules. Add visible attack /
transfer entry, explicit draft phases, topology/diplomacy highlights, atomic panel
hydration, reselection/list fallback, cancellation and A/M/Esc keyboard controls.
QA inventory is in docs/map-command-shortcuts-implementation.md; final results pending.

Final: 43 files / 498 offline tests passed, 4 live tests default skipped; four reporter
tests, typecheck, frontend/backend builds and Oxlint on 8 changed code files passed.
Native Chromium WebGL mouse/touch drafts and normal scheduler transfers passed.
Desktop and mobile independently moved 1k Yibin->Luzhou, paid 1AP / 2silver / 1.5food
once; confirmation locks unchanged successful drafts. No page errors observed.
Actual UI save/load clears picker; faction-event cancellation and held mocked-chat
busy guards verified separately, not a new real-model match.
Found narrow-screen confirm below viewport; moved confirm/cancel into a separate
footer and opted this panel out of modal cascade offsets without changing defaults.
Final desktop modal180,100..950; mobile12,12..754 with confirmation709..741.
Native map QA paused ticker for non-animation checks/manual renders, restored for
transfers; not a performance pass. An older AI-context 5s timeout under concurrent
browser load passed at the same timeout after browser cleanup. Standard gameplay
client's final smoke screenshot/state reviewed; only startup, not full gameplay.
Existing bundle/jsdom warnings and batch transfer->deploy preflight limit unchanged.
