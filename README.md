# Dwellence

Dwellence is an invitation-only Nimiq Pay Mini App for commissioning fresh, private connectivity and environmental evidence about a property. A seeker signs a private request; an invited contributor accepts it; a physical sensor submits a nonce-bound Ed25519-signed temperature/humidity reading; and the backend rejects altered or replayed readings.

This repository is the public product code. It does not claim that a signature proves physical placement, calibration, truth, habitability, safety, appraisal value, or payment success. It is not escrow or a custodian. Dwellence means dwelling plus evidence: fresh evidence for how a place actually performs.

## What is implemented locally

- Nimiq Pay wallet authentication with address-to-public-key verification through `@nimiq/core`.
- SQLite-backed, expiring, one-use server nonces and short-lived sessions.
- Encrypted-at-rest precise request locations; only a coarse cell is stored separately.
- Invitation-only request acceptance by the designated contributor.
- Registered Ed25519 sensor keys, signed sensor challenges, signed temperature/humidity ingestion, plausibility bounds, and replay rejection.
- A real browser connectivity probe against a configured controlled endpoint; no local result is represented as accepted evidence.
- Privacy-safe scoring primitives and public-aggregate suppression until five independent contributor/device pairs across three days.
- Sealed reports, opaque direct-payment intents, canonical Nimiq RPC transaction lookup, and idempotent wallet-gated unlocks.

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
export NIMIQ_RPC_URL='https://YOUR-TESTNET-NIMIQ-RPC'
npm run server
```

Start the Mini App in a separate terminal:

```sh
VITE_API_URL='http://YOUR-LAN-IP:8787' VITE_PROBE_URL='https://YOUR-CONTROLLED-PROBE' npm run dev -- --host
```

Load the network URL from Nimiq Pay on a phone connected to the same network. Use testnet and low-value accounts. Never enter a private key or recovery phrase into this app.

## Evidence boundaries

The report must keep exact addresses, coordinates, sensor readings, device handles, and full report contents off-chain. Direct NIM transaction data may contain only an opaque report-purchase reference. See [sensor protocol](docs/sensor-protocol.md) and the [physical proof runbook](docs/physical-proof-runbook.md) before a real test.

## License

MIT
