<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  runConnectivityProbe,
  type ConnectivityProbeResult,
} from "./lib/connectivity";
import { humanizeApiError } from "./lib/errors";
import {
  connectWallet,
  requestAbuseControlDeviceHandle,
  restoreWalletSession,
  sendPurchasePayment,
  signMessage,
} from "./lib/nimiq";
import { pollPaymentInclusion, recoveryAction, persistPaymentReceipt, recoverPaymentReceipt } from "./lib/payment-polling";
import { calculateSuitability } from "./lib/suitability";
import { requireConsents } from "./lib/consent";
import { measurementProgressText } from "./lib/measurement-progress";
import { fetchWithTimeout } from "./lib/transport";

const apiUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(
  /\/$/,
  "",
);
const nimqNetwork = import.meta.env.VITE_NIMIQ_NETWORK || "";
const consentPolicyVersion = "privacy-2026-09-18";
const probeUrl = (
  import.meta.env.VITE_PROBE_URL || `${window.location.origin}/probe`
).replace(/\/$/, "");
const walletAddress = ref("");
const isWorkspace = /^\/workspace\/?$/.test(window.location.pathname);
const deskPanel = ref<"setup" | "requests" | "reports" | "feedback">("setup");
const insideNimiqPay = Boolean(window.nimiqPay || window.nimiq);
const analyticsClientId = `client_${crypto.randomUUID().replaceAll("-", "")}`;
const consensus = ref<boolean | null>(null);
const deviceConsent = ref(false);
const locationConsent = ref(false);
const measurementConsent = ref(false);
const retentionConsent = ref(false);
const aggregationConsent = ref(false);
const paymentConsent = ref(false);
const deviceHandle = ref("");
const sessionTokens = ref<Partial<Record<"seeker" | "contributor", string>>>(
  {},
);
const status = ref(
  "Open this Mini App in Nimiq Pay, then connect a testnet wallet.",
);
const busy = ref(false);
const requestId = ref("");
const invitationCode = ref("");
const acceptedTask = ref<{
  approximateArea: string;
  priceLuna: number;
  requiredCategories: string[];
  windowStartsAt: number;
  windowEndsAt: number;
} | null>(null);
const contributorAddress = ref("");
const targetLatitude = ref("");
const targetLongitude = ref("");
const targetLabel = ref("Private target property");
const priceNim = ref("0.01");
const windowMinutes = ref(60);
const requireConnectivity = ref(true);
const requireEnvironmentalComfort = ref(true);
const probe = ref<ConnectivityProbeResult | null>(null);
const sensorPublicKey = ref("");
const sensorModel = ref("BME280");
const sensorFirmware = ref("");
const sensorReportingIntervalSeconds = ref(60);
const calibrationStatus = ref<
  "manufacturer-specified" | "field-checked" | "uncalibrated"
>("uncalibrated");
const sensorId = ref("");
const sensorChallenge = ref<{ nonce: string; expiresAt: number } | null>(null);
const observationSetting = ref<
  "indoors" | "outdoors" | "common_area" | "not_stated"
>("indoors");
const powerInterruption = ref<"observed" | "not_observed" | "not_checked">(
  "not_checked",
);
const waterAvailability = ref<"observed" | "not_observed" | "not_checked">(
  "not_checked",
);
const drainage = ref<"observed" | "not_observed" | "not_checked">(
  "not_checked",
);
const providerNames = ref("");
const mode = ref<"seeker" | "contributor">("seeker");
const reportId = ref("");
const preview = ref<{
  categories: string[];
  confidence: string;
  scorerVersion: string;
} | null>(null);
const purchase = ref<{
  id: string;
  reference: string;
  recipient: string;
  valueLuna: number;
  state: string;
} | null>(null);
const transactionHash = ref("");
const loadedReportState = ref("");
const loadedReportId = ref("");
const paymentAction = computed(() => purchase.value ? recoveryAction(loadedReportState.value, purchase.value.state, transactionHash.value, loadedReportId.value, reportId.value) : null);
const report = ref<{
  areaCell: string;
  confidenceDimensions: Record<string, string>;
  limitations: string[];
  connectivity: null | {
    endpoint: string;
    downloadMbps: number;
    uploadMbps: number;
    latencyMs: number;
    jitterMs: number;
    durationMs: number;
    categoryScore: number;
  };
  environmentalComfort: null | {
    temperatureC: number;
    humidityPercent: number;
    categoryScore: number;
    reportingIntervalSeconds: number;
    signature: string;
  };
  contributorObservations: null | {
    setting: string;
    powerInterruption: string;
    waterAvailability: string;
    drainage: string;
    providerNames: string[];
    confidence: string;
    limitation: string;
  };
} | null>(null);
const areaAggregate = ref<{
  state: string;
  sampleCount: number;
  contributorDevicePairs: number;
  distinctDays: number;
  thresholds: { contributorDevicePairs: number; distinctDays: number };
} | null>(null);
const connectivityWeight = ref(50);
const comfortWeight = ref(50);
const feedbackRating = ref(5);
const feedbackComment = ref("");
const feedbackEvidenceConsent = ref(false);
const feedbackReceipt = ref("");
const readyForApi = computed(() => Boolean(apiUrl && walletAddress.value));
const suitabilityScore = computed(() =>
  report.value
    ? calculateSuitability(
        {
          connectivity: report.value.connectivity?.categoryScore,
          environmentalComfort:
            report.value.environmentalComfort?.categoryScore,
        },
        {
          connectivity: connectivityWeight.value,
          environmentalComfort: comfortWeight.value,
        },
      )
    : null,
);

function track(event: string) {
  if (!event.startsWith("app_opened_")) return;
  void fetchWithTimeout(`${apiUrl}/api/analytics`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, clientId: analyticsClientId }),
  }, fetch, 10_000).catch(() => undefined);
}

onMounted(() => {
  if (!isWorkspace) return;
  track(
    insideNimiqPay
      ? "app_opened_inside_nimiq_pay"
      : "app_opened_outside_nimiq_pay",
  );
  void restoreWalletSession().then((restored) => {
    if (!restored) return;
    walletAddress.value = restored.address;
    consensus.value = restored.consensusEstablished;
    status.value = restored.consensusEstablished
      ? "Wallet session restored. You can sign a private request."
      : "Wallet session restored, but consensus is unavailable.";
  });
});

async function api(path: string, options: RequestInit = {}) {
  if (!apiUrl)
    throw new Error("VITE_API_URL is not configured for this Mini App.");
  const response = await fetchWithTimeout(`${apiUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  }, fetch, 15_000);
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      humanizeApiError(body.code ?? body.reason ?? "UNKNOWN_SERVER_ERROR"),
    );
  return body;
}

async function authenticate(role: "seeker" | "contributor") {
  if (sessionTokens.value[role]) return { token: sessionTokens.value[role] };
  if (!deviceConsent.value)
    throw new Error(
      "Consent to the origin-scoped anti-abuse device handle before signing in.",
    );
  if (!deviceHandle.value)
    deviceHandle.value = await requestAbuseControlDeviceHandle();
  const challenge = await api("/api/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ role, address: walletAddress.value }),
  });
  const signed = await signMessage(challenge.message);
  const session = await api("/api/auth/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      address: walletAddress.value,
      deviceHandle: deviceHandle.value,
      ...signed,
    }),
  });
  sessionTokens.value[role] = session.token;
  await api("/api/consents", {
    method: "POST",
    headers: { authorization: `Bearer ${session.token}` },
    body: JSON.stringify({
      policyVersion: consentPolicyVersion,
      purposes: [
        ...(deviceConsent.value ? ["device"] : []),
        ...(locationConsent.value ? ["location"] : []),
        ...(measurementConsent.value ? ["measurement"] : []),
        ...(retentionConsent.value ? ["retention"] : []),
        ...(aggregationConsent.value ? ["aggregation"] : []),
        ...(paymentConsent.value ? ["payment"] : []),
      ],
    }),
  });
  return session;
}

async function connect() {
  busy.value = true;
  track("wallet_request_started");
  try {
    const connected = await connectWallet();
    track("wallet_request_approved");
    sessionTokens.value = {};
    walletAddress.value = connected.address;
    consensus.value = connected.consensusEstablished;
    status.value = connected.consensusEstablished
      ? "Wallet connected. You can sign a private request."
      : "Wallet connected, but consensus is unavailable.";
  } catch (error) {
    track("wallet_request_denied");
    status.value =
      error instanceof Error ? error.message : "Wallet connection failed.";
  } finally {
    busy.value = false;
  }
}

async function createRequest() {
  if (!contributorAddress.value.trim()) {
    status.value = "Enter the invited contributor’s Nimiq address first.";
    return;
  }
  busy.value = true;
  try {
    requireConsents(
      {
        location: locationConsent.value,
        measurement: measurementConsent.value,
        retention: retentionConsent.value,
        aggregation: aggregationConsent.value,
      },
      ["location", "measurement", "retention", "aggregation"],
    );
    const session = await authenticate("seeker");
    const latitude = Number(targetLatitude.value);
    const longitude = Number(targetLongitude.value);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)
      throw new Error("Enter the target property's latitude and longitude; contributor presence is measured separately.");
    const requiredCategories = [
      ...(requireConnectivity.value ? ["connectivity"] : []),
      ...(requireEnvironmentalComfort.value ? ["environmental_comfort"] : []),
    ];
    if (requiredCategories.length === 0)
      throw new Error("Select at least one required evidence category.");
    const duration = Math.round(Number(windowMinutes.value));
    if (!Number.isInteger(duration) || duration < 10 || duration > 1440)
      throw new Error("Choose a measurement window from 10 to 1,440 minutes.");
    const draft = {
      targetLocation: {
        latitude,
        longitude,
        label: targetLabel.value.trim() || "Private target property",
      },
      invitedContributor: contributorAddress.value,
      requiredCategories,
      windowStartsAt: Date.now(),
      windowEndsAt: Date.now() + duration * 60_000,
      priceLuna: Math.round(Number(priceNim.value) * 100_000),
    };
    const challenge = await api("/api/requests/challenge", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: JSON.stringify(draft),
    });
    const signed = await signMessage(challenge.message);
    const result = await api("/api/requests", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: JSON.stringify({
        ...draft,
        requestChallengeId: challenge.challengeId,
        ...signed,
      }),
    });
    requestId.value = result.id;
    invitationCode.value = result.shareCode;
    track("request_created");
    track("request_shared");
    status.value =
      "Private request created. Share the invitation code directly with the invited contributor.";
  } catch (error) {
    status.value =
      error instanceof Error ? error.message : "Request creation failed.";
  } finally {
    busy.value = false;
  }
}

async function acceptRequest() {
  if (!invitationCode.value.trim()) {
    status.value = "Enter the private invitation code first.";
    return;
  }
  busy.value = true;
  try {
    requireConsents(
      {
        location: locationConsent.value,
        measurement: measurementConsent.value,
        retention: retentionConsent.value,
        aggregation: aggregationConsent.value,
      },
      ["location", "measurement", "retention", "aggregation"],
    );
    const session = await authenticate("contributor");
    const accepted = await api(
      `/api/invitations/${encodeURIComponent(invitationCode.value)}/accept`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        body: "{}",
      },
    );
    track("request_accepted");
    requestId.value = accepted.id;
    acceptedTask.value = accepted;
    status.value =
      "Request accepted. Confirm the approximate area and run the connectivity measurement there.";
  } catch (error) {
    if (String(error).includes("expired")) track("request_expired");
    status.value =
      error instanceof Error ? error.message : "Request acceptance failed.";
  } finally {
    busy.value = false;
  }
}

async function cancelRequest() {
  if (!requestId.value) return;
  busy.value = true;
  try {
    const session = await authenticate("seeker");
    await api(`/api/requests/${encodeURIComponent(requestId.value)}/cancel`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: "{}",
    });
    invitationCode.value = "";
    status.value = "Request cancelled before measurement began.";
  } catch (error) {
    status.value =
      error instanceof Error ? error.message : "Request cancellation failed.";
  } finally {
    busy.value = false;
  }
}

async function measureConnectivity() {
  if (!probeUrl || !requestId.value) {
    status.value = !probeUrl
      ? "VITE_PROBE_URL is not configured. No connectivity result was created."
      : "Enter an accepted private request ID first.";
    return;
  }
  busy.value = true;
  track("measurement_started");
  const progressStartedAt = Date.now();
  status.value = measurementProgressText(0);
  const progressTimer = window.setInterval(() => {
    status.value = measurementProgressText(Date.now() - progressStartedAt);
  }, 1000);
  try {
    requireConsents(
      {
        location: locationConsent.value,
        measurement: measurementConsent.value,
      },
      ["location", "measurement"],
    );
    const position = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      }),
    );
    probe.value = await runConnectivityProbe({ endpoint: probeUrl });
    const session = await authenticate("contributor");
    const challenge = await api(
      `/api/requests/${encodeURIComponent(requestId.value)}/measurement-challenge`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        body: "{}",
      },
    );
    const connection = (
      navigator as Navigator & {
        connection?: { effectiveType?: string; type?: string };
      }
    ).connection;
    await api(
      `/api/requests/${encodeURIComponent(requestId.value)}/connectivity`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        body: JSON.stringify({
          ...probe.value,
          nonce: challenge.nonce,
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMeters: position.coords.accuracy,
          },
          context: {
            networkType:
              connection?.type ?? connection?.effectiveType ?? "not-exposed",
            userAgentClass: window.nimiq ? "nimiq-pay-webview" : "browser",
          },
        }),
      },
    );
    track("measurement_completed");
    status.value =
      "Connectivity evidence accepted. Wait for the real registered sensor reading, then seal the report.";
  } catch (error) {
    track("measurement_rejected");
    status.value =
      error instanceof Error
        ? error.message
        : "Connectivity measurement failed.";
  } finally {
    window.clearInterval(progressTimer);
    busy.value = false;
  }
}

async function registerSensor() {
  if (!sensorPublicKey.value || !sensorFirmware.value) {
    status.value = "Enter the sensor public key and firmware version.";
    return;
  }
  busy.value = true;
  try {
    requireConsents({ measurement: measurementConsent.value }, ["measurement"]);
    const session = await authenticate("contributor");
    const metadata = {
      publicKey: sensorPublicKey.value.trim(),
      model: sensorModel.value.trim(),
      firmware: sensorFirmware.value.trim(),
      calibrationStatus: calibrationStatus.value,
      reportingIntervalSeconds: sensorReportingIntervalSeconds.value,
    };
    const challenge = await api("/api/sensors/registration-challenge", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: JSON.stringify(metadata),
    });
    const signed = await signMessage(challenge.message);
    const result = await api("/api/sensors/register", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: JSON.stringify({
        ...metadata,
        registrationChallengeId: challenge.challengeId,
        walletPublicKey: signed.publicKey,
        walletSignature: signed.signature,
      }),
    });
    sensorId.value = result.id;
    status.value =
      "Sensor key registered and wallet-bound. Issue a reading nonce when the physical sensor is ready.";
  } catch (error) {
    status.value =
      error instanceof Error ? error.message : "Sensor registration failed.";
  } finally {
    busy.value = false;
  }
}

async function issueSensorChallenge() {
  if (!sensorId.value || !requestId.value) {
    status.value = "Register the sensor and accept a request first.";
    return;
  }
  busy.value = true;
  try {
    const session = await authenticate("contributor");
    sensorChallenge.value = await api(
      `/api/sensors/${encodeURIComponent(sensorId.value)}/challenge`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        body: "{}",
      },
    );
    track("sensor_challenge_passed");
    status.value =
      "One-use sensor nonce issued. Transfer the request ID and nonce to the physical sensor before expiry.";
  } catch (error) {
    track("sensor_challenge_failed");
    status.value =
      error instanceof Error ? error.message : "Sensor challenge failed.";
  } finally {
    busy.value = false;
  }
}

async function saveObservations() {
  if (!requestId.value) return;
  busy.value = true;
  try {
    requireConsents({ measurement: measurementConsent.value }, ["measurement"]);
    const session = await authenticate("contributor");
    await api(
      `/api/requests/${encodeURIComponent(requestId.value)}/observations`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        body: JSON.stringify({
          setting: observationSetting.value,
          powerInterruption: powerInterruption.value,
          waterAvailability: waterAvailability.value,
          drainage: drainage.value,
          providerNames: providerNames.value
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean),
        }),
      },
    );
    status.value =
      "Optional observations saved separately as low-confidence contributor statements.";
  } catch (error) {
    status.value =
      error instanceof Error ? error.message : "Observation submission failed.";
  } finally {
    busy.value = false;
  }
}

async function sealReport() {
  if (!requestId.value) {
    status.value = "Enter the accepted request ID first.";
    return;
  }
  busy.value = true;
  try {
    requireConsents(
      {
        retention: retentionConsent.value,
        aggregation: aggregationConsent.value,
      },
      ["retention", "aggregation"],
    );
    const session = await authenticate("contributor");
    const result = await api(
      `/api/requests/${encodeURIComponent(requestId.value)}/submit`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        body: "{}",
      },
    );
    reportId.value = result.reportId;
    status.value = `Sealed report preview created: ${result.reportId}`;
  } catch (error) {
    status.value =
      error instanceof Error ? error.message : "Report generation failed.";
  } finally {
    busy.value = false;
  }
}

async function loadPreview() {
  reportId.value = reportId.value.trim();
  if (!reportId.value) {
    status.value = "Enter the report ID shared by the contributor.";
    return;
  }
  busy.value = true;
  // Never retain another report's transfer or unlocked contents while switching IDs.
  purchase.value = null;
  transactionHash.value = "";
  report.value = null;
  preview.value = null;
  areaAggregate.value = null;
  loadedReportState.value = "";
  try {
    const session = await authenticate("seeker");
    const result = await api(
      `/api/reports/${encodeURIComponent(reportId.value)}/preview`,
      { headers: { authorization: `Bearer ${session.token}` } },
    );
    track("report_previewed");
    preview.value = result.preview;
    loadedReportState.value = result.reportState;
    loadedReportId.value = reportId.value;
    if (result.reportState === "unlocked") {
      const unlocked = await api(`/api/reports/${encodeURIComponent(reportId.value)}`, { headers: { authorization: `Bearer ${session.token}` } });
      report.value = unlocked.report;
      status.value = "Your already-purchased private report is open. No additional payment is needed.";
      return;
    }
    const intent = result.purchase || await api(
      `/api/reports/${encodeURIComponent(reportId.value)}/purchase-intent`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        body: "{}",
      },
    );
    purchase.value = {
      id: intent.id,
      reference: intent.reference,
      recipient: intent.recipient,
      valueLuna: intent.valueLuna,
      state: intent.state,
    };
    transactionHash.value = intent.transactionHash || "";
    if (!transactionHash.value) {
      try { transactionHash.value = recoverPaymentReceipt(window.localStorage, reportId.value, intent.id); } catch { /* Manual receipt recovery remains available when storage is disabled. */ }
    }
    if (transactionHash.value && purchase.value.state === "not_started") purchase.value.state = "pending";
    status.value = paymentAction.value === "verify_payment"
      ? "Existing transfer recovered. Retry verification only; do not send another payment."
      : paymentAction.value === "recover_hash"
        ? "This purchase already has a payment attempt. Recover its original hash from Nimiq Pay; do not pay again."
        : "Sealed preview loaded. Review the recipient and low-value testnet amount before the native payment approval.";
  } catch (error) {
    status.value =
      error instanceof Error ? error.message : "Preview loading failed.";
  } finally {
    busy.value = false;
  }
}

async function payAndUnlock() {
  if (!purchase.value || paymentAction.value !== "new_payment") return;
  busy.value = true;
  track("payment_started");
  try {
    requireConsents({ payment: paymentConsent.value }, ["payment"]);
    transactionHash.value = await sendPurchasePayment({
      recipient: purchase.value.recipient,
      value: purchase.value.valueLuna,
      data: purchase.value.reference,
    }, undefined, nimqNetwork);
    try {
      persistPaymentReceipt(window.localStorage, reportId.value, purchase.value.id, transactionHash.value);
    } catch {
      status.value = "Local receipt storage is unavailable. Keep the original transaction hash; do not pay again.";
    }
    purchase.value.state = "pending";
    track("payment_submitted");
    await verifyPayment(true);
  } catch (error) {
    track(transactionHash.value ? "payment_failed" : "payment_cancelled");
    status.value =
      error instanceof Error
        ? error.message
        : "Payment was not verified. The report remains sealed.";
  } finally {
    busy.value = false;
  }
}

async function verifyPayment(poll = false) {
  if (!purchase.value || paymentAction.value !== "verify_payment") return;
  busy.value = true;
  try {
    const session = await authenticate("seeker");
    const check = () =>
      api(`/api/purchases/${purchase.value!.id}/verify`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ transactionHash: transactionHash.value }),
      });
    const verification = poll
      ? await pollPaymentInclusion(check)
      : await check();
    if (verification.state !== "included") {
      status.value =
        "Payment is submitted but still pending canonical inclusion. Retry verification after testnet confirmation.";
      return;
    }
    track("payment_included");
    const unlocked = await api(
      `/api/reports/${encodeURIComponent(reportId.value)}`,
      { headers: { authorization: `Bearer ${session.token}` } },
    );
    report.value = unlocked.report;
    loadedReportState.value = "unlocked";
    purchase.value!.state = "included";
    areaAggregate.value = await api(
      `/api/areas/${encodeURIComponent(report.value!.areaCell)}`,
    );
    track("report_unlocked");
    track(
      areaAggregate.value!.state === "insufficient_evidence"
        ? "aggregate_suppressed"
        : "aggregate_viewed",
    );
    status.value =
      "Payment independently verified. Your private report is unlocked below.";
  } catch (error) {
    track("payment_failed");
    status.value =
      error instanceof Error
        ? error.message
        : "Payment verification failed. The report remains sealed.";
  } finally {
    busy.value = false;
  }
}

async function submitFeedback() {
  busy.value = true;
  try {
    const result = await api("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        clientId: analyticsClientId,
        rating: feedbackRating.value,
        comment: feedbackComment.value,
        evidenceConsent: feedbackEvidenceConsent.value,
      }),
    });
    feedbackReceipt.value = result.receiptId;
    track("feedback_submitted");
    status.value =
      "Feedback recorded with your evidence consent. Save the receipt ID for the test record.";
  } catch (error) {
    status.value =
      error instanceof Error ? error.message : "Feedback submission failed.";
  } finally {
    busy.value = false;
  }
}

async function withdrawData() {
  busy.value = true;
  try {
    const session = await authenticate(mode.value);
    await api("/api/privacy/withdraw", {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
      body: "{}",
    });
    sessionTokens.value = {};
    requestId.value = "";
    report.value = null;
    status.value = "Your unpublished requests and raw evidence were deleted or generalized; future actions require fresh consent.";
  } catch (error) {
    status.value = error instanceof Error ? error.message : "Privacy withdrawal failed.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <a class="skip-link" :href="isWorkspace ? '#workspace' : '#home'">Skip to main content</a>
  <main :class="{ 'app-shell': isWorkspace }">
    <nav class="site-nav" :aria-label="isWorkspace ? 'Application navigation' : 'Main navigation'">
      <a class="wordmark" href="/" aria-label="Dwellence home"><span class="brand-mark" aria-hidden="true">d.</span>Dwellence</a>
      <div v-if="!isWorkspace" class="nav-links"><a href="#method">The approach</a><a href="/workspace">Open workspace ↗</a></div>
      <div v-else class="nav-links"><span class="app-nav-current">Measurement desk</span><a href="/">Back to website ↗</a></div>
      <span class="network-tag"><i aria-hidden="true"></i>Nimiq Pay · Testnet</span>
    </nav>
    <template v-if="!isWorkspace">
    <header id="home" class="hero">
      <div class="hero-copy">
        <p class="eyebrow"><span class="short-rule"></span>A little certainty. Before you commit.</p>
        <h1>A good address.<br />But how does it<br /><em>actually live?</em></h1>
        <p class="lede">The listing tells a story. Get evidence of the everyday: the connection, the conditions, the things you’ll live with.</p>
        <a class="primary-link" href="/workspace">Commission a measurement <span aria-hidden="true">↗</span></a>
        <p class="hero-footnote">Private property reports. Direct NIM payments.<br />No inspections, appraisals, or guarantees.</p>
      </div>
      <div class="hero-art">
        <div class="art-caption"><span>THE EVERYDAY, EXAMINED</span><span>FIELD NOTES / 01</span></div>
        <svg class="architecture" viewBox="0 0 560 480" role="img" aria-labelledby="architecture-title">
          <title id="architecture-title">Conceptual architectural drawing of a home and measurement points. Not a measured property.</title>
          <defs><pattern id="draft-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#315445" stroke-opacity=".08" /></pattern></defs>
          <rect width="560" height="480" fill="url(#draft-grid)" />
          <g fill="none" stroke="#61786a"><path d="M40 372L304 440L527 304M40 390L304 458L527 322"/><path d="M68 86V388M501 100V339" stroke-dasharray="4 5"/></g>
          <path d="M94 327L296 382L471 277L263 223Z" fill="#90aa91" />
          <path d="M94 327V193L296 250V382Z" fill="#eae8dc" stroke="#354f40" stroke-width="1.4"/>
          <path d="M296 250L471 146V277L296 382Z" fill="#bac7ad" stroke="#354f40" stroke-width="1.4"/>
          <path d="M94 193L263 91L471 146L296 250Z" fill="#faf7ed" stroke="#354f40" stroke-width="1.4"/>
          <path d="M118 193L264 106L444 153L295 238Z" fill="#d2d7c4" stroke="#809080"/>
          <g stroke="#506959" fill="#f7f4e8" stroke-width="1.4"><path d="M127 223L173 236V287L127 274Z"/><path d="M200 244L264 262V327L200 309Z"/><path d="M326 254L364 231V284L326 307Z"/><path d="M391 215L439 186V238L391 267Z"/></g>
          <g stroke="#809080" fill="none"><path d="M150 229V280M127 249L173 262M232 253V318M200 277L264 295M345 243V295M326 281L364 258M415 200V252M391 241L439 212"/></g>
          <path d="M270 375V309L288 314V380" fill="#354f40"/>
          <g fill="none" stroke="#355846"><circle cx="178" cy="172" r="16"/><circle cx="178" cy="172" r="28" stroke-opacity=".35"/><path d="M166 172Q178 159 190 172M171 177Q178 170 185 177" stroke-width="2"/></g><circle cx="178" cy="181" r="2" fill="#355846"/>
          <g fill="none" stroke="#355846"><circle cx="382" cy="299" r="16"/><path d="M382 289V301M378 292H382M378 297H382" stroke-width="2"/><circle cx="382" cy="305" r="4"/><path d="M178 144V64H85M398 299H500V389H442"/></g>
          <g fill="#355846" font-size="11" font-family="ui-monospace,monospace"><text x="86" y="49">01 / CONNECTIVITY</text><text x="342" y="409">02 / CONDITIONS</text><text x="56" y="431" font-size="9">CONCEPT DRAWING — NOT LIVE DATA</text></g>
        </svg>
        <div class="art-footer"><span class="art-symbol" aria-hidden="true">✳</span><p>A place is more than<br />what’s in the photographs.</p><span class="art-index">01—02</span></div>
      </div>
    </header>
    <section id="method" class="method" aria-labelledby="method-title">
      <div class="method-intro"><p class="eyebrow">Less guesswork. More ground truth.</p><h2 id="method-title">Look beyond<br /><em>the listing.</em></h2></div>
      <article><span class="method-number">01 / COMMISSION</span><h3>Ask about a real place.</h3><p>Invite a contributor, choose the evidence you need, and set a measurement window and report price.</p></article>
      <article><span class="method-number">02 / MEASURE</span><h3>Keep the evidence fresh.</h3><p>Controlled connectivity checks and signed physical-sensor readings. Scores and confidence, kept separate.</p></article>
      <article><span class="method-number">03 / DECIDE</span><h3>Pay for a private report.</h3><p>A direct NIM transfer to the contributor. Access opens only after independent payment verification.</p></article>
    </section>
    <section class="landing-invitation"><div><p class="eyebrow">START WITH A QUESTION</p><h2>What do you need to know<br /><em>before you move?</em></h2></div><div><p>Commission a private report or contribute measurements through Nimiq Pay. Use low-value testnet accounts during early access.</p><a class="primary-link" href="/workspace">Open your workspace <span aria-hidden="true">↗</span></a></div></section>
    </template>
    <template v-else>
    <div id="workspace" class="workspace-heading"><div><p class="eyebrow">MEASUREMENT DESK</p><h1>Your field workspace.</h1><p class="dashboard-subtitle">Commission evidence, contribute measurements, and access your private reports.</p></div><span class="workspace-label">EARLY ACCESS / TESTNET ONLY</span></div>
    <div class="workspace-layout">
    <aside class="workspace-aside" aria-label="Measurement guide">
      <span class="aside-index">WORKSPACE NAVIGATION</span>
      <nav class="desk-nav" aria-label="Workspace sections">
        <button :class="{ selected: deskPanel === 'setup' }" :aria-pressed="deskPanel === 'setup'" @click="deskPanel = 'setup'">01 <span>Wallet &amp; permissions</span></button>
        <button :class="{ selected: deskPanel === 'requests' }" :aria-pressed="deskPanel === 'requests'" @click="deskPanel = 'requests'">02 <span>Requests &amp; measurements</span></button>
        <button :class="{ selected: deskPanel === 'reports' }" :aria-pressed="deskPanel === 'reports'" @click="deskPanel = 'reports'">03 <span>Private reports</span></button>
        <button :class="{ selected: deskPanel === 'feedback' }" :aria-pressed="deskPanel === 'feedback'" @click="deskPanel = 'feedback'">04 <span>Feedback</span></button>
      </nav>
      <div class="desk-session"><span class="aside-index">THIS SESSION</span><p>{{ walletAddress ? 'Wallet connected' : 'Wallet not connected' }}</p><p>{{ requestId ? 'Request active' : 'No active request' }}</p><p>{{ report ? 'Private report unlocked' : 'No unlocked report' }}</p></div>
      <div class="aside-note"><span aria-hidden="true">↳</span><p>Exact locations stay off-chain. Public scores only appear when privacy thresholds are met.</p></div>
      <a href="https://github.com/danielAsaboro/dwellence" target="_blank" rel="noopener noreferrer">Open-source, by design ↗</a>
    </aside>
    <div class="workspace-content">
    <section v-if="!insideNimiqPay" class="notice">
      <strong>Nimiq Pay required:</strong> this browser can inspect the
      interface, but wallet signatures and report payment only work when this
      URL is opened as a Mini App inside Nimiq Pay. No browser fallback
      simulates success.
    </section>
    <section class="notice">
      <strong>Privacy:</strong> exact property locations and readings stay
      off-chain. A direct NIM payment contains only an opaque report reference.
      Signatures establish key control, not physical truth.
    </section>
    <div v-show="deskPanel === 'setup'" class="desk-panel" aria-label="Wallet and permissions">
    <section id="connection" class="card wallet">
      <div>
        <h2>01. Your wallet</h2>
        <p>{{ walletAddress || "No wallet connected" }}</p>
      </div>
      <button :disabled="busy" @click="connect">
        {{ walletAddress ? "Reconnect wallet" : "Connect Nimiq Pay" }}</button
      ><small v-if="consensus === false"
        >Consensus is unavailable; payment must remain disabled.</small
      >
    </section>
    <section id="permissions" class="card consent">
      <h2>Your evidence. Your permission.</h2>
      <label
        ><input v-model="deviceConsent" type="checkbox" /> Allow Nimiq Pay to
        provide this app an origin-scoped device handle for replay and abuse
        controls. It identifies this device, not you, and the server stores only
        a digest.</label
      >
      <label
        ><input v-model="locationConsent" type="checkbox" /> Allow precise
        session location to validate the commissioned property tolerance; it is
        encrypted and kept off-chain.</label
      >
      <label
        ><input v-model="measurementConsent" type="checkbox" /> Allow the
        selected connectivity, sensor, and optional observation evidence to be
        collected for this request.</label
      >
      <label
        ><input v-model="retentionConsent" type="checkbox" /> Allow the private
        report and accepted raw evidence to be retained for up to 90 days, with
        precise locations generalized after 30 days.</label
      >
      <label
        ><input v-model="aggregationConsent" type="checkbox" /> Allow qualifying
        evidence to contribute anonymously to an area aggregate only after
        privacy thresholds are met.</label
      >
      <label
        ><input v-model="paymentConsent" type="checkbox" /> I understand report
        payment is a direct, irreversible NIM transfer to the contributor and
        Dwellence is not escrow.</label
      >
      <button class="secondary" :disabled="busy || !walletAddress" @click="withdrawData">
        Withdraw and delete my unpublished data
      </button>
    </section>
    </div>
    <div v-show="deskPanel === 'requests'" class="desk-panel" aria-label="Requests and measurements">
    <section id="commission" class="card">
      <div class="tabs">
        <button :class="{ active: mode === 'seeker' }" @click="mode = 'seeker'">
          I’m seeking evidence</button
        ><button
          :class="{ active: mode === 'contributor' }"
          @click="mode = 'contributor'"
        >
          I’m contributing
        </button>
      </div>
      <template v-if="mode === 'seeker'"
        ><h2>2. Commission a private measurement</h2>
        <label
          >Invited contributor Nimiq address
          <input
            v-model="contributorAddress"
            autocomplete="off"
            placeholder="NQ…"
        /></label>
        <label
          >Target property label<input v-model="targetLabel" autocomplete="off" placeholder="Private target property" /></label
        ><label
          >Target property latitude<input v-model="targetLatitude" inputmode="decimal" autocomplete="off" placeholder="e.g. 6.5244" /></label
        ><label
          >Target property longitude<input v-model="targetLongitude" inputmode="decimal" autocomplete="off" placeholder="e.g. 3.3792" /></label
        ><p class="field-note">This is the place you want measured. The contributor's current location is collected separately during the measurement and is never assumed to be the target.</p>
        <fieldset>
          <legend>Required evidence</legend>
          <label
            ><input v-model="requireConnectivity" type="checkbox" disabled />
            Connectivity (required for location validation)</label
          ><label
            ><input v-model="requireEnvironmentalComfort" type="checkbox" />
            Environmental comfort</label
          >
        </fieldset>
        <label
          >Measurement window (minutes)<input
            v-model.number="windowMinutes"
            type="number"
            min="10"
            max="1440" /></label
        ><label
          >Testnet report price (NIM)
          <input v-model="priceNim" inputmode="decimal" /></label
        ><button :disabled="busy || !readyForApi" @click="createRequest">
          Sign and create request
        </button>
        <p v-if="invitationCode" class="credential">
          <strong>Private invitation code</strong
          ><code>{{ invitationCode }}</code>
        </p>
        <button
          v-if="requestId && invitationCode"
          class="secondary"
          :disabled="busy"
          @click="cancelRequest"
        >
          Cancel unaccepted request
        </button></template
      >
      <template v-else
        ><h2>2. Accept an invitation</h2>
        <label
          >Private invitation code
          <input
            v-model="invitationCode"
            autocomplete="off"
            placeholder="Paste invitation code" /></label
        ><button :disabled="busy || !readyForApi" @click="acceptRequest">
          Sign and accept request
        </button>
        <p v-if="requestId">
          Accepted request: <code>{{ requestId }}</code>
        </p>
        <dl v-if="acceptedTask">
          <div>
            <dt>Approximate task area</dt>
            <dd>{{ acceptedTask.approximateArea }}</dd>
          </div>
          <div>
            <dt>Required evidence</dt>
            <dd>{{ acceptedTask.requiredCategories.join(" + ") }}</dd>
          </div>
          <div>
            <dt>Window ends</dt>
            <dd>{{ new Date(acceptedTask.windowEndsAt).toLocaleString() }}</dd>
          </div>
          <div>
            <dt>Offered price</dt>
            <dd>{{ acceptedTask.priceLuna / 100000 }} NIM</dd>
          </div>
        </dl></template
      >
    </section>
    <section v-if="mode === 'contributor'" class="card">
      <h2>3. Run a live connectivity check</h2>
      <p>
        Measures download, upload, latency, and jitter against the configured
        endpoint. It never fabricates a result or calls endpoint performance a
        property maximum.
      </p>
      <button
        :disabled="busy || !readyForApi || !requestId"
        @click="measureConnectivity"
      >
        Run and submit connectivity probe
      </button>
      <dl v-if="probe">
        <div>
          <dt>Download</dt>
          <dd>{{ probe.downloadMbps }} Mbps</dd>
        </div>
        <div>
          <dt>Upload</dt>
          <dd>{{ probe.uploadMbps }} Mbps</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{{ probe.latencyMs }} ms</dd>
        </div>
        <div>
          <dt>Jitter</dt>
          <dd>{{ probe.jitterMs }} ms</dd>
        </div>
      </dl>
    </section>
    <section v-if="mode === 'contributor'" class="card">
      <h2>3b. Bind the physical sensor</h2>
      <p>
        The sensor generates its Ed25519 key. Only paste its 32-byte public key;
        the private key must stay on the device.
      </p>
      <label
        >Sensor public key (64 hex characters)<input
          v-model="sensorPublicKey"
          autocomplete="off" /></label
      ><label>Model<input v-model="sensorModel" autocomplete="off" /></label
      ><label
        >Firmware version<input
          v-model="sensorFirmware"
          autocomplete="off" /></label
      ><label
        >Reporting interval (seconds)<input
          v-model.number="sensorReportingIntervalSeconds"
          type="number"
          min="1"
          max="3600" /></label
      ><label
        >Calibration status<select v-model="calibrationStatus">
          <option value="uncalibrated">Uncalibrated</option>
          <option value="manufacturer-specified">Manufacturer specified</option>
          <option value="field-checked">Field checked</option>
        </select></label
      ><button :disabled="busy || !readyForApi" @click="registerSensor">
        Sign and bind sensor
      </button>
      <p v-if="sensorId">
        Sensor ID: <code>{{ sensorId }}</code>
      </p>
      <button
        v-if="sensorId"
        class="secondary"
        :disabled="busy || !requestId"
        @click="issueSensorChallenge"
      >
        Issue one-use reading nonce
      </button>
      <div v-if="sensorChallenge" class="credential">
        <strong>Physical sensor handoff</strong><span>Request ID</span
        ><code>{{ requestId }}</code
        ><span
          >Nonce expires
          {{ new Date(sensorChallenge.expiresAt).toLocaleTimeString() }}</span
        ><code>{{ sensorChallenge.nonce }}</code>
      </div>
    </section>
    <section v-if="mode === 'contributor'" class="card">
      <h2>3c. Optional contributor observations</h2>
      <p>
        These statements are stored and displayed separately from instrument
        measurements with low confidence.
      </p>
      <label
        >Measurement setting<select v-model="observationSetting">
          <option value="indoors">Indoors</option>
          <option value="outdoors">Outdoors</option>
          <option value="common_area">Common area</option>
          <option value="not_stated">Not stated</option>
        </select></label
      ><label
        >Recent power interruption<select v-model="powerInterruption">
          <option value="not_checked">Not checked</option>
          <option value="observed">Observed</option>
          <option value="not_observed">Not observed</option>
        </select></label
      ><label
        >Water availability<select v-model="waterAvailability">
          <option value="not_checked">Not checked</option>
          <option value="observed">Observed</option>
          <option value="not_observed">Not observed</option>
        </select></label
      ><label
        >Drainage or standing water<select v-model="drainage">
          <option value="not_checked">Not checked</option>
          <option value="observed">Observed</option>
          <option value="not_observed">Not observed</option>
        </select></label
      ><label
        >Observed provider names, comma-separated<input
          v-model="providerNames"
          autocomplete="off" /></label
      ><button
        :disabled="busy || !readyForApi || !requestId"
        @click="saveObservations"
      >
        Save separate observations
      </button>
    </section>
    </div>
    <div v-show="deskPanel === 'reports'" class="desk-panel" aria-label="Private reports">
    <section id="reports" v-if="mode === 'contributor'" class="card">
      <h2>4. Seal verified evidence</h2>
      <p>
        Sealing fails until every category commissioned in the signed request
        has accepted evidence.
      </p>
      <button
        :disabled="busy || !readyForApi || !requestId"
        @click="sealReport"
      >
        Seal verified evidence
      </button>
      <p v-if="reportId" class="credential">
        <strong>Private report ID for the seeker</strong
        ><code>{{ reportId }}</code>
      </p>
    </section>
    <section id="reports" v-else class="card">
      <h2>3. Preview and unlock a report</h2>
      <label
        >Private report ID
        <input
          v-model.trim="reportId"
          :disabled="busy"
          autocomplete="off"
          placeholder="report_…" /></label
      ><button
        :disabled="busy || !readyForApi || !reportId"
        @click="loadPreview"
      >
        Load sealed preview
      </button>
      <p v-if="preview">
        {{ preview.categories.join(" + ") }} ·
        {{ preview.confidence }} confidence · {{ preview.scorerVersion }}
      </p>
      <p v-if="paymentAction === 'reload_report'">The report ID changed. Load its preview before any payment or verification.</p>
      <label v-if="purchase && !report && paymentAction !== 'reload_report'">
        Original transaction hash (if a payment was already submitted)
        <input v-model.trim="transactionHash" :disabled="busy" autocomplete="off" placeholder="Recover the 64-character hash from Nimiq Pay" />
        Retry verification with this receipt; never pay again because confirmation is delayed.
      </label>
      <button
        v-if="purchase && paymentAction === 'new_payment' && !report"
        :disabled="busy || consensus !== true || nimqNetwork !== 'testnet'"
        @click="payAndUnlock"
      >
        Approve {{ purchase.valueLuna / 100000 }} NIM direct payment</button
      ><p v-if="purchase && nimqNetwork !== 'testnet'" class="notice">Payments are fail-closed until this build is explicitly configured with <code>VITE_NIMIQ_NETWORK=testnet</code>.</p
      ><button
        v-if="purchase && paymentAction === 'verify_payment' && !report"
        :disabled="busy"
        @click="verifyPayment(false)"
      >
        Retry canonical payment verification
      </button>
    </section>
    <section v-if="purchase" class="notice">
      <strong>Direct and irreversible:</strong> payment goes from your wallet
      directly to <code>{{ purchase.recipient }}</code
      >. This app does not hold funds, provide escrow, or reverse a confirmed
      transfer. Verify the {{ purchase.valueLuna / 100000 }} NIM testnet amount
      before approving in Nimiq Pay.
    </section>
    <section v-if="report" class="card report">
      <h2>Unlocked private report</h2>
      <dl v-if="report.connectivity">
        <div>
          <dt>Download</dt>
          <dd>{{ report.connectivity.downloadMbps }} Mbps</dd>
        </div>
        <div>
          <dt>Upload</dt>
          <dd>{{ report.connectivity.uploadMbps }} Mbps</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{{ report.connectivity.latencyMs }} ms</dd>
        </div>
        <div>
          <dt>Jitter</dt>
          <dd>{{ report.connectivity.jitterMs }} ms</dd>
        </div>
        <div>
          <dt>Test duration</dt>
          <dd>{{ report.connectivity.durationMs }} ms</dd>
        </div>
        <div>
          <dt>Connectivity score</dt>
          <dd>{{ report.connectivity.categoryScore }}/100</dd>
        </div>
      </dl>
      <dl v-if="report.environmentalComfort">
        <div>
          <dt>Temperature</dt>
          <dd>{{ report.environmentalComfort.temperatureC }} °C</dd>
        </div>
        <div>
          <dt>Humidity</dt>
          <dd>{{ report.environmentalComfort.humidityPercent }}%</dd>
        </div>
        <div>
          <dt>Comfort score</dt>
          <dd>{{ report.environmentalComfort.categoryScore }}/100</dd>
        </div>
        <div>
          <dt>Sensor reporting interval</dt>
          <dd>
            {{ report.environmentalComfort.reportingIntervalSeconds }} seconds
          </dd>
        </div>
        <div>
          <dt>Device signature</dt>
          <dd>
            <code>{{ report.environmentalComfort.signature }}</code>
          </dd>
        </div>
      </dl>
      <h3>Your suitability score: {{ suitabilityScore }}/100</h3>
      <p>
        This personal score changes only your weighting, never the underlying
        evidence scores.
      </p>
      <label
        >Connectivity weight: {{ connectivityWeight
        }}<input
          v-model.number="connectivityWeight"
          type="range"
          min="1"
          max="100" /></label
      ><label
        >Environmental comfort weight: {{ comfortWeight
        }}<input v-model.number="comfortWeight" type="range" min="1" max="100"
      /></label>
      <div v-if="report.contributorObservations">
        <h3>Contributor observations · low confidence</h3>
        <p>{{ report.contributorObservations.limitation }}</p>
        <dl>
          <div>
            <dt>Setting</dt>
            <dd>{{ report.contributorObservations.setting }}</dd>
          </div>
          <div>
            <dt>Power interruption</dt>
            <dd>{{ report.contributorObservations.powerInterruption }}</dd>
          </div>
          <div>
            <dt>Water availability</dt>
            <dd>{{ report.contributorObservations.waterAvailability }}</dd>
          </div>
          <div>
            <dt>Drainage</dt>
            <dd>{{ report.contributorObservations.drainage }}</dd>
          </div>
          <div>
            <dt>Providers</dt>
            <dd>
              {{
                report.contributorObservations.providerNames.join(", ") ||
                "None stated"
              }}
            </dd>
          </div>
        </dl>
      </div>
      <h3>Confidence: low</h3>
      <dl>
        <div
          v-for="(value, dimension) in report.confidenceDimensions"
          :key="dimension"
        >
          <dt>{{ dimension }}</dt>
          <dd>{{ value }}</dd>
        </div>
      </dl>
      <h3>Limits</h3>
      <ul>
        <li v-for="limitation in report.limitations" :key="limitation">
          {{ limitation }}
        </li>
      </ul>
    </section>
    <section v-if="areaAggregate" class="card">
      <h2>Privacy-safe area evidence</h2>
      <p v-if="areaAggregate.state === 'insufficient_evidence'">
        <strong>Insufficient evidence.</strong> No public score is shown. This
        area has {{ areaAggregate.contributorDevicePairs }}/{{
          areaAggregate.thresholds.contributorDevicePairs
        }}
        independent contributor/device pairs across
        {{ areaAggregate.distinctDays }}/{{
          areaAggregate.thresholds.distinctDays
        }}
        required days.
      </p>
    </section>
    </div>
    <div v-show="deskPanel === 'feedback'" class="desk-panel" aria-label="Feedback">
    <section id="feedback" class="card">
      <h2>Early-access feedback</h2>
      <p>
        No name or wallet address is requested. Consented feedback is retained
        for up to 90 days as submission evidence.
      </p>
      <label
        >Rating (1–5)<input
          v-model.number="feedbackRating"
          type="number"
          min="1"
          max="5"
      /></label>
      <label
        >What worked or blocked you?<textarea
          v-model="feedbackComment"
          maxlength="1000"
        ></textarea>
      </label>
      <label
        ><input v-model="feedbackEvidenceConsent" type="checkbox" /> I consent
        to this anonymous feedback and timestamp being retained and used as
        hackathon evidence.</label
      >
      <button
        :disabled="busy || !feedbackComment.trim() || !feedbackEvidenceConsent"
        @click="submitFeedback"
      >
        Submit feedback
      </button>
      <p v-if="feedbackReceipt" class="credential">
        <strong>Feedback receipt</strong><code>{{ feedbackReceipt }}</code>
      </p>
    </section>
    </div>
    <p class="status" aria-live="polite">{{ status }}</p>
    </div>
    </div>
    </template>
    <footer v-if="!isWorkspace" class="site-footer"><a class="wordmark" href="/">Dwellence.</a><p>Measure the everyday.<br />Make a more informed move.</p><div><span>Nimiq Pay Mini App · Testnet</span><a href="https://github.com/danielAsaboro/dwellence" target="_blank" rel="noopener noreferrer">Source &amp; documentation ↗</a><small>Informational reports. Not escrow. Not a guarantee.</small></div></footer>
    <footer v-else class="app-footer"><span>Dwellence / Testnet workspace</span><span>Private evidence. Direct transfers. Not escrow.</span><a href="/">Back to website ↗</a></footer>
  </main>
</template>
