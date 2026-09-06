# Sensor protocol

This protocol is for a physical ESP32-class device connected to a real temperature/humidity sensor. It is not a simulator and must not be used to create demo readings.

## Registration

The contributor first authenticates through Nimiq Pay. The Mini App sends the sensor’s 64-hex-character Ed25519 public key, hardware model, firmware version, calibration status, and declared reporting interval in seconds to `POST /api/sensors/registration-challenge`. The contributor signs the returned binding message with the authenticated Nimiq wallet, then submits the unchanged metadata plus `registrationChallengeId`, `walletPublicKey`, and `walletSignature` to `POST /api/sensors/register`. This makes later metadata changes detectable and binds the sensor operator to the same wallet session. The reporting interval must be from 1 to 3,600 seconds. The Ed25519 private key remains on the physical sensor and must never be pasted into the app.

Allowed calibration values are `manufacturer-specified`, `field-checked`, and `uncalibrated`. They are disclosures, not claims that Dwellence independently calibrated the device.

## Challenge and reading

The contributor requests `POST /api/sensors/:id/challenge`. The sensor signs the exact UTF-8 message below, newline-delimited and with the decimal values as sent:

```text
<requestId>
<nonce>
<timestamp-ms>
<temperatureC>
<humidityPercent>
```

Submit the payload and lowercase hexadecimal 64-byte Ed25519 signature to `POST /api/sensors/:id/readings`.

```json
{
  "requestId": "req_example",
  "nonce": "server-issued-one-use-nonce",
  "timestamp": 1788690000000,
  "temperatureC": 24.2,
  "humidityPercent": 51.7,
  "signature": "128-hex-character-ed25519-signature"
}
```

The backend rejects invalid signatures, used/expired nonces, stale samples, impossible temperature/humidity values, readings outside the active request window, and duplicate payloads. The accepted payload digest and device signature are retained in the private audit record and report until retention deletion. An accepted signature proves only that the registered key produced this payload; it does not prove placement, calibration, or physical truth.
