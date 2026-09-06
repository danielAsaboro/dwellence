import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  consumeNonce,
  isValidNimiqAddress,
  issueNonce,
  sha256,
  verifyEd25519Signature,
  verifyNimiqWalletSignature,
} from "./security.mjs";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { lookupIncludedTransaction } from "./nimiq-rpc.mjs";
import { buildAreaAggregate } from "./aggregate.mjs";
import { verifyPurchaseTransaction } from "./purchase.mjs";

const JSON_LIMIT = 64 * 1024;

function send(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response, status) {
  response.writeHead(status, { "cache-control": "no-store" });
  response.end();
}

function canonicalAddress(address) {
  return String(address).replaceAll(" ", "").toUpperCase();
}

function opaqueId(prefix) {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

function encryptLocation(value, secret) {
  const iv = randomBytes(12);
  const key = createHash("sha256").update(secret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}

function decryptLocation(value, secret) {
  const payload = Buffer.from(value, "base64url");
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    payload.subarray(0, 12),
  );
  decipher.setAuthTag(payload.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final(),
    ]).toString("utf8"),
  );
}

function distanceMeters(first, second) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > JSON_LIMIT) throw new Error("PAYLOAD_TOO_LARGE");
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("INVALID_JSON");
  }
}

async function consumeBody(request, limit = 1024 * 1024) {
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error("PAYLOAD_TOO_LARGE");
  }
  return bytes;
}

function requireSession(request, store, role) {
  const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const session = store
    .prepare(
      "SELECT wallet_address, role FROM sessions WHERE token_digest = ? AND expires_at >= ?",
    )
    .get(sha256(token), Date.now());
  return session && (!role || session.role === role) ? session : null;
}

function publicCell(latitude, longitude) {
  return `${Number(latitude).toFixed(2)},${Number(longitude).toFixed(2)}`;
}

function validCoordinates(location) {
  return (
    Number.isFinite(location?.latitude) &&
    Number.isFinite(location?.longitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    location.longitude >= -180 &&
    location.longitude <= 180
  );
}

function normalizeRequiredCategories(categories) {
  const value =
    categories === undefined
      ? ["connectivity", "environmental_comfort"]
      : categories;
  if (
    !Array.isArray(value) ||
    !value.includes("connectivity") ||
    value.length > 2 ||
    value.some(
      (category) =>
        !["connectivity", "environmental_comfort"].includes(category),
    ) ||
    new Set(value).size !== value.length
  )
    return null;
  return [...value].sort();
}

function sensorMessage(reading) {
  return `${reading.requestId}\n${reading.nonce}\n${reading.timestamp}\n${reading.temperatureC}\n${reading.humidityPercent}`;
}

function connectivityMessage(reading) {
  return `${reading.requestId}\n${reading.nonce}\n${reading.endpoint}\n${reading.downloadMbps}\n${reading.uploadMbps}\n${reading.latencyMs}\n${reading.jitterMs}\n${reading.durationMs}\n${reading.measuredAt}\n${reading.location.latitude}\n${reading.location.longitude}\n${reading.location.accuracyMeters}\n${reading.context.networkType}\n${reading.context.userAgentClass}`;
}

function requestDigest({
  location,
  invitedContributor,
  windowStartsAt,
  windowEndsAt,
  priceLuna,
}) {
  return sha256(
    JSON.stringify({
      latitude: Number(location?.latitude),
      longitude: Number(location?.longitude),
      invitedContributor: canonicalAddress(invitedContributor),
      windowStartsAt: Number(windowStartsAt),
      windowEndsAt: Number(windowEndsAt),
      priceLuna: Number(priceLuna),
    }),
  );
}

function requestSignatureMessage(
  walletAddress,
  digest,
  challengeId,
  expiresAt,
) {
  return `Dwellence private request\nSeeker: ${walletAddress}\nRequest digest: ${digest}\nNonce: ${challengeId}\nExpires: ${new Date(expiresAt).toISOString()}`;
}

function sensorBindingDigest({
  publicKey,
  model,
  firmware,
  calibrationStatus,
  reportingIntervalSeconds,
}) {
  return sha256(
    JSON.stringify({
      publicKey: String(publicKey).toLowerCase(),
      model: String(model).trim(),
      firmware: String(firmware).trim(),
      calibrationStatus: String(calibrationStatus).trim(),
      reportingIntervalSeconds: Number(reportingIntervalSeconds),
    }),
  );
}

function sensorBindingMessage(walletAddress, digest, challengeId, expiresAt) {
  return `Dwellence sensor ownership binding\nOperator: ${walletAddress}\nSensor metadata digest: ${digest}\nNonce: ${challengeId}\nExpires: ${new Date(expiresAt).toISOString()}\nThis signature binds the sensor key to this wallet; it does not certify placement or calibration.`;
}

function calculateConnectivityScore(reading) {
  const download = Math.max(0, Math.min(100, reading.download_mbps));
  const upload = Math.max(0, Math.min(100, reading.upload_mbps * 2));
  const latency = Math.max(0, Math.min(100, (300 - reading.latency_ms) / 2.9));
  const jitter = Math.max(0, Math.min(100, (100 - reading.jitter_ms) / 0.98));
  return Math.round(
    (download * 25 + upload * 15 + latency * 25 + jitter * 20) / 85,
  );
}

function calculateComfortScore(reading) {
  const temperature = Math.max(
    0,
    100 - (Math.abs(reading.temperature_c - 24) / 12) * 100,
  );
  const humidity = Math.max(
    0,
    100 - (Math.abs(reading.humidity_percent - 50) / 40) * 100,
  );
  return Math.round((temperature + humidity) / 2);
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function withinRateLimit(store, key, limit, windowMs) {
  const bucket = Math.floor(Date.now() / windowMs);
  const keyDigest = sha256(key);
  const result = store
    .prepare(
      `
    INSERT INTO rate_limits (key_digest, window_bucket, count) VALUES (?, ?, 1)
    ON CONFLICT(key_digest, window_bucket) DO UPDATE SET count = count + 1
    RETURNING count
  `,
    )
    .get(keyDigest, bucket);
  store
    .prepare(
      "DELETE FROM rate_limits WHERE key_digest = ? AND window_bucket < ?",
    )
    .run(keyDigest, bucket - 2);
  return result.count <= limit;
}

export function createApp({
  store,
  locationEncryptionKey,
  allowedOrigins = [],
  nimiqRpcUrl = process.env.NIMIQ_RPC_URL,
  transactionLookup = null,
  staticDirectory = null,
}) {
  if (!locationEncryptionKey || locationEncryptionKey.length < 24)
    throw new Error("LOCATION_ENCRYPTION_KEY is required");
  const staticRoot = staticDirectory ? resolve(staticDirectory) : null;

  return createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (
        origin &&
        allowedOrigins.length > 0 &&
        !allowedOrigins.includes(origin)
      )
        return send(response, 403, { code: "ORIGIN_FORBIDDEN" });
      if (origin && allowedOrigins.includes(origin)) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        response.setHeader(
          "access-control-allow-methods",
          "GET, POST, OPTIONS",
        );
        response.setHeader(
          "access-control-allow-headers",
          "authorization, content-type",
        );
        response.setHeader("access-control-max-age", "600");
        return sendEmpty(response, 204);
      }

      const url = new URL(request.url, "http://local");
      if (request.method === "GET" && url.pathname === "/healthz")
        return send(response, 200, { status: "ok" });
      if (request.method === "GET" && url.pathname === "/probe/download") {
        if (
          !withinRateLimit(
            store,
            `probe:${request.socket.remoteAddress ?? "unknown"}`,
            120,
            60_000,
          )
        )
          return send(response, 429, { code: "RATE_LIMITED" });
        const bytes = Number(url.searchParams.get("bytes"));
        if (!Number.isInteger(bytes) || bytes < 1 || bytes > 1024 * 1024)
          return send(response, 400, { code: "INVALID_PROBE_SIZE" });
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": String(bytes),
          "cache-control": "no-store",
        });
        return response.end(randomBytes(bytes));
      }
      if (request.method === "POST" && url.pathname === "/probe/upload") {
        if (
          !withinRateLimit(
            store,
            `probe:${request.socket.remoteAddress ?? "unknown"}`,
            120,
            60_000,
          )
        )
          return send(response, 429, { code: "RATE_LIMITED" });
        await consumeBody(request);
        return sendEmpty(response, 204);
      }
      if (request.method === "GET" && url.pathname === "/probe/ping") {
        if (
          !withinRateLimit(
            store,
            `probe:${request.socket.remoteAddress ?? "unknown"}`,
            120,
            60_000,
          )
        )
          return send(response, 429, { code: "RATE_LIMITED" });
        return sendEmpty(response, 204);
      }

      if (request.method === "POST" && url.pathname === "/api/analytics") {
        const payload = await readJson(request);
        const allowed = new Set([
          "app_opened_inside_nimiq_pay",
          "app_opened_outside_nimiq_pay",
          "wallet_request_started",
          "wallet_request_approved",
          "wallet_request_denied",
          "request_created",
          "request_shared",
          "request_accepted",
          "request_expired",
          "measurement_started",
          "measurement_completed",
          "measurement_rejected",
          "sensor_challenge_passed",
          "sensor_challenge_failed",
          "report_previewed",
          "payment_started",
          "payment_cancelled",
          "payment_submitted",
          "payment_included",
          "payment_failed",
          "report_unlocked",
          "aggregate_viewed",
          "aggregate_suppressed",
          "feedback_submitted",
        ]);
        if (
          Object.keys(payload).some(
            (key) => !["event", "clientId"].includes(key),
          ) ||
          !allowed.has(payload.event) ||
          !/^client_[a-zA-Z0-9_-]{16,80}$/.test(String(payload.clientId))
        )
          return send(response, 400, { code: "INVALID_ANALYTICS_EVENT" });
        store
          .prepare(
            "INSERT INTO analytics_events (event, client_digest, created_at) VALUES (?, ?, ?)",
          )
          .run(payload.event, sha256(payload.clientId), Date.now());
        return send(response, 201, { status: "recorded" });
      }

      if (request.method === "POST" && url.pathname === "/api/feedback") {
        const payload = await readJson(request);
        if (
          Object.keys(payload).some(
            (key) =>
              !["clientId", "rating", "comment", "evidenceConsent"].includes(
                key,
              ),
          ) ||
          !/^client_[a-zA-Z0-9_-]{16,80}$/.test(String(payload.clientId)) ||
          !Number.isInteger(payload.rating) ||
          payload.rating < 1 ||
          payload.rating > 5 ||
          typeof payload.comment !== "string" ||
          !payload.comment.trim() ||
          payload.comment.length > 1000 ||
          payload.evidenceConsent !== true
        )
          return send(response, 400, { code: "INVALID_FEEDBACK" });
        if (
          !withinRateLimit(
            store,
            `feedback:${payload.clientId}`,
            3,
            24 * 60 * 60_000,
          )
        )
          return send(response, 429, { code: "RATE_LIMITED" });
        const receiptId = opaqueId("feedback");
        const now = Date.now();
        store
          .prepare(
            "INSERT INTO tester_feedback (id, client_digest, rating, comment, evidence_consent_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            receiptId,
            sha256(payload.clientId),
            payload.rating,
            payload.comment.trim(),
            now,
            now,
          );
        return send(response, 201, { receiptId, recordedAt: now });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/challenge") {
        const { role, address } = await readJson(request);
        if (
          !["seeker", "contributor"].includes(role) ||
          !isValidNimiqAddress(address)
        )
          return send(response, 400, { code: "INVALID_AUTH_REQUEST" });
        const walletAddress = canonicalAddress(address);
        if (
          !withinRateLimit(
            store,
            `auth-wallet:${walletAddress}`,
            20,
            5 * 60_000,
          ) ||
          !withinRateLimit(
            store,
            `auth-network:${request.socket.remoteAddress ?? "unknown"}`,
            60,
            5 * 60_000,
          )
        )
          return send(response, 429, { code: "RATE_LIMITED" });
        const challengeId = opaqueId("auth");
        const expiresAt = Date.now() + 5 * 60_000;
        const binding = JSON.stringify({
          role,
          walletAddress,
          challengeId,
          expiresAt,
        });
        issueNonce(store, "wallet-auth", binding, 300, challengeId);
        const message = `Dwellence authentication\nRole: ${role}\nAddress: ${walletAddress}\nNonce: ${challengeId}\nExpires: ${new Date(expiresAt).toISOString()}`;
        return send(response, 201, { challengeId, message, expiresAt });
      }

      if (request.method === "POST" && url.pathname === "/api/auth/verify") {
        const { challengeId, publicKey, signature, address, deviceHandle } =
          await readJson(request);
        if (
          deviceHandle !== undefined &&
          !/^[0-9a-f]{64}$/i.test(String(deviceHandle))
        )
          return send(response, 400, { code: "INVALID_DEVICE_HANDLE" });
        const nonceRows = store
          .prepare(
            "SELECT binding FROM nonces WHERE purpose = 'wallet-auth' AND consumed_at IS NULL",
          )
          .all();
        const record = nonceRows
          .map((row) => JSON.parse(row.binding))
          .find((row) => row.challengeId === challengeId);
        if (!record || canonicalAddress(address) !== record.walletAddress)
          return send(response, 401, { code: "AUTH_CHALLENGE_INVALID" });
        const nonceRow = store
          .prepare(
            "SELECT digest FROM nonces WHERE purpose = 'wallet-auth' AND binding = ?",
          )
          .get(JSON.stringify(record));
        const message = `Dwellence authentication\nRole: ${record.role}\nAddress: ${record.walletAddress}\nNonce: ${challengeId}\nExpires: ${new Date(record.expiresAt).toISOString()}`;
        if (
          !nonceRow ||
          !verifyNimiqWalletSignature(message, signature, publicKey, address)
        )
          return send(response, 401, { code: "SIGNATURE_INVALID" });
        if (
          !consumeNonce(
            store,
            challengeId,
            "wallet-auth",
            JSON.stringify(record),
          )
        )
          return send(response, 401, {
            code: "AUTH_CHALLENGE_USED_OR_EXPIRED",
          });
        const token = randomBytes(32).toString("base64url");
        store
          .prepare(
            "INSERT INTO sessions (token_digest, wallet_address, role, device_handle_digest, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            sha256(token),
            record.walletAddress,
            record.role,
            deviceHandle ? sha256(deviceHandle) : null,
            Date.now() + 30 * 60_000,
            Date.now(),
          );
        return send(response, 200, {
          token,
          walletAddress: record.walletAddress,
          expiresAt: Date.now() + 30 * 60_000,
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/requests/challenge"
      ) {
        const session = requireSession(request, store, "seeker");
        if (!session)
          return send(response, 401, { code: "SEEKER_AUTH_REQUIRED" });
        const draft = await readJson(request);
        const requiredCategories = normalizeRequiredCategories(
          draft.requiredCategories,
        );
        if (!requiredCategories)
          return send(response, 400, { code: "INVALID_REQUEST" });
        const digest = requestDigest({ ...draft, requiredCategories });
        const challengeId = opaqueId("request");
        issueNonce(
          store,
          "request-signature",
          `${session.wallet_address}:${digest}`,
          300,
          challengeId,
        );
        const expiresAt = store
          .prepare("SELECT expires_at FROM nonces WHERE digest = ?")
          .get(sha256(challengeId)).expires_at;
        return send(response, 201, {
          challengeId,
          message: requestSignatureMessage(
            session.wallet_address,
            digest,
            challengeId,
            expiresAt,
          ),
          expiresAt,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/requests") {
        const session = requireSession(request, store, "seeker");
        if (!session)
          return send(response, 401, { code: "SEEKER_AUTH_REQUIRED" });
        const {
          location,
          invitedContributor,
          requiredCategories: requestedCategories,
          windowStartsAt,
          windowEndsAt,
          priceLuna,
          requestChallengeId,
          publicKey,
          signature,
        } = await readJson(request);
        const requiredCategories =
          normalizeRequiredCategories(requestedCategories);
        if (!requestChallengeId || !publicKey || !signature)
          return send(response, 401, { code: "REQUEST_SIGNATURE_REQUIRED" });
        if (
          !requiredCategories ||
          !validCoordinates(location) ||
          !isValidNimiqAddress(invitedContributor) ||
          !Number.isInteger(priceLuna) ||
          priceLuna <= 0 ||
          !Number.isFinite(windowStartsAt) ||
          !Number.isFinite(windowEndsAt) ||
          windowEndsAt <= windowStartsAt
        )
          return send(response, 400, { code: "INVALID_REQUEST" });
        const digest = requestDigest({
          location,
          invitedContributor,
          requiredCategories,
          windowStartsAt,
          windowEndsAt,
          priceLuna,
        });
        const nonce = store
          .prepare(
            "SELECT expires_at FROM nonces WHERE digest = ? AND purpose = 'request-signature' AND binding = ? AND consumed_at IS NULL",
          )
          .get(
            sha256(requestChallengeId),
            `${session.wallet_address}:${digest}`,
          );
        if (
          !nonce ||
          !verifyNimiqWalletSignature(
            requestSignatureMessage(
              session.wallet_address,
              digest,
              requestChallengeId,
              nonce.expires_at,
            ),
            signature,
            publicKey,
            session.wallet_address,
          )
        )
          return send(response, 401, { code: "REQUEST_SIGNATURE_INVALID" });
        if (
          !consumeNonce(
            store,
            requestChallengeId,
            "request-signature",
            `${session.wallet_address}:${digest}`,
          )
        )
          return send(response, 409, {
            code: "REQUEST_SIGNATURE_USED_OR_EXPIRED",
          });
        const id = opaqueId("req");
        const shareCode = randomBytes(18).toString("base64url");
        store
          .prepare(
            "INSERT INTO requests (id, seeker_address, invited_contributor, location_ciphertext, public_cell, window_starts_at, window_ends_at, price_luna, required_categories_json, share_code, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            session.wallet_address,
            canonicalAddress(invitedContributor),
            encryptLocation(location, locationEncryptionKey),
            publicCell(location.latitude, location.longitude),
            windowStartsAt,
            windowEndsAt,
            priceLuna,
            JSON.stringify(requiredCategories),
            shareCode,
            "shared",
            Date.now(),
          );
        return send(response, 201, { id, shareCode, status: "shared" });
      }

      const acceptMatch = url.pathname.match(
        /^\/api\/invitations\/([^/]+)\/accept$/,
      );
      if (request.method === "POST" && acceptMatch) {
        const session = requireSession(request, store, "contributor");
        if (!session)
          return send(response, 401, { code: "CONTRIBUTOR_AUTH_REQUIRED" });
        const invitation = store
          .prepare(
            "SELECT id, public_cell, price_luna, required_categories_json, window_starts_at, window_ends_at FROM requests WHERE share_code = ? AND invited_contributor = ? AND status = 'shared'",
          )
          .get(acceptMatch[1], session.wallet_address);
        if (invitation && invitation.window_ends_at < Date.now()) {
          store
            .prepare(
              "UPDATE requests SET status = 'expired' WHERE id = ? AND status = 'shared'",
            )
            .run(invitation.id);
          return send(response, 410, { code: "REQUEST_EXPIRED" });
        }
        const updated = store
          .prepare(
            "UPDATE requests SET accepted_by = ?, status = 'accepted' WHERE share_code = ? AND invited_contributor = ? AND status = 'shared' AND window_ends_at >= ?",
          )
          .run(
            session.wallet_address,
            acceptMatch[1],
            session.wallet_address,
            Date.now(),
          );
        if (updated.changes !== 1)
          return send(response, 409, { code: "REQUEST_UNAVAILABLE" });
        return send(response, 200, {
          id: invitation.id,
          status: "accepted",
          approximateArea: invitation.public_cell,
          priceLuna: invitation.price_luna,
          requiredCategories: JSON.parse(invitation.required_categories_json),
          windowStartsAt: invitation.window_starts_at,
          windowEndsAt: invitation.window_ends_at,
        });
      }

      const cancelMatch = url.pathname.match(
        /^\/api\/requests\/([^/]+)\/cancel$/,
      );
      if (request.method === "POST" && cancelMatch) {
        const session = requireSession(request, store, "seeker");
        if (!session)
          return send(response, 401, { code: "SEEKER_AUTH_REQUIRED" });
        const updated = store
          .prepare(
            `UPDATE requests SET status = 'cancelled'
             WHERE id = ? AND seeker_address = ? AND status IN ('shared', 'accepted')
               AND NOT EXISTS (SELECT 1 FROM connectivity_measurements WHERE request_id = requests.id)
               AND NOT EXISTS (SELECT 1 FROM sensor_readings WHERE request_id = requests.id)`,
          )
          .run(cancelMatch[1], session.wallet_address);
        if (updated.changes !== 1)
          return send(response, 409, { code: "REQUEST_CANNOT_BE_CANCELLED" });
        return send(response, 200, { id: cancelMatch[1], status: "cancelled" });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/sensors/registration-challenge"
      ) {
        const session = requireSession(request, store, "contributor");
        if (!session)
          return send(response, 401, { code: "CONTRIBUTOR_AUTH_REQUIRED" });
        const metadata = await readJson(request);
        const key = Buffer.from(String(metadata.publicKey), "hex");
        if (
          !/^[0-9a-f]{64}$/i.test(String(metadata.publicKey)) ||
          key.length !== 32 ||
          !String(metadata.model).trim() ||
          !String(metadata.firmware).trim() ||
          !Number.isInteger(metadata.reportingIntervalSeconds) ||
          metadata.reportingIntervalSeconds < 1 ||
          metadata.reportingIntervalSeconds > 3600 ||
          !["manufacturer-specified", "field-checked", "uncalibrated"].includes(
            String(metadata.calibrationStatus),
          )
        )
          return send(response, 400, { code: "INVALID_SENSOR_REGISTRATION" });
        const digest = sensorBindingDigest(metadata);
        const challengeId = opaqueId("sensor_binding");
        issueNonce(
          store,
          "sensor-binding",
          `${session.wallet_address}:${digest}`,
          300,
          challengeId,
        );
        const expiresAt = store
          .prepare("SELECT expires_at FROM nonces WHERE digest = ?")
          .get(sha256(challengeId)).expires_at;
        return send(response, 201, {
          challengeId,
          message: sensorBindingMessage(
            session.wallet_address,
            digest,
            challengeId,
            expiresAt,
          ),
          expiresAt,
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/sensors/register"
      ) {
        const session = requireSession(request, store, "contributor");
        if (!session)
          return send(response, 401, { code: "CONTRIBUTOR_AUTH_REQUIRED" });
        const {
          publicKey,
          model,
          firmware,
          calibrationStatus,
          reportingIntervalSeconds,
          registrationChallengeId,
          walletPublicKey,
          walletSignature,
        } = await readJson(request);
        if (!registrationChallengeId || !walletPublicKey || !walletSignature)
          return send(response, 401, {
            code: "SENSOR_BINDING_SIGNATURE_REQUIRED",
          });
        const key = Buffer.from(String(publicKey), "hex");
        if (
          !/^[0-9a-f]{64}$/i.test(String(publicKey)) ||
          key.length !== 32 ||
          !String(model).trim() ||
          !String(firmware).trim() ||
          !Number.isInteger(reportingIntervalSeconds) ||
          reportingIntervalSeconds < 1 ||
          reportingIntervalSeconds > 3600 ||
          !["manufacturer-specified", "field-checked", "uncalibrated"].includes(
            String(calibrationStatus),
          )
        )
          return send(response, 400, { code: "INVALID_SENSOR_REGISTRATION" });
        const digest = sensorBindingDigest({
          publicKey,
          model,
          firmware,
          calibrationStatus,
          reportingIntervalSeconds,
        });
        const binding = `${session.wallet_address}:${digest}`;
        const nonce = store
          .prepare(
            "SELECT expires_at FROM nonces WHERE digest = ? AND purpose = 'sensor-binding' AND binding = ? AND consumed_at IS NULL",
          )
          .get(sha256(registrationChallengeId), binding);
        if (
          !nonce ||
          !verifyNimiqWalletSignature(
            sensorBindingMessage(
              session.wallet_address,
              digest,
              registrationChallengeId,
              nonce.expires_at,
            ),
            walletSignature,
            walletPublicKey,
            session.wallet_address,
          )
        )
          return send(response, 401, {
            code: "SENSOR_BINDING_SIGNATURE_INVALID",
          });
        if (
          !consumeNonce(
            store,
            registrationChallengeId,
            "sensor-binding",
            binding,
          )
        )
          return send(response, 409, {
            code: "SENSOR_BINDING_SIGNATURE_USED_OR_EXPIRED",
          });
        const id = opaqueId("sensor");
        try {
          store
            .prepare(
              "INSERT INTO sensors (id, operator_address, public_key, model, firmware, calibration_status, reporting_interval_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              id,
              session.wallet_address,
              key,
              model.trim(),
              firmware.trim(),
              calibrationStatus.trim(),
              reportingIntervalSeconds,
              Date.now(),
            );
        } catch {
          return send(response, 409, { code: "SENSOR_PUBLIC_KEY_REGISTERED" });
        }
        return send(response, 201, { id, state: "challenged" });
      }

      const sensorChallengeMatch = url.pathname.match(
        /^\/api\/sensors\/([^/]+)\/challenge$/,
      );
      if (request.method === "POST" && sensorChallengeMatch) {
        const session = requireSession(request, store, "contributor");
        if (!session)
          return send(response, 401, { code: "CONTRIBUTOR_AUTH_REQUIRED" });
        const sensor = store
          .prepare(
            "SELECT id FROM sensors WHERE id = ? AND operator_address = ?",
          )
          .get(sensorChallengeMatch[1], session.wallet_address);
        if (!sensor) return send(response, 404, { code: "SENSOR_NOT_FOUND" });
        const nonce = issueNonce(store, "sensor-reading", sensor.id, 300);
        return send(response, 201, {
          sensorId: sensor.id,
          nonce,
          expiresAt: Date.now() + 300_000,
        });
      }

      const sensorReadingMatch = url.pathname.match(
        /^\/api\/sensors\/([^/]+)\/readings$/,
      );
      if (request.method === "POST" && sensorReadingMatch) {
        const reading = await readJson(request);
        const sensor = store
          .prepare(
            "SELECT id, operator_address, public_key, reporting_interval_seconds FROM sensors WHERE id = ?",
          )
          .get(sensorReadingMatch[1]);
        if (!sensor) return send(response, 404, { code: "SENSOR_NOT_FOUND" });
        if (
          !Number.isFinite(reading.timestamp) ||
          !Number.isFinite(reading.temperatureC) ||
          !Number.isFinite(reading.humidityPercent) ||
          !String(reading.nonce) ||
          !String(reading.requestId) ||
          !/^[0-9a-f]{128}$/i.test(String(reading.signature))
        )
          return send(response, 400, { code: "INVALID_SENSOR_READING" });
        if (
          !verifyEd25519Signature(
            Buffer.from(sensorMessage(reading)),
            Buffer.from(reading.signature, "hex"),
            Buffer.from(sensor.public_key),
          )
        )
          return send(response, 422, { code: "SENSOR_SIGNATURE_INVALID" });
        if (!consumeNonce(store, reading.nonce, "sensor-reading", sensor.id))
          return send(response, 409, { code: "SENSOR_NONCE_USED_OR_EXPIRED" });
        const mission = store
          .prepare(
            "SELECT id FROM requests WHERE id = ? AND accepted_by = ? AND status = 'accepted' AND window_starts_at <= ? AND window_ends_at >= ?",
          )
          .get(
            reading.requestId,
            sensor.operator_address,
            reading.timestamp,
            reading.timestamp,
          );
        if (!mission)
          return send(response, 422, {
            code: "READING_NOT_BOUND_TO_ACTIVE_REQUEST",
          });
        if (
          reading.temperatureC < -20 ||
          reading.temperatureC > 60 ||
          reading.humidityPercent < 0 ||
          reading.humidityPercent > 100 ||
          Math.abs(Date.now() - reading.timestamp) > 10 * 60_000
        )
          return send(response, 422, { code: "READING_IMPLAUSIBLE_OR_STALE" });
        const payloadDigest = sha256(sensorMessage(reading));
        try {
          store
            .prepare(
              "INSERT INTO sensor_readings (id, sensor_id, request_id, payload_digest, signature_hex, temperature_c, humidity_percent, observed_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              opaqueId("env"),
              sensor.id,
              reading.requestId,
              payloadDigest,
              String(reading.signature).toLowerCase(),
              reading.temperatureC,
              reading.humidityPercent,
              reading.timestamp,
              Date.now(),
            );
          store
            .prepare(
              "UPDATE sensors SET state = 'active', last_seen_at = ? WHERE id = ?",
            )
            .run(Date.now(), sensor.id);
        } catch {
          return send(response, 409, { code: "SENSOR_PAYLOAD_REPLAYED" });
        }
        return send(response, 201, {
          status: "accepted",
          integrity: "valid_signature_and_nonce",
        });
      }

      const measurementChallengeMatch = url.pathname.match(
        /^\/api\/requests\/([^/]+)\/measurement-challenge$/,
      );
      if (request.method === "POST" && measurementChallengeMatch) {
        const session = requireSession(request, store, "contributor");
        if (!session)
          return send(response, 401, { code: "CONTRIBUTOR_AUTH_REQUIRED" });
        const mission = store
          .prepare(
            "SELECT id FROM requests WHERE id = ? AND accepted_by = ? AND status = 'accepted'",
          )
          .get(measurementChallengeMatch[1], session.wallet_address);
        if (!mission)
          return send(response, 404, { code: "ACTIVE_ASSIGNMENT_NOT_FOUND" });
        const nonce = issueNonce(
          store,
          "connectivity-reading",
          `${mission.id}:${session.wallet_address}`,
          300,
        );
        return send(response, 201, {
          requestId: mission.id,
          nonce,
          expiresAt: Date.now() + 300_000,
        });
      }

      const connectivityMatch = url.pathname.match(
        /^\/api\/requests\/([^/]+)\/connectivity$/,
      );
      if (request.method === "POST" && connectivityMatch) {
        const session = requireSession(request, store, "contributor");
        if (!session)
          return send(response, 401, { code: "CONTRIBUTOR_AUTH_REQUIRED" });
        const reading = await readJson(request);
        if (
          !String(reading.endpoint).startsWith("https://") ||
          !String(reading.nonce) ||
          !Number.isFinite(reading.downloadMbps) ||
          !Number.isFinite(reading.uploadMbps) ||
          !Number.isFinite(reading.latencyMs) ||
          !Number.isFinite(reading.jitterMs) ||
          !Number.isFinite(reading.durationMs) ||
          !Number.isFinite(reading.measuredAt) ||
          !validCoordinates(reading.location) ||
          !Number.isFinite(reading.location?.accuracyMeters) ||
          !String(reading.context?.networkType).trim() ||
          !String(reading.context?.userAgentClass).trim()
        )
          return send(response, 400, { code: "INVALID_CONNECTIVITY_READING" });
        const mission = store
          .prepare(
            "SELECT id, location_ciphertext FROM requests WHERE id = ? AND accepted_by = ? AND status = 'accepted' AND window_starts_at <= ? AND window_ends_at >= ?",
          )
          .get(
            connectivityMatch[1],
            session.wallet_address,
            reading.measuredAt,
            reading.measuredAt,
          );
        if (!mission)
          return send(response, 422, {
            code: "READING_NOT_BOUND_TO_ACTIVE_REQUEST",
          });
        if (
          reading.location.accuracyMeters < 0 ||
          reading.location.accuracyMeters > 500
        )
          return send(response, 422, {
            code: "LOCATION_CONFIDENCE_INSUFFICIENT",
          });
        const requestedLocation = decryptLocation(
          mission.location_ciphertext,
          locationEncryptionKey,
        );
        if (
          distanceMeters(requestedLocation, reading.location) >
          Math.max(250, reading.location.accuracyMeters)
        )
          return send(response, 422, {
            code: "LOCATION_OUTSIDE_REQUEST_TOLERANCE",
          });
        if (
          reading.downloadMbps < 0 ||
          reading.downloadMbps > 10_000 ||
          reading.uploadMbps < 0 ||
          reading.uploadMbps > 10_000 ||
          reading.latencyMs < 0 ||
          reading.latencyMs > 10_000 ||
          reading.jitterMs < 0 ||
          reading.jitterMs > 10_000 ||
          reading.durationMs <= 0 ||
          reading.durationMs > 120_000 ||
          Math.abs(Date.now() - reading.measuredAt) > 10 * 60_000
        )
          return send(response, 422, {
            code: "CONNECTIVITY_READING_IMPLAUSIBLE_OR_STALE",
          });
        if (
          !consumeNonce(
            store,
            reading.nonce,
            "connectivity-reading",
            `${mission.id}:${session.wallet_address}`,
          )
        )
          return send(response, 409, {
            code: "CONNECTIVITY_NONCE_USED_OR_EXPIRED",
          });
        const digest = sha256(
          connectivityMessage({ requestId: mission.id, ...reading }),
        );
        try {
          store
            .prepare(
              "INSERT INTO connectivity_measurements (id, request_id, payload_digest, endpoint, download_mbps, upload_mbps, latency_ms, jitter_ms, duration_ms, location_ciphertext, location_accuracy_m, network_type, client_context, measured_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              opaqueId("net"),
              mission.id,
              digest,
              reading.endpoint,
              reading.downloadMbps,
              reading.uploadMbps,
              reading.latencyMs,
              reading.jitterMs,
              reading.durationMs,
              encryptLocation(
                {
                  latitude: reading.location.latitude,
                  longitude: reading.location.longitude,
                },
                locationEncryptionKey,
              ),
              reading.location.accuracyMeters,
              String(reading.context.networkType).slice(0, 32),
              String(reading.context.userAgentClass).slice(0, 100),
              reading.measuredAt,
              Date.now(),
            );
        } catch {
          return send(response, 409, { code: "CONNECTIVITY_PAYLOAD_REPLAYED" });
        }
        return send(response, 201, {
          status: "accepted",
          integrity: "session_nonce_and_context_valid",
        });
      }

      const submitMatch = url.pathname.match(
        /^\/api\/requests\/([^/]+)\/submit$/,
      );
      const observationsMatch = url.pathname.match(
        /^\/api\/requests\/([^/]+)\/observations$/,
      );
      if (request.method === "POST" && observationsMatch) {
        const session = requireSession(request, store, "contributor");
        if (!session)
          return send(response, 401, { code: "CONTRIBUTOR_AUTH_REQUIRED" });
        const mission = store
          .prepare(
            "SELECT id FROM requests WHERE id = ? AND accepted_by = ? AND status = 'accepted'",
          )
          .get(observationsMatch[1], session.wallet_address);
        if (!mission)
          return send(response, 404, { code: "ACTIVE_ASSIGNMENT_NOT_FOUND" });
        const observation = await readJson(request);
        const allowedSettings = [
          "indoors",
          "outdoors",
          "common_area",
          "not_stated",
        ];
        const allowedExperiences = ["observed", "not_observed", "not_checked"];
        const providers = observation.providerNames;
        if (
          !allowedSettings.includes(observation.setting) ||
          !allowedExperiences.includes(observation.powerInterruption) ||
          !allowedExperiences.includes(observation.waterAvailability) ||
          !allowedExperiences.includes(observation.drainage) ||
          !Array.isArray(providers) ||
          providers.length > 5 ||
          providers.some(
            (name) =>
              typeof name !== "string" || !name.trim() || name.length > 80,
          )
        )
          return send(response, 400, {
            code: "INVALID_CONTRIBUTOR_OBSERVATION",
          });
        const recorded = {
          evidenceClass: "contributor_observation",
          setting: observation.setting,
          powerInterruption: observation.powerInterruption,
          waterAvailability: observation.waterAvailability,
          drainage: observation.drainage,
          providerNames: providers.map((name) => name.trim()),
          confidence: "low",
          limitation:
            "Self-reported observation; not an instrument measurement.",
        };
        const now = Date.now();
        store
          .prepare(
            `INSERT INTO contributor_observations (request_id, contributor_address, observation_json, observed_at, accepted_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(request_id) DO UPDATE SET observation_json = excluded.observation_json, observed_at = excluded.observed_at, accepted_at = excluded.accepted_at`,
          )
          .run(
            mission.id,
            session.wallet_address,
            JSON.stringify(recorded),
            now,
            now,
          );
        return send(response, 201, {
          status: "accepted",
          observation: recorded,
        });
      }

      if (request.method === "POST" && submitMatch) {
        const session = requireSession(request, store, "contributor");
        if (!session)
          return send(response, 401, { code: "CONTRIBUTOR_AUTH_REQUIRED" });
        const mission = store
          .prepare(
            "SELECT id, seeker_address, accepted_by, price_luna, public_cell, required_categories_json FROM requests WHERE id = ? AND accepted_by = ? AND status = 'accepted'",
          )
          .get(submitMatch[1], session.wallet_address);
        if (!mission)
          return send(response, 404, { code: "ACTIVE_ASSIGNMENT_NOT_FOUND" });
        const sensor = store
          .prepare(
            "SELECT sensor_readings.*, sensors.model, sensors.firmware, sensors.calibration_status, sensors.reporting_interval_seconds FROM sensor_readings JOIN sensors ON sensors.id = sensor_readings.sensor_id WHERE request_id = ? ORDER BY accepted_at DESC LIMIT 1",
          )
          .get(mission.id);
        const connectivity = store
          .prepare(
            "SELECT * FROM connectivity_measurements WHERE request_id = ? ORDER BY accepted_at DESC LIMIT 1",
          )
          .get(mission.id);
        const observationRow = store
          .prepare(
            "SELECT observation_json FROM contributor_observations WHERE request_id = ?",
          )
          .get(mission.id);
        const requiredCategories = JSON.parse(mission.required_categories_json);
        if (
          (requiredCategories.includes("environmental_comfort") && !sensor) ||
          (requiredCategories.includes("connectivity") && !connectivity)
        )
          return send(response, 422, { code: "REQUIRED_EVIDENCE_MISSING" });
        const reportId = opaqueId("report");
        const createdAt = Date.now();
        const measuredTimes = [
          sensor?.observed_at,
          connectivity?.measured_at,
        ].filter(Number.isFinite);
        const confidenceDimensions = {
          integrity: "verified",
          freshness: "within_window",
          spatial: connectivity ? "within_tolerance" : "not_applicable",
          temporalCoverage: "single_session",
          contributorIndependence: "single_contributor",
          deviceQuality: sensor?.calibration_status ?? "not_applicable",
          contextualCompleteness:
            connectivity?.network_type && connectivity?.client_context
              ? "recorded"
              : "limited",
        };
        const preview = {
          categories: requiredCategories,
          excludedCategories: ["connectivity", "environmental_comfort"].filter(
            (category) => !requiredCategories.includes(category),
          ),
          evidenceCount: requiredCategories.length,
          measuredAt: Math.max(...measuredTimes),
          confidence: "low",
          confidenceDimensions,
          scorerVersion: "mvp-1",
        };
        const connectivityEvidence = connectivity
          ? {
              endpoint: connectivity.endpoint,
              downloadMbps: connectivity.download_mbps,
              uploadMbps: connectivity.upload_mbps,
              latencyMs: connectivity.latency_ms,
              jitterMs: connectivity.jitter_ms,
              durationMs: connectivity.duration_ms,
              networkType: connectivity.network_type,
              clientContext: connectivity.client_context,
              locationAccuracyMeters: connectivity.location_accuracy_m,
              sampleCount: 1,
              categoryScore: calculateConnectivityScore(connectivity),
            }
          : null;
        const comfortEvidence = sensor
          ? {
              temperatureC: sensor.temperature_c,
              humidityPercent: sensor.humidity_percent,
              sensorModel: sensor.model,
              firmware: sensor.firmware,
              calibrationStatus: sensor.calibration_status,
              reportingIntervalSeconds: sensor.reporting_interval_seconds,
              signature: sensor.signature_hex,
              sampleCount: 1,
              categoryScore: calculateComfortScore(sensor),
            }
          : null;
        const defaultWeights = { connectivity: 50, environmentalComfort: 50 };
        const availableScores = [
          connectivityEvidence?.categoryScore,
          comfortEvidence?.categoryScore,
        ].filter(Number.isFinite);
        const report = {
          ...preview,
          areaCell: mission.public_cell,
          defaultWeights,
          locationEvidenceScore: Math.round(
            availableScores.reduce((sum, score) => sum + score, 0) /
              availableScores.length,
          ),
          limitations: [
            "Measurements reflect a specific time and endpoint context.",
            "Signatures prove key origin, not physical placement or calibration.",
            "This is not an inspection, appraisal, or habitability certification.",
          ],
          connectivity: connectivityEvidence,
          environmentalComfort: comfortEvidence,
          contributorObservations: observationRow
            ? JSON.parse(observationRow.observation_json)
            : null,
        };
        try {
          store
            .prepare(
              "INSERT INTO reports (id, request_id, seeker_address, contributor_address, price_luna, preview_json, report_json, scorer_version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(
              reportId,
              mission.id,
              mission.seeker_address,
              mission.accepted_by,
              mission.price_luna,
              JSON.stringify(preview),
              JSON.stringify(report),
              "mvp-1",
              "awaiting_payment",
              createdAt,
            );
          store
            .prepare(
              "UPDATE requests SET status = 'awaiting_payment' WHERE id = ?",
            )
            .run(mission.id);
        } catch {
          return send(response, 409, { code: "REPORT_ALREADY_GENERATED" });
        }
        return send(response, 201, { reportId, preview });
      }

      const previewMatch = url.pathname.match(
        /^\/api\/reports\/([^/]+)\/preview$/,
      );
      if (request.method === "GET" && previewMatch) {
        const session = requireSession(request, store, "seeker");
        const report =
          session &&
          store
            .prepare(
              "SELECT preview_json, price_luna, contributor_address FROM reports WHERE id = ? AND seeker_address = ?",
            )
            .get(previewMatch[1], session.wallet_address);
        if (!report)
          return send(response, 404, { code: "PRIVATE_REPORT_NOT_FOUND" });
        return send(response, 200, {
          preview: JSON.parse(report.preview_json),
          priceLuna: report.price_luna,
          contributorAddress: report.contributor_address,
        });
      }

      const purchaseIntentMatch = url.pathname.match(
        /^\/api\/reports\/([^/]+)\/purchase-intent$/,
      );
      if (request.method === "POST" && purchaseIntentMatch) {
        const session = requireSession(request, store, "seeker");
        if (!session)
          return send(response, 401, { code: "SEEKER_AUTH_REQUIRED" });
        const report = store
          .prepare(
            "SELECT id, seeker_address, contributor_address, price_luna FROM reports WHERE id = ? AND seeker_address = ? AND status = 'awaiting_payment'",
          )
          .get(purchaseIntentMatch[1], session.wallet_address);
        if (!report)
          return send(response, 404, { code: "PAYABLE_REPORT_NOT_FOUND" });
        const existing = store
          .prepare(
            "SELECT id, reference, expected_luna, contributor_address, state FROM purchases WHERE report_id = ?",
          )
          .get(report.id);
        if (existing)
          return send(response, 200, {
            id: existing.id,
            reference: existing.reference,
            recipient: existing.contributor_address,
            valueLuna: existing.expected_luna,
            state: existing.state,
          });
        const purchase = {
          id: opaqueId("purchase"),
          reference: `rep:${sha256(opaqueId("reference")).slice(0, 32)}`,
        };
        store
          .prepare(
            "INSERT INTO purchases (id, report_id, seeker_address, contributor_address, expected_luna, reference, state) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            purchase.id,
            report.id,
            session.wallet_address,
            report.contributor_address,
            report.price_luna,
            purchase.reference,
            "not_started",
          );
        return send(response, 201, {
          ...purchase,
          recipient: report.contributor_address,
          valueLuna: report.price_luna,
          state: "not_started",
        });
      }

      const purchaseVerifyMatch = url.pathname.match(
        /^\/api\/purchases\/([^/]+)\/verify$/,
      );
      if (request.method === "POST" && purchaseVerifyMatch) {
        const session = requireSession(request, store, "seeker");
        if (!session)
          return send(response, 401, { code: "SEEKER_AUTH_REQUIRED" });
        const purchase = store
          .prepare(
            "SELECT purchases.*, reports.id AS report_id FROM purchases JOIN reports ON reports.id = purchases.report_id WHERE purchases.id = ? AND purchases.seeker_address = ?",
          )
          .get(purchaseVerifyMatch[1], session.wallet_address);
        if (!purchase)
          return send(response, 404, { code: "PURCHASE_NOT_FOUND" });
        const { transactionHash } = await readJson(request);
        if (!/^[0-9a-f]{64}$/i.test(String(transactionHash)))
          return send(response, 400, { code: "INVALID_TRANSACTION_HASH" });
        if (!nimiqRpcUrl && !transactionLookup)
          return send(response, 503, { code: "NIMIQ_RPC_NOT_CONFIGURED" });
        let transaction;
        try {
          transaction = transactionLookup
            ? await transactionLookup(transactionHash)
            : await lookupIncludedTransaction(nimiqRpcUrl, transactionHash);
        } catch {
          return send(response, 503, { code: "NIMIQ_RPC_UNAVAILABLE" });
        }
        const verified = verifyPurchaseTransaction(
          {
            recipient: purchase.contributor_address,
            valueLuna: purchase.expected_luna,
            reference: purchase.reference,
          },
          transaction,
        );
        if (!verified.included) {
          store
            .prepare(
              "UPDATE purchases SET transaction_hash = ?, state = ? WHERE id = ?",
            )
            .run(
              transactionHash,
              verified.reason === "NOT_INCLUDED" ? "pending" : "mismatched",
              purchase.id,
            );
          return send(
            response,
            verified.reason === "NOT_INCLUDED" ? 202 : 422,
            {
              state:
                verified.reason === "NOT_INCLUDED" ? "pending" : "mismatched",
              reason: verified.reason,
            },
          );
        }
        store
          .prepare(
            "UPDATE purchases SET transaction_hash = ?, state = 'included', unlocked_at = COALESCE(unlocked_at, ?) WHERE id = ?",
          )
          .run(transactionHash, Date.now(), purchase.id);
        store
          .prepare("UPDATE reports SET status = 'unlocked' WHERE id = ?")
          .run(purchase.report_id);
        return send(response, 200, {
          state: "included",
          reportId: purchase.report_id,
        });
      }

      const reportMatch = url.pathname.match(/^\/api\/reports\/([^/]+)$/);
      if (request.method === "GET" && reportMatch) {
        const session = requireSession(request, store, "seeker");
        const report =
          session &&
          store
            .prepare(
              "SELECT report_json FROM reports WHERE id = ? AND seeker_address = ? AND status = 'unlocked'",
            )
            .get(reportMatch[1], session.wallet_address);
        if (!report)
          return send(response, 404, { code: "PRIVATE_REPORT_NOT_UNLOCKED" });
        return send(response, 200, { report: JSON.parse(report.report_json) });
      }

      const areaMatch = url.pathname.match(/^\/api\/areas\/([^/]+)$/);
      if (request.method === "GET" && areaMatch) {
        const cell = decodeURIComponent(areaMatch[1]);
        if (!/^-?\d{1,3}\.\d{2},-?\d{1,3}\.\d{2}$/.test(cell))
          return send(response, 400, { code: "INVALID_AREA_CELL" });
        const rows = store
          .prepare(
            `
          SELECT requests.accepted_by, sensor_readings.sensor_id, sensor_readings.accepted_at, reports.report_json
          FROM requests
          JOIN sensor_readings ON sensor_readings.request_id = requests.id
          JOIN reports ON reports.request_id = requests.id
          WHERE requests.public_cell = ?
          ORDER BY sensor_readings.accepted_at DESC
        `,
          )
          .all(cell);
        return send(response, 200, buildAreaAggregate(cell, rows));
      }

      if (
        request.method === "GET" &&
        staticRoot &&
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/probe/")
      ) {
        const requestedPath =
          url.pathname === "/"
            ? "index.html"
            : decodeURIComponent(url.pathname.slice(1));
        let filePath = resolve(staticRoot, requestedPath);
        if (
          filePath !== staticRoot &&
          !filePath.startsWith(`${staticRoot}${sep}`)
        )
          return send(response, 400, { code: "INVALID_STATIC_PATH" });
        if (!existsSync(filePath) || !statSync(filePath).isFile())
          filePath = resolve(staticRoot, "index.html");
        const contentTypes = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".json": "application/json; charset=utf-8",
        };
        response.writeHead(200, {
          "content-type":
            contentTypes[extname(filePath)] ?? "application/octet-stream",
          "cache-control":
            extname(filePath) === ".html"
              ? "no-cache"
              : "public, max-age=31536000, immutable",
        });
        return response.end(readFileSync(filePath));
      }

      return send(response, 404, { code: "NOT_FOUND" });
    } catch (error) {
      const code =
        error instanceof Error &&
        ["PAYLOAD_TOO_LARGE", "INVALID_JSON"].includes(error.message)
          ? error.message
          : "INTERNAL_ERROR";
      return send(response, code === "INTERNAL_ERROR" ? 500 : 400, { code });
    }
  });
}
