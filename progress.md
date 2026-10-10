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
