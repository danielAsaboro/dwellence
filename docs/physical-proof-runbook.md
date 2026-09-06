# Physical proof runbook

Do not record a success claim until every step below is observed on real hardware.

1. Configure Nimiq Pay testnet on two distinct phones and fund only low-value test accounts.
2. Deploy the Mini App and verifier over HTTPS; configure the exact production origin in `ALLOWED_ORIGINS`.
3. Run an ESP32-class device with a real temperature/humidity sensor and a generated-on-device Ed25519 key. Record model, firmware, and calibration state without recording a private key.
4. On seeker phone A, create and sign a request after reading the location, retention, aggregation, and direct-payment disclosures.
5. On contributor phone B, accept the invitation, grant location permission deliberately, run the connectivity probe, and collect one real sensor reading.
6. Submit an intentionally altered or replayed signed reading and capture the explicit rejection. Then submit the valid real reading and capture acceptance.
7. Do not describe payment, report unlock, or aggregate publication as tested until their endpoints are implemented and a canonical testnet transaction has been independently verified.
8. Store consented screenshots, transaction hashes, and feedback only under the private parent `../submission/evidence/`, with address and location redaction where appropriate.
