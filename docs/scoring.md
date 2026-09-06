# Scoring reference

Every report stores the scorer version used at creation. Scores are deterministic interpretations of accepted evidence, not inspections, guarantees, or proof of physical truth.

## Private report scorer `mvp-1`

Connectivity components are normalized to 0–100:

- download: `clamp(download Mbps, 0, 100)`;
- upload: `clamp(upload Mbps × 2, 0, 100)`;
- latency: `clamp((300 − latency ms) ÷ 2.9, 0, 100)`;
- jitter: `clamp((100 − jitter ms) ÷ 0.98, 0, 100)`.

The connectivity category score is the rounded weighted mean with weights 25, 15, 25, and 20 respectively. Packet loss is excluded because the current three-request HTTPS probe cannot defensibly estimate it.

Environmental comfort uses an informational target of 24 °C and 50% relative humidity. Temperature loses 100 points over a 12 °C absolute deviation; humidity loses 100 points over a 40-point absolute deviation. Each component is floored at zero, and the category score is their rounded equal-weight mean.

The default Location Evidence Score is the equal-weight mean of available commissioned category scores. An unrequested or missing category is excluded rather than assigned zero or a neutral value. The user may change personal suitability weights in the unlocked report; this recomputes only the personal Suitability Score and never changes stored category scores or the Location Evidence Score.

Confidence is displayed separately. The MVP reports integrity, freshness, spatial tolerance, temporal coverage, contributor independence, device quality, and context completeness. A single-session report remains low-confidence even when its signatures and nonces verify.

## Public area scorer `area-1`

Area publication requires at least five unique contributor-wallet/sensor pairs across at least three UTC dates. Evidence older than 90 days is excluded, only the newest report from each pair is used, and each report receives exponential recency weight `exp(−age ÷ 30 days)`. Published category values are rounded weighted means. The displayed confidence band is the 25th–75th percentile range of per-report equal-category means. Every response includes the qualified sample count, pair count, distinct-day count, time span, thresholds, scorer version, and method. Below either threshold, the API returns `insufficient_evidence` and no score.

Changing a scoring rule requires a new version string; existing report JSON retains its original scores and version.
