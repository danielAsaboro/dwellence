import { afterEach, describe, expect, it, vi } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "@vue/server-renderer";
import App from "../src/App.vue";

afterEach(() => vi.unstubAllGlobals());

async function page(pathname: string) {
  // SSR supplies only the browser location the app reads. No wallet/provider success.
  vi.stubGlobal("window", { location: { pathname, origin: "https://dwellence.usereef.xyz" } });
  return renderToString(createSSRApp(App));
}

describe("public website and application boundaries", () => {
  it("keeps wallet and commissioning forms off the landing page", async () => {
    const html = await page("/");
    expect(html).toContain("A good address.");
    expect(html).toContain('href="/workspace"');
    expect(html).not.toContain("Connect Nimiq Pay");
    expect(html).not.toContain("Invited contributor Nimiq address");
    expect(html).not.toContain("Your evidence. Your permission.");
  });

  it("opens the actual workspace directly without marketing content", async () => {
    const html = await page("/workspace");
    expect(html).toContain("Connect Nimiq Pay");
    expect(html).toContain("Invited contributor Nimiq address");
    expect(html).toContain("Your evidence. Your permission.");
    expect(html).not.toContain("A good address.");
    expect(html).not.toContain("Look beyond");
    expect(html).toContain('href="/"');
  });

  it("handles the trailing-slash workspace URL consistently", async () => {
    const html = await page("/workspace/");
    expect(html).toContain("Connect Nimiq Pay");
    expect(html).not.toContain("A good address.");
  });
});
