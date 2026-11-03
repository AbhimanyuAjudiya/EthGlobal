# Round 3 — Devil's Advocate, v2 Re-score, and Decision (from the Chair)

## State of play after Round 2
- Withdrawn by their own proposers after cross-examination: Boli, Bhishi (Judge's Eye); Challan, Udhaar (Mumbai Native); Gavel, Kilowatt (Sponsor Stacker). Operator/Revenue's withdrawals: see `round2-operator-revenue.md`.
- Surviving v2 proposals: **Dhwani v2** (`round2-judges-eye.md` §2), **Recharge v2 / Recharge × Octroi** (`round2-mumbai-native.md` §2 and `round2-sponsor-stacker.md` §4 — two members independently converged on the same hybrid), and the Operator's v2 (`round2-operator-revenue.md`).
- Votes so far: Judge's Eye → Recharge, Octroi, Asli; Mumbai Native → Dhwani, Octroi, Asli; Sponsor Stacker → Dhwani, Recharge, Asli.
- Track position: all reporting members reversed to **Continuity, declared openly**, because the founder has ordered the build to start before kickoff; both v2s plan a `v0` pre-build (core only, on local Anvil with fixtures) and ≥50–60% of features — every sponsor integration — shipped in-window by the human team.
- Honest revenue status: Dhwani v2 low/base/high = $100 / $3.3k / $11.7k per week (hinge: one PSP or event-organiser contract by Q1 2027). Recharge v2 = $950 / $4.2k / $13.5k (Mumbai Native) or $0 / $1.5k / $10k (Sponsor Stacker) per week (hinge: sponsor "data drop" sales; one sales meeting possible Thursday). Neither base case reaches the founder's $10k/week bar; both high cases do.

## Member #10a — Devil's Advocate (`round3-devils-advocate.md`)
Attack each surviving v2 as if you wanted it dead. For each: (1) the three strongest arguments against it that NO member has yet made; (2) the weakest claim in its revenue model and what the number is if that claim is false; (3) the single point of failure in the 4-minute demo; (4) the sponsor-judge objection most likely to deny each claimed prize; (5) the Continuity-eligibility risk specific to it (which partner's continuity rules might exclude it); (6) what crypto-twitter's cruelest quote-tweet would say; (7) the strongest case FOR a third option the committee has under-weighted (e.g., Octroi standalone as B2B infra, Asli, or a Hyperliquid-venue CallSheet) with its own honest numbers. Finish with: which v2 survives your attack best, and the two conditions under which you would reverse that.

## Member #10b — Critic Panel Re-score (`round3-rescore.md`)
Re-score each surviving v2 on all five Round-1 lenses using the Round-1 critics' own methods and thresholds (Security survivability /10; VC realism /10 with low/base/high re-derived; Judge rubric T/O/P/U/W + P(top-10) + per-sponsor P(placed); User desire /10 + virality; Ops P(all sponsor integrations real) with hours and critical path). Show Round-0 → v2 deltas and say which critiques were actually fixed vs. merely restated. Then score the two v2s on the founder's dual mandate: P(finalist) × finalist value + Σ P(sponsor placed) × prize, and P(≥$10k/week by month 9). Produce one table.

## Member #10c — Synthesizer (`DECISION.md`)
Read everything in this directory plus `../sponsors.md`, `../winners.md`, `../ideation.md`, `../design-foundations.md`, `../../docs/ENVIRONMENT-CONSTRAINTS.md`. Write the decision memo:
1. **The decision** — one idea, named, with the one-sentence product definition the team will repeat in README, video and pitch; the runner-up and the exact trigger that would switch to it.
2. **Why** — the committee's reasoning in ≤10 numbered points, each citing the member and file that established it.
3. **Every question, resolved** — a table of EVERY numbered question raised in Round 1 against the chosen idea and against the runner-up (Q-SEC/VC/JUDGE/USER/OPS-*), the proposer's answer, the Devil's Advocate's view, and the committee's final resolution (Accepted fix / Open risk / Rejected). Also list the chair's cross-cutting questions (A/B/C) and their resolution. No question may be missing.
4. **Sponsor map** — 3 partner programs with exact tracks, what breaks without each, hygiene artifacts, and the Fri 06:00 swap gate per sponsor.
5. **Revenue model** — the re-derived low/base/high, the hinge assumption, the first three customers, and the pre-kickoff sales/legal actions (non-code) that move the number.
6. **Scope** — `v0` pre-build (what the orchestrator builds now on local Anvil with mocked externals: modules, interfaces, tests) vs **in-window human deliverables** (every sponsor integration, deploys, hardware, design pass), with the hour budget per workstream and the critical path; what is honestly mocked in the demo.
7. **Entry strategy** — Continuity vs from-scratch under the pre-build reality: the committee's recommendation, the conditions, the disclosure text for the README, and the per-partner eligibility questions to ask at kickoff.
8. **Design brief** — the one image, the design signature, the type/colour choices from `design-foundations.md`, and the 5 best-in-class UI/UX references for this exact category.
9. **Go/No-go risks** — the top 5 with owner, trigger and fallback.
10. **Dissent** — any member's unresolved objection, stated fairly.
Length: as long as needed to leave no question unanswered; aim 3,000–5,000 words.
