const MESSAGES: Record<string, string> = {
  RATE_LIMITED: "Too many attempts. Wait a few minutes, then try again.",
  ORIGIN_FORBIDDEN: "This Mini App origin is not authorized by the verifier.",
  INVALID_AUTH_REQUEST:
    "Choose a valid Nimiq account and try connecting again.",
  AUTH_CHALLENGE_INVALID:
    "The wallet sign-in challenge no longer matches. Start the sign-in again.",
  SIGNATURE_INVALID:
    "Nimiq Pay did not return a valid signature for this account. Try signing again.",
  AUTH_CHALLENGE_USED_OR_EXPIRED:
    "The sign-in request expired or was already used. Start again.",
  SEEKER_AUTH_REQUIRED: "Reconnect and sign in with the seeker wallet.",
  CONTRIBUTOR_AUTH_REQUIRED:
    "Reconnect and sign in with the contributor wallet.",
  REQUEST_SIGNATURE_REQUIRED:
    "The private request must be signed in Nimiq Pay before it can be created.",
  REQUEST_SIGNATURE_INVALID:
    "The request changed after signing. Review it and sign the current request again.",
  REQUEST_SIGNATURE_USED_OR_EXPIRED:
    "The request signature expired or was already used. Sign the request again.",
  INVALID_REQUEST:
    "Check the contributor address, location, time window, and positive NIM price.",
  REQUEST_UNAVAILABLE:
    "This invitation is invalid, cancelled, expired, already accepted, or assigned to another wallet.",
  REQUEST_EXPIRED: "This request expired. Ask the seeker for a new invitation.",
  REQUEST_CANNOT_BE_CANCELLED:
    "This request can no longer be cancelled because work has started or it is already closed.",
  INVALID_SENSOR_REGISTRATION:
    "Check the 64-character sensor public key, model, firmware, and calibration status.",
  SENSOR_BINDING_SIGNATURE_REQUIRED:
    "Sign the sensor ownership statement with the contributor wallet.",
  SENSOR_BINDING_SIGNATURE_INVALID:
    "The signed sensor metadata does not match. Generate a fresh binding challenge.",
  SENSOR_BINDING_SIGNATURE_USED_OR_EXPIRED:
    "The sensor binding challenge expired or was already used. Generate another.",
  SENSOR_PUBLIC_KEY_REGISTERED: "This sensor public key is already registered.",
  SENSOR_NOT_FOUND:
    "That sensor is not registered to the connected contributor wallet.",
  INVALID_SENSOR_READING:
    "The physical sensor payload is incomplete or malformed.",
  SENSOR_SIGNATURE_INVALID:
    "The physical reading signature is invalid. Check the sensor key and exact payload fields.",
  SENSOR_NONCE_USED_OR_EXPIRED:
    "The sensor nonce expired or was already used. Issue a fresh reading nonce.",
  READING_NOT_BOUND_TO_ACTIVE_REQUEST:
    "The reading is outside the active request, contributor, or time window.",
  READING_IMPLAUSIBLE_OR_STALE:
    "The physical reading is stale or outside the accepted measurement range. Repeat it.",
  SENSOR_PAYLOAD_REPLAYED:
    "This physical sensor payload was already submitted. Capture a fresh reading.",
  ACTIVE_ASSIGNMENT_NOT_FOUND:
    "The connected contributor has no active assignment for this request.",
  INVALID_CONTRIBUTOR_OBSERVATION:
    "Review the observation choices and provider names, then submit them again.",
  INVALID_CONNECTIVITY_READING:
    "The connectivity result or its location/context data is incomplete.",
  LOCATION_CONFIDENCE_INSUFFICIENT:
    "Move where your phone has a clearer location signal, then repeat the measurement.",
  LOCATION_OUTSIDE_REQUEST_TOLERANCE:
    "The phone is outside the commissioned property area. Move to the requested location and retry.",
  CONNECTIVITY_NONCE_USED_OR_EXPIRED:
    "The connectivity session expired or was already submitted. Start a fresh measurement.",
  CONNECTIVITY_READING_IMPLAUSIBLE_OR_STALE:
    "The connectivity result is stale or outside accepted bounds. Run the probe again.",
  CONNECTIVITY_PAYLOAD_REPLAYED:
    "This connectivity payload was already submitted. Run a fresh measurement.",
  REQUIRED_EVIDENCE_MISSING:
    "Complete every evidence category listed in the commissioned request before sealing the report.",
  REPORT_ALREADY_GENERATED:
    "A sealed report already exists for this request. Use its report ID.",
  PRIVATE_REPORT_NOT_FOUND:
    "This report does not belong to the connected seeker wallet.",
  PAYABLE_REPORT_NOT_FOUND:
    "This report is not awaiting payment or does not belong to this wallet.",
  PURCHASE_NOT_FOUND:
    "This purchase does not belong to the connected seeker wallet.",
  INVALID_TRANSACTION_HASH:
    "Nimiq Pay returned an invalid transaction hash. Do not retry payment; retry verification with the original hash.",
  NIMIQ_RPC_NOT_CONFIGURED:
    "Payment verification is temporarily unavailable because the verifier has no Nimiq RPC source.",
  NIMIQ_RPC_UNAVAILABLE:
    "The Nimiq network lookup is temporarily unavailable. Retry verification; do not send another payment.",
  NOT_INCLUDED:
    "The transaction is not included yet. Wait, then retry verification without paying again.",
  RECIPIENT_MISMATCH:
    "The transaction recipient does not match this report. The report remains locked.",
  AMOUNT_MISMATCH:
    "The transaction amount does not match this report. The report remains locked.",
  REFERENCE_MISMATCH:
    "The transaction reference does not match this report. The report remains locked.",
  PRIVATE_REPORT_NOT_UNLOCKED:
    "The report remains private until its exact confirmed payment is independently verified.",
  INVALID_AREA_CELL: "The requested public area cell is invalid.",
  INVALID_ANALYTICS_EVENT: "The privacy-safe analytics event was rejected.",
  INVALID_FEEDBACK:
    "Add a 1–5 rating, a short comment, and consent to retain the feedback as submission evidence.",
  PAYLOAD_TOO_LARGE:
    "The submitted payload is too large. Restart the measurement with the supported client.",
  INVALID_JSON: "The request was malformed. Restart this step.",
  INTERNAL_ERROR:
    "The verifier could not complete this step. Your payment or measurement was not marked successful.",
};

export function humanizeApiError(code: string): string {
  return (
    MESSAGES[code] ??
    `The verifier returned ${code}. Nothing was marked successful; retry or report this code.`
  );
}
