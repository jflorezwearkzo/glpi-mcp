import { describe, expect, it } from "vitest";
import { HlapiBackend, pickVersion, rsqlValue } from "../src/glpi/hlapi.js";
import { createBackend } from "../src/glpi/factory.js";
import { config, mockFetch } from "./helpers.js";

const oauthEnv = {
  GLPI_OAUTH_CLIENT_ID: "cid",
  GLPI_OAUTH_CLIENT_SECRET: "sec",
  GLPI_USERNAME: "svc-mcp",
  GLPI_PASSWORD: "pw",
};

function glpi11(extra?: (c: import("./helpers.js").Call) => any) {
  return mockFetch((c) => {
    if (c.url.pathname === "/api.php/") {
      return { body: { api_versions: [{ version: "1.0.0" }, { version: "2.2.0" }, { version: "2.3.1" }] } };
    }
    if (c.url.pathname === "/api.php/token") return { body: { access_token: "tok", expires_in: 3600 } };
    return extra?.(c);
  });
}

describe("pickVersion", () => {
  it("prefers the newest 2.x in auto mode", () => {
    expect(pickVersion([{ version: "2.3.0" }, { version: "3.0.0" }, { version: "2.2.0" }], "auto")).toBe("2.3");
  });
  it("falls back to the newest offered when there is no 2.x", () => {
    expect(pickVersion([{ version: "3.0.0" }, { version: "3.1.0" }], "auto")).toBe("3.1");
  });
  it("refuses a version GLPI does not offer", () => {
    expect(() => pickVersion([{ version: "2.3.0" }], "3.0")).toThrow(/does not offer/);
  });
});

describe("rsqlValue", () => {
  it("quotes values with spaces or reserved characters", () => {
    expect(rsqlValue("*vpn*")).toBe("*vpn*");
    expect(rsqlValue('*no "vpn";x*')).toBe('"*no \\"vpn\\";x*"');
  });
});

describe("HlapiBackend", () => {
  it("gets a token with the password grant and pins the version in the path", async () => {
    const { fetch, calls } = glpi11((c) => {
      if (c.url.pathname === "/api.php/v2.3/Assistance/Ticket") {
        return {
          body: [{ id: 5, name: "Impresora", status: { id: 1, name: "New" }, priority: 3, category: { id: 2, name: "Hardware" } }],
          headers: { "Content-Range": "0-0/37" },
        };
      }
    });
    const b = new HlapiBackend(config(oauthEnv), fetch);
    const page = await b.listItil({ itilType: "Ticket", openOnly: true, text: "impre", start: 0, limit: 20 });

    const token = calls.find((c) => c.url.pathname === "/api.php/token")!;
    const form = new URLSearchParams(token.body);
    expect(form.get("grant_type")).toBe("password");
    expect(form.get("scope")).toBe("api");

    const list = calls.find((c) => c.url.pathname.includes("Assistance/Ticket"))!;
    expect(list.headers.authorization).toBe("Bearer tok");
    expect(list.url.searchParams.get("filter")).toBe("status.id=out=(5,6);(name=ilike=*impre*,content=ilike=*impre*)");
    expect(page.total).toBe(37);
    expect(page.items[0]).toMatchObject({ id: 5, status: "new", priority: "medium", category: "Hardware" });
  });

  it("refreshes a rejected token once", async () => {
    let grants = 0;
    let rejected = false;
    const { fetch } = mockFetch((c) => {
      if (c.url.pathname === "/api.php/") return { body: { api_versions: [{ version: "2.3.0" }] } };
      if (c.url.pathname === "/api.php/token") return { body: { access_token: `t${++grants}` } };
      if (c.url.pathname.endsWith("/Administration/User/Me")) {
        if (!rejected) {
          rejected = true;
          return { status: 400, body: { title: "ERROR_INVALID_PARAMETER: Invalid OAuth token" } };
        }
        return { body: { id: 9, username: "svc-mcp" } };
      }
    });
    const b = new HlapiBackend(config(oauthEnv), fetch);
    expect(await b.whoami()).toEqual({ id: 9, username: "svc-mcp" });
    expect(grants).toBe(2);
  });

  it("creates a ticket then adds requester and assignee as team members", async () => {
    const { fetch, calls } = glpi11((c) => {
      if (c.method === "POST" && c.url.pathname.endsWith("/Assistance/Ticket")) return { status: 201, body: { id: 120 } };
      if (c.method === "POST" && c.url.pathname.endsWith("/TeamMember")) return { status: 201, body: {} };
    });
    const b = new HlapiBackend(config(oauthEnv), fetch);
    const res = (await b.createItil({
      itilType: "Ticket",
      name: "Nuevo",
      content: "c",
      categoryId: 4,
      requesterUserId: 11,
      assignedGroupId: 3,
    })) as Record<string, unknown>;

    const create = calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/Assistance/Ticket"))!;
    expect(JSON.parse(create.body!)).toEqual({ name: "Nuevo", content: "c", category: 4 });
    const team = calls.filter((c) => c.url.pathname.endsWith("/Assistance/Ticket/120/TeamMember")).map((c) => JSON.parse(c.body!));
    expect(team).toEqual([
      { type: "User", id: 11, role: "requester" },
      { type: "Group", id: 3, role: "assigned" },
    ]);
    expect(res.id).toBe(120);
  });

  it("says clearly that assignee filters need the legacy API", async () => {
    const b = new HlapiBackend(config(oauthEnv), glpi11().fetch);
    await expect(b.listItil({ itilType: "Ticket", assignedUserId: 3, start: 0, limit: 5 })).rejects.toThrow(/legacy/);
  });
});

describe("createBackend (auto)", () => {
  it("uses the High-Level API when OAuth is set and GLPI lists versions", async () => {
    const b = await createBackend(config({ ...oauthEnv, GLPI_USER_TOKEN: "ut" }), glpi11().fetch);
    expect(b.kind).toBe("hlapi");
  });

  it("falls back to legacy on GLPI 10 (no /api.php versions)", async () => {
    const { fetch } = mockFetch(() => ({ status: 404, body: "Not Found" }));
    const b = await createBackend(config({ ...oauthEnv, GLPI_USER_TOKEN: "ut" }), fetch);
    expect(b.kind).toBe("legacy");
  });

  it("uses legacy when only a user token is set", async () => {
    const b = await createBackend(config({ GLPI_USER_TOKEN: "ut" }), mockFetch(() => undefined).fetch);
    expect(b.kind).toBe("legacy");
  });

  it("fails with a helpful message without credentials", async () => {
    await expect(createBackend(config(), mockFetch(() => undefined).fetch)).rejects.toThrow(/No GLPI credentials/);
  });
});
