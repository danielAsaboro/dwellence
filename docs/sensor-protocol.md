# Sensor protocol

This protocol is for a physical ESP32-class device connected to a real temperature/humidity sensor. It is not a simulator and must not be used to create demo readings.

## Registration

The contributor first authenticates through Nimiq Pay, then registers the sensor’s 32-byte Ed25519 public key, hardware model, firmware version, and calibration status at `POST /api/sensors/register`. The private key remains on the sensor device.

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

The backend rejects invalid signatures, used/expired nonces, stale samples, impossible temperature/humidity values, readings outside the active request window, and duplicate payloads. An accepted signature proves only that the registered key produced this payload; it does not prove placement, calibration, or physical truth.
