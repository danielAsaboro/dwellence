# Connectivity measurement protocol

Dwellence measures route-specific performance between the contributor phone and the configured controlled HTTPS endpoint. It does not estimate a property's maximum internet speed.

The current `connectivity-mvp-1` protocol performs one uncached 125,000-byte download, one 125,000-byte upload, and three sequential HTTPS pings. It records the total measured duration, download and upload throughput, mean round-trip latency, mean absolute jitter, endpoint URL, timestamp, exposed network type, minimized client class, and location accuracy. Packet loss is reported as unavailable because three successful HTTP requests do not support a defensible packet-loss estimate.

Every accepted result must name the exact operator-configured `PROBE_PUBLIC_URL` and is bound to a server-issued one-use nonce, the authenticated contributor session, the commissioned request, its time window, and an accuracy-aware location tolerance. Results naming another HTTPS endpoint are rejected before the nonce is consumed. The server rejects missing or non-finite fields, negative values, results older than ten minutes, durations outside 0–120 seconds, throughput above 10,000 Mbps, latency or jitter above 10 seconds, reused nonces, duplicate payload digests, out-of-window measurements, and out-of-tolerance locations.

The controlled endpoint caps each upload and download payload at 1 MiB and rate-limits download, upload, and ping requests by network address. A failed or interrupted run produces no accepted measurement; the contributor can request a fresh nonce and restart safely.
