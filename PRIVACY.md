# Privacy Notice

Last updated: September 6, 2026

Dwellence processes only the data needed to commission, verify, purchase, and privately display a location-evidence report.

## Data used

- A Nimiq wallet address and wallet signatures establish control of that address; they do not establish civil identity.
- With separate consent, Nimiq Pay supplies an origin-scoped device handle for abuse controls. The backend stores only a one-way digest. The handle identifies a device, not a person.
- A seeker supplies a precise property location and time window. A contributor grants session location to validate that a measurement occurred within the requested tolerance.
- Connectivity results, environmental readings, sensor metadata, timestamps, and verification outcomes support the private report.
- Minimal first-party analytics contain an allowlisted event name, a digest of an ephemeral in-memory client identifier, and a timestamp. Analytics reject additional fields and are deleted after 30 days.

Exact property and measurement locations are encrypted at rest and kept off-chain. Nimiq transaction data contains only an opaque purchase reference. Dwellence does not record audio, video, contacts, recovery phrases, or private keys.

## Sharing and public aggregates

The purchasing wallet can access the full private report. The invited contributor receives only a coarse task area. Public area scores remain suppressed until at least five independent contributor/device pairs have qualifying evidence across at least three distinct days. No property point or contributor route is published.

## Retention and control

The server runs retention enforcement on startup and every 24 hours. It purges expired sessions and nonces, replaces encrypted precise property and measurement locations with a generalized marker after 30 days, and deletes accepted raw evidence and private reports after 90 days. Operators must still verify the job against the deployed persistent datastore before public testing and document deletion of rejected diagnostics and minimized operational logs outside the application database within 30 days. Participants may request earlier deletion from the repository owner, subject to retaining the minimum record required to resolve an active payment or security incident.

## Limits

Measurements describe a particular time, device, endpoint, and setting. Signatures establish key origin, not physical truth, placement, or calibration. Dwellence is not an inspector, appraiser, surveyor, insurer, or government authority.
