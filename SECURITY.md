# Security

Report vulnerabilities privately to the repository owner rather than opening a public issue containing property, wallet, or sensor details.

Never send a private key or recovery phrase. Dwellence never needs either. Use low-value testnet NIM during development and verify the recipient, amount, and opaque reference in Nimiq Pay before approval.

The backend requires a unique 24+ character `LOCATION_ENCRYPTION_KEY`, HTTPS, an explicit Nimiq RPC source, and a persistent private datastore. Do not expose server environment variables through `VITE_` names. Rotate compromised secrets and invalidate the associated deployment immediately.

Known MVP limitations are documented in the README and reports. Cryptographic signatures and transaction inclusion do not prove physical placement or measurement truth.
