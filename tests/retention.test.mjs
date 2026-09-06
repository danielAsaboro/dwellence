import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createStore, runRetention } from "../server/store.mjs";

const DAY = 24 * 60 * 60 * 1000;

function seedPurchasedReport(store, id, unlockedAt) {
  store
    .prepare(
      "INSERT INTO requests (id, seeker_address, invited_contributor, location_ciphertext, public_cell, window_starts_at, window_ends_at, price_luna, share_code, status, accepted_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      "NQSEEKER",
      "NQCONTRIBUTOR",
      "encrypted-precise-location",
      "6.50,3.30",
      1,
      2,
      1000,
      `share-${id}`,
      "awaiting_payment",
      "NQCONTRIBUTOR",
      1,
    );
  store
    .prepare(
      "INSERT INTO reports (id, request_id, seeker_address, contributor_address, price_luna, preview_json, report_json, scorer_version, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      `report-${id}`,
      id,
      "NQSEEKER",
      "NQCONTRIBUTOR",
      1000,
      "{}",
      "{}",
      "mvp-1",
      "unlocked",
      1,
    );
  store
    .prepare(
      "INSERT INTO purchases (id, report_id, seeker_address, contributor_address, expected_luna, reference, transaction_hash, state, unlocked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      `purchase-${id}`,
      `report-${id}`,
      "NQSEEKER",
      "NQCONTRIBUTOR",
      1000,
      `rep:${id}`,
      "a".repeat(64),
      "included",
      unlockedAt,
    );
  store
    .prepare(
      "INSERT INTO connectivity_measurements (id, request_id, payload_digest, endpoint, download_mbps, upload_mbps, latency_ms, jitter_ms, duration_ms, location_ciphertext, measured_at, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      `net-${id}`,
      id,
      `digest-${id}`,
      "https://probe.example",
      10,
      5,
      20,
      2,
      500,
      "encrypted-measurement-location",
      1,
      1,
    );
}

describe("privacy retention", () => {
  it("generalizes precise locations after 30 days and removes private reports after 90 days", () => {
    const now = Date.now();
    const store = createStore(
      join(mkdtempSync(join(tmpdir(), "dwellence-retention-")), "state.sqlite"),
    );
    seedPurchasedReport(store, "recent", now - 31 * DAY);
    seedPurchasedReport(store, "expired", now - 91 * DAY);
    store
      .prepare(
        "INSERT INTO sessions (token_digest, wallet_address, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("expired-session", "NQSEEKER", "seeker", now - 1, 1);

    const result = runRetention(store, now);

    expect(
      store
        .prepare("SELECT location_ciphertext FROM requests WHERE id = ?")
        .get("recent").location_ciphertext,
    ).toBe("generalized-after-retention-window");
    expect(
      store
        .prepare(
          "SELECT location_ciphertext FROM connectivity_measurements WHERE request_id = ?",
        )
        .get("recent").location_ciphertext,
    ).toBe("generalized-after-retention-window");
    expect(
      store
        .prepare("SELECT id FROM reports WHERE id = ?")
        .get("report-expired"),
    ).toBeUndefined();
    expect(
      store
        .prepare("SELECT token_digest FROM sessions WHERE token_digest = ?")
        .get("expired-session"),
    ).toBeUndefined();
    expect(result.generalizedLocations).toBe(2);
    expect(result.deletedReports).toBe(1);
  });
});
