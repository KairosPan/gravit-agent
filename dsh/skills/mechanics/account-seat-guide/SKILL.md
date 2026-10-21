---
name: account-seat-guide
description: How the Account seat's MCP tools behave — paper venues only, the two cards on every write, waiting on a card, what to ask the owner for and what never, the refusal codes that mean stop.
---

# Account seat guide (neutral mechanics)

The `mcp__account__*` tools are Gravit's seat at the operator's Account (Linqi's
buyer-agent-demo, a program the operator runs on this machine). The Account holds the
operator's venues; the seat trades inside limits the operator signs on the Account page.

- **Paper venues only.** Name the venue in every order; `portfolio_account` lists them
  (`paperVenues`) and the limits you hold (`approvals`). Never place anything at a venue
  that is not a paper account, never ask for one, and never move money, pay or earn: the
  operator signs no `venues`, `payees` or `earn` limit.
- **Every write stops twice.** `portfolio_live_order`, `_batch`, `_amend`, `_cancel`,
  `_close`, `_leverage`, `_move`, `_earn` and `portfolio_pay` raise the face's card first
  (the operator answers it in the conversation), then the Account's own card on its page
  (Guard mode, thirty minutes). The answer to a carded order is `{pending: true, card: {id}}`:
  tell the operator the card id, then `portfolio_wait {card}` (55 s at most; ask again until
  `done`) or `portfolio_approval {id}`. Do not place the order again while a card waits.
- **The loop.** `portfolio_account` → `portfolio_venues` / `portfolio_explore` →
  `portfolio_live_preview` → `portfolio_live_order` → the two cards → `portfolio_wait` →
  `portfolio_report` (`taking`, `done`, `cannot`). `portfolio_live_cancel` never cards on
  the Account's side; a cancel still passes the face's card.
- **What to ask for** (`portfolio_ask`): `letIn` when `portfolio_account` says you are not
  admitted, a `limit` on a paper venue when yours is spent or missing. Never ask for `mode`,
  `leverage`, a `topup`, or a venue that is not a paper account. An ask grants nothing; do
  not wait on it in a loop — tell the operator and carry on with what you have.
- **Stop and tell the operator** on these codes: `E_ACCOUNT_UNKNOWN_SIGNER` (the seat is
  not admitted; it has knocked), `E_MANDATE_*` (outside the limit: venue, size, budget,
  window, expiry), `E_WALLET_LIVE_WRITES_OFF` (the service runs read-only; paper orders
  are refused too), `E_ACCOUNT_CARD_EXPIRED` (nobody answered in thirty minutes). They
  are facts about the limits, not errors to retry.
- **The quotes are public and unguarded.** `portfolio_candles`, `portfolio_book`,
  `portfolio_explore` and `portfolio_live_markets` read public sources seconds to minutes
  old, with no point-in-time guard: interactive research only, never backtest evidence.
  Paper orders and positions carry `paper: true`; a paper fill is a rehearsal, not money.
- **Never** write a key, a secret, an address of the operator's or an IP into
  `portfolio_remember`; the Account refuses them, and a memory grants nothing.
