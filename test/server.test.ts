import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { BackendProvider } from "../src/glpi/factory.js";
import { createHttpApp } from "../src/http.js";
import { createServer } from "../src/server.js";
import { config, mockFetch } from "./helpers.js";

async function connect(env: Record<string, string>, fetchImpl = mockFetch(() => undefined).fetch) {
  const cfg = config({ GLPI_USER_TOKEN: "ut", ...env });
  const server = createServer(cfg, new BackendProvider(cfg, fetchImpl));
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe("tool registration", () => {
  it("is read-only by default", async () => {
    const client = await connect({});
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("glpi_search_tickets");
    expect(names).not.toContain("glpi_create_ticket");
    expect(names).not.toContain("glpi_delete_item");
    for (const t of (await client.listTools()).tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("adds write tools with GLPI_READ_ONLY=false, and delete only when allowed", async () => {
    const rw = (await (await connect({ GLPI_READ_ONLY: "false" })).listTools()).tools.map((t) => t.name);
    expect(rw).toContain("glpi_create_ticket");
    expect(rw).not.toContain("glpi_delete_item");
    const del = (await (await connect({ GLPI_READ_ONLY: "false", GLPI_ALLOW_DELETE: "true" })).listTools()).tools;
    expect(del.find((t) => t.name === "glpi_delete_item")?.annotations?.destructiveHint).toBe(true);
  });

  it("calls GLPI through a tool and returns JSON text", async () => {
    const { fetch } = mockFetch((c) => {
      if (c.url.pathname.endsWith("/initSession")) return { body: { session_token: "s" } };
      if (c.url.pathname.endsWith("/search/Computer")) return { body: { totalcount: 1, data: [{ "1": "PC-001", "2": 3 }] } };
    });
    const client = await connect({}, fetch);
    const res = (await client.callTool({ name: "glpi_search_items", arguments: { itemtype: "Computer", query: "PC" } })) as any;
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text).items[0]).toMatchObject({ id: 3, name: "PC-001" });
  });

  it("reports GLPI errors as tool errors instead of crashing", async () => {
    const { fetch } = mockFetch((c) => {
      if (c.url.pathname.endsWith("/initSession")) return { status: 401, body: ["ERROR_LOGIN_PARAMETERS_MISSING", "bad token"] };
    });
    const client = await connect({}, fetch);
    const res = (await client.callTool({ name: "glpi_whoami", arguments: {} })) as any;
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/401.*bad token/);
  });
});

describe("HTTP transport", () => {
  it("requires an auth token to start", () => {
    const cfg = config({ GLPI_USER_TOKEN: "ut", MCP_TRANSPORT: "http" });
    expect(() => createHttpApp(cfg, new BackendProvider(cfg))).toThrow(/MCP_AUTH_TOKEN/);
  });

  it("rejects requests without the bearer token and serves MCP with it", async () => {
    const cfg = config({ GLPI_USER_TOKEN: "ut", MCP_TRANSPORT: "http", MCP_AUTH_TOKEN: "secret-123" });
    const app = createHttpApp(cfg, new BackendProvider(cfg, mockFetch(() => undefined).fetch));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    const init = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    };
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
    try {
      const denied = await fetch(url, { method: "POST", headers, body: JSON.stringify(init) });
      expect(denied.status).toBe(401);
      const okRes = await fetch(url, {
        method: "POST",
        headers: { ...headers, Authorization: "Bearer secret-123" },
        body: JSON.stringify(init),
      });
      expect(okRes.status).toBe(200);
      expect(await okRes.text()).toContain("glpi-mcp");
    } finally {
      server.close();
    }
  });
});
