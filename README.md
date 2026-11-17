# btc-race-24h-20261117-dip

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/bayuanwar8/btc-race-24h-20261117-dip/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/bayuanwar8/btc-race-24h-20261117-dip/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Washout Recovery — a dip-buy bot for Coinbase Wrapped BTC (cbBTC) vs USDC, built for make.fun's "Race a BTC trading bot live for 24 hours" bounty.

Strategy: wait for a sharp flush (close >= 1.2% below the 60-bar trailing high, with >= 0.5% of that fall in the last 10 bars), buy once with the full cash balance, then sell when the price has recovered 1.3% above the entry fill, or when the bounce fails (trailing stop 1.0% below the high since entry), or after 240 bars without a recovery. One full round trip costs ~26 bps in fees, slippage and impact, so the bot trades rarely — it aims to catch one or two big flush-and-recover moves in 24 hours, not to scalp.

Backtested on the competition's dev window (1,440 one-minute bars, 2026-11-16 06:03 UTC to 2026-11-17 06:03 UTC): net PnL +$15.62 on $1,000 starting capital (local grade via the kit's harness), 2 round trips, max drawdown ~1.2%.

## Run it

```sh
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=psxszbrd&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
