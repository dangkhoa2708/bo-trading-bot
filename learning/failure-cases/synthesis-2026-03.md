# Synthesis — failure cases (March 2026)

Cross-case fixes are summarized here; see individual files under [`cases/`](cases/) for charts and detail.

## Universal rule: longer lookback reconfirmation

**When the short window says there is a signal, the engine should always look back on a longer horizon and reconfirm before emitting.** The local pattern (last few candles + EMA) is only **step one**; **step two** is “does the wider chart still justify this?”

That single habit would have caught every case here:

| Case | What a longer lookback reconfirms |
|------|-----------------------------------|
| 001, 004 | Impulse not already **over-extended** (same-direction run / cap total impulse). |
| 002, 005 | Price not **into support** (002) or a **major low** (005) without a deliberate break rule. |
| 003 | Confirming green not an **outlier** vs recent bars (median / ATR band), not only “strong” locally. |

Concrete checks differ by setup, but the **pipeline is the same**: **candidate signal → wider lookback → pass or veto.**

## Non-negotiable: cap total impulse in a longer lookback

**Do not treat this as optional.** Across **Case 001** (UP) and **Case 004** (DOWN), the engine fails when “last 3 strong” stays true **after** the move has already run for many same-direction bars (with only **micro pauses** in between).

**Rule intent:** If there are already **≥ N** same-direction impulse bodies in a **longer lookback**—counting the run as one impulse when counter candles are **too small** to count as a real reset—then **suppress Momentum**, even if the short window still shows “3 strong” + EMA.

This is separate from (and complementary to) “fire only on exactly the 3rd bar of a streak”: you need **both** a clean **early-leg** definition **and** a **hard stop** on how extended the larger impulse is allowed to be.

It is also the **Momentum-specific** implementation of the **universal reconfirmation** rule above (impulse extension is one of the things the wider pass must check).

## Other pillars (from full review)

- **Levels (002, 005):** Distance to support/resistance on **short and long** horizons; filter or require break.
- **Mirror (003):** Upper bound on “strong green” vs median/ATR (spike filter).

These are **other reconfirmation dimensions** on the same “longer lookback” pass—same idea, different checks.

## Case IDs

| Theme | Cases |
|--------|--------|
| Impulse extension / late sliding “3” | 001, 004 |
| Into support (tight vs wide lookback) | 002, 005 |
| Mirror outlier green | 003 |
