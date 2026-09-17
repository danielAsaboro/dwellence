# How to verify a real commissioned report

Do not record a success claim until every step below is observed on real hardware.

1. Configure Nimiq Pay testnet on two distinct supported devices with different wallets, and fund only low-value test accounts. An iPhone and an iPad can cover the two roles if Nimiq Pay runs on both; the tablet is not a substitute for a physical sensor.
2. Deploy the Mini App and verifier over HTTPS; configure the exact production origin in `ALLOWED_ORIGINS` and the exact controlled endpoint in `PROBE_PUBLIC_URL`. Check `/healthz`, `/probe/ping`, `/probe/download`, and `/probe/upload` before starting. Use the same app origin throughout the test.
3. Run an ESP32-class device with a real temperature/humidity sensor and a generated-on-device Ed25519 key. Record model, firmware, and calibration state without recording a private key.
4. On seeker phone A, create and sign a request after reading the location, retention, aggregation, and direct-payment disclosures.
5. On contributor phone B, accept the invitation, grant location permission deliberately, run the connectivity probe, and collect one real sensor reading.
6. Submit an intentionally altered signed reading and capture the explicit rejection. Submit the unchanged valid reading and capture acceptance, then resubmit it to capture replay rejection. Do not create instrument readings in a browser or test script; follow the [physical sensor protocol](sensor-protocol.md).
7. Load the sealed preview on the seeker device. Check the declared categories, timestamp, evidence count, scoring version, calibration disclosure, and separate confidence. An environmental request must not complete without its real sensor evidence.
8. Initiate the low-value report purchase and approve the native Nimiq Pay testnet transaction yourself. Record its hash. Observe pending confirmation and do not pay again merely because confirmation is delayed.
9. Confirm that the backend independently verifies inclusion, recipient, amount, and opaque purchase reference before opening the report. Retry verification for the same purchase and confirm that access is idempotent, without a second charge or a second unlock event.
10. Try opening the purchased private report from the contributor's different wallet. Capture the explicit access denial. Check the public-area response and verify that scores remain suppressed below the genuine independent-device/day thresholds; do not seed contributors to satisfy them.
11. In separate low-value sessions, cancel an approval, deny account access, interrupt connectivity, and retry a pending verification. Confirm that each state gives a recoverable error without claiming measurement or payment success. Never initiate a deliberately incorrect irreversible payment simply to test a rejection.
12. Collect dated feedback from consenting testers. Store consented screenshots, transaction hashes, and feedback only under the private parent `../submission/evidence/`, with address and location redaction where appropriate. Never include private keys, recovery phrases, authentication tokens, or exact locations in public evidence.

If no physical sensor is available, run a connectivity-only request by deselecting Environmental comfort. Record that session only as connectivity/payment proof; it does not satisfy the sensor-backed end-to-end verification requirement.
