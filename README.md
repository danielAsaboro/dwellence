# Dwellence

Dwellence is an invitation-only Nimiq Pay Mini App for commissioning fresh, private connectivity and environmental evidence about a property. A seeker signs a private request; an invited contributor accepts it; a physical sensor submits a nonce-bound Ed25519-signed temperature/humidity reading; and the backend rejects altered or replayed readings.

This repository is the public product code. It does not claim that a signature proves physical placement, calibration, truth, habitability, safety, appraisal value, or payment success. It is not escrow or a custodian. Dwellence means dwelling plus evidence: fresh evidence for how a place actually performs.

## What is implemented locally

- Nimiq Pay wallet authentication with address-to-public-key verification through `@nimiq/core`.
- SQLite-backed, expiring, one-use server nonces, short-lived sessions, and persistent wallet/network/probe rate limits.
- Encrypted-at-rest precise request locations; only a coarse cell is stored separately.
- Invitation-only request acceptance by the designated contributor.
- Seeker-signed measurement windows and explicit required categories; connectivity remains mandatory for location validation, while missing unrequested categories are excluded rather than assigned a default score.
- Nimiq-wallet-signed ownership binding for physical sensor metadata, reporting interval, and Ed25519 keys; retained private device signatures, signed sensor challenges, plausibility bounds, and replay rejection.
- A real browser connectivity probe against a configured controlled endpoint; no local result is represented as accepted evidence.
- Accuracy-aware location-tolerance checks with encrypted measurement coordinates and minimized device/network context.
- Optional human observations stored and displayed separately as low-confidence contributor statements, never as instrument readings.
- A same-origin controlled download, upload, and latency probe with payload caps.
- Versioned category scores, explicit confidence dimensions, default Location Evidence weights, and seeker-adjustable personal suitability weights that do not alter evidence.
- Privacy-safe public aggregation with 90-day freshness, recency weighting, one-report-per-contributor/device influence caps, confidence bands, and suppression until five independent pairs across three days.
- First-party allowlisted analytics that store only event names, digested ephemeral client IDs, and timestamps—never wallets, coordinates, signatures, or measurement payloads.
- Separate action-specific consent gates and an anonymous early-access feedback form with explicit evidence consent and opaque receipt IDs.
- Sealed reports, opaque direct-payment intents, bounded canonical-RPC polling, idempotent wallet-gated unlocks, and retry UX that never asks the user to pay twice.
- Enforced startup/daily retention: expired security records are purged, precise locations are generalized after 30 days, and raw evidence/private reports are deleted after 90 days.
- A single Docker deployment serving the compiled Mini App, verifier API, probe, and health endpoint.

## Not yet proven or enabled

- A physical ESP32-class sensor has not been connected to this workspace.
- Nimiq Pay has not been exercised on two real phones in this checkout.
- The testnet NIM payment, RPC lookup, and report unlock have not been exercised against real Nimiq Pay accounts or a live RPC in this workspace.
- A controlled HTTPS probe deployment, public backend deployment, consenting participants, and a real property mission are required before any end-to-end claim.

## Local development

Requirements: Node.js 24+ and npm.

```sh
npm install
npm test
npm run build
```

Start the verifier only after setting a unique server-only encryption secret:

```sh
export LOCATION_ENCRYPTION_KEY='a-unique-secret-at-least-24-characters-long'
export ALLOWED_ORIGINS='http://127.0.0.1:5173'
export NIMIQ_RPC_URL='https://YOUR-VERIFIED-TESTNET-NIMIQ-RPC'
npm run server
```

Start the Mini App in a separate terminal:

```sh
VITE_API_URL='http://YOUR-LAN-IP:8787' VITE_PROBE_URL='http://YOUR-LAN-IP:8787/probe' npm run dev -- --host
```

Load the network URL from Nimiq Pay on a phone connected to the same network. Use testnet and low-value accounts. Never enter a private key or recovery phrase into this app.

## Production container

Build and run the same-origin production image on an HTTPS host with a persistent volume mounted at `/data`:

```sh
docker build -t dwellence .
docker run --rm -p 8787:8787 \
  -e LOCATION_ENCRYPTION_KEY='a-unique-server-secret-at-least-24-characters' \
  -e NIMIQ_RPC_URL='https://YOUR-VERIFIED-TESTNET-NIMIQ-RPC' \
  -v dwellence-data:/data \
  dwellence
```

The health check is `GET /healthz`. Do not deploy without HTTPS, persistent private storage, a unique encryption secret, and a testnet RPC endpoint verified against a known transaction.

## Evidence boundaries

The report must keep exact addresses, coordinates, sensor readings, device handles, and full report contents off-chain. Direct NIM transaction data may contain only an opaque report-purchase reference. Read the [privacy notice](PRIVACY.md), [security policy](SECURITY.md), [scoring reference](docs/scoring.md), [connectivity protocol](docs/connectivity-protocol.md), [sensor protocol](docs/sensor-protocol.md), and [physical proof runbook](docs/physical-proof-runbook.md) before a real test.

## License

MIT
