// The plan is Pro (the maintainer, 3 November 2026). What the docs say of it, read on 3 November 2026:
//  - support.claude.com/en/articles/11145838 (using Claude Code with a Pro or Max plan): "Pro and Max plans have a five-hour session limit and a
//    weekly limit", shared across Claude and Claude Code; on Pro a response already in progress at the limit may "wrap up" for a small capped
//    allowance that counts toward the weekly limit, once per weekly period ("Usage limit reached - wrapping up").
//  - support.claude.com/en/articles/11647753 (how usage and length limits work): the five-hour period starts at the first message and resets in
//    full five hours later; weekly limits reset at a fixed time each week assigned to the account; usage is affected by length, features, model
//    and the effort level.
//  - code.claude.com/docs/en/costs (usage credits; "You've hit your session limit / weekly limit": shared across models).
// NONE of them states the SIZE of a Pro window. The size below is an ASSUMPTION until the smoke sessions measure it (lib/quota.mjs windowSize
// replaces it from the ledger after three sessions that moved the window by 0.03): the 27 October runs on an account of unknown tier
// measured about 49 USD-equivalent per five-hour window and 277 per week (plan/calibration.json); if that account was Max 5x, Pro is a fifth.
export const PRO = {
  plan: 'pro',
  five_hour_usd: 9.8,
  seven_day_usd: 55,
  basis: 'assumption: the 27 October account measured 49 and 277 USD-equivalent and is taken as Max 5x; Pro = one fifth. Replaced by the measured size.',
  low_five_hour_usd: 2.5,
  low_seven_day_usd: 14,
  low_basis: 'if the 27 October account was Max 20x',
};
export const SIZE = { five_hour: PRO.five_hour_usd, seven_day: PRO.seven_day_usd };
