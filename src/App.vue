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
  sendPurchasePayment,
  signMessage,
} from "./lib/nimiq";
import { pollPaymentInclusion } from "./lib/payment-polling";
import { calculateSuitability } from "./lib/suitability";

const apiUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(
  /\/$/,
  "",
);
const probeUrl = (
  import.meta.env.VITE_PROBE_URL || `${window.location.origin}/probe`
).replace(/\/$/, "");
const walletAddress = ref("");
const insideNimiqPay = Boolean(window.nimiqPay || window.nimiq);
const analyticsClientId = `client_${crypto.randomUUID().replaceAll("-", "")}`;
const consensus = ref<boolean | null>(null);
const deviceConsent = ref(false);
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
const priceNim = ref("0.01");
const windowMinutes = ref(60);
const requireConnectivity = ref(true);
const requireEnvironmentalComfort = ref(true);
const probe = ref<ConnectivityProbeResult | null>(null);
const sensorPublicKey = ref("");
const sensorModel = ref("BME280");
const sensorFirmware = ref("");
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
} | null>(null);
const transactionHash = ref("");
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
    categoryScore: number;
  };
  environmentalComfort: null | {
    temperatureC: number;
    humidityPercent: number;
    categoryScore: number;
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
  void fetch(`${apiUrl}/api/analytics`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event, clientId: analyticsClientId }),
  }).catch(() => undefined);
}

onMounted(() =>
  track(
    insideNimiqPay
      ? "app_opened_inside_nimiq_pay"
      : "app_opened_outside_nimiq_pay",
  ),
);

async function api(path: string, options: RequestInit = {}) {
  if (!apiUrl)
    throw new Error("VITE_API_URL is not configured for this Mini App.");
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
  });
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
    const session = await authenticate("seeker");
    const position = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      }),
    );
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
      location: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        label: "Private property",
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
  track("measurement_started");
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
  try {
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
    const session = await authenticate("contributor");
    const metadata = {
      publicKey: sensorPublicKey.value.trim(),
      model: sensorModel.value.trim(),
      firmware: sensorFirmware.value.trim(),
      calibrationStatus: calibrationStatus.value,
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
  if (!reportId.value) {
    status.value = "Enter the report ID shared by the contributor.";
    return;
  }
  busy.value = true;
  try {
    const session = await authenticate("seeker");
    const result = await api(
      `/api/reports/${encodeURIComponent(reportId.value)}/preview`,
      { headers: { authorization: `Bearer ${session.token}` } },
    );
    track("report_previewed");
    preview.value = result.preview;
    const intent = await api(
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
    };
    status.value =
      "Sealed preview loaded. Review the recipient and low-value testnet amount before the native payment approval.";
  } catch (error) {
    status.value =
      error instanceof Error ? error.message : "Preview loading failed.";
  } finally {
    busy.value = false;
  }
}

async function payAndUnlock() {
  if (!purchase.value) return;
  busy.value = true;
  track("payment_started");
  try {
    transactionHash.value = await sendPurchasePayment({
      recipient: purchase.value.recipient,
      value: purchase.value.valueLuna,
      data: purchase.value.reference,
    });
    track("payment_submitted");
    await verifyPayment(true);
  } catch (error) {
    track("payment_cancelled");
    status.value =
      error instanceof Error
        ? error.message
        : "Payment was not verified. The report remains sealed.";
  } finally {
    busy.value = false;
  }
}

async function verifyPayment(poll = false) {
  if (!purchase.value || !transactionHash.value) return;
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
</script>

<template>
  <main>
    <header>
      <p class="eyebrow">Dwellence · Nimiq Pay Mini App · testnet only</p>
      <h1>Know how a place performs.</h1>
      <p class="lede">
        Commission fresh, private connectivity and environmental evidence for a
        property. Reports are informational—not inspections, appraisals, or
        guarantees.
      </p>
    </header>
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
    <section class="card wallet">
      <div>
        <h2>1. Connect</h2>
        <p>{{ walletAddress || "No wallet connected" }}</p>
      </div>
      <button :disabled="busy" @click="connect">
        {{ walletAddress ? "Reconnect wallet" : "Connect Nimiq Pay" }}</button
      ><small v-if="consensus === false"
        >Consensus is unavailable; payment must remain disabled.</small
      >
    </section>
    <section class="card consent">
      <h2>Consent for abuse controls</h2>
      <label
        ><input v-model="deviceConsent" type="checkbox" /> Allow Nimiq Pay to
        provide this app an origin-scoped device handle for replay and abuse
        controls. It identifies this device, not you, and the server stores only
        a digest.</label
      >
    </section>
    <section class="card">
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
    <section v-if="mode === 'contributor'" class="card">
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
    <section v-else class="card">
      <h2>3. Preview and unlock a report</h2>
      <label
        >Private report ID
        <input
          v-model="reportId"
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
      <button
        v-if="purchase && !transactionHash"
        :disabled="busy || consensus !== true"
        @click="payAndUnlock"
      >
        Approve {{ purchase.valueLuna / 100000 }} NIM direct payment</button
      ><button
        v-if="purchase && transactionHash && !report"
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
    <p class="status" aria-live="polite">{{ status }}</p>
  </main>
</template>
