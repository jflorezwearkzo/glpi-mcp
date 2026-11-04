/**
 * Streamable HTTP transport (POST /mcp), stateless: each request gets its own
 * MCP server instance, while the GLPI session/token is shared between requests.
 *
 * Protected with a static bearer token (MCP_AUTH_TOKEN). Put it behind HTTPS
 * (reverse proxy, Cloudflare Tunnel, Azure App Service...) before exposing it.
 */
import { timingSafeEqual } from "node:crypto";
import type { Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type NextFunction, type Request, type Response } from "express";
import { ConfigError, type Config } from "./config.js";
import type { BackendProvider } from "./glpi/factory.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function createHttpApp(config: Config, provider: BackendProvider) {
  const { authToken, allowNoAuth, allowedOrigins } = config.http;
  if (!authToken && !allowNoAuth) {
    throw new ConfigError(
      "MCP_TRANSPORT=http needs MCP_AUTH_TOKEN (clients send it as 'Authorization: Bearer <token>'). " +
        "Set MCP_ALLOW_NO_AUTH=true only for local testing.",
    );
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", name: "glpi-mcp", version: VERSION });
  });

  const guard = (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: "origin not allowed" });
      return;
    }
    if (authToken) {
      const header = req.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token || !safeEqual(token, authToken)) {
        res.status(401).set("WWW-Authenticate", 'Bearer realm="glpi-mcp"').json({ error: "unauthorized" });
        return;
      }
    }
    next();
  };

  app.post("/mcp", guard, async (req, res) => {
    const server = createServer(config, provider);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[glpi-mcp] request failed:", (err as Error).message);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  });

  // Stateless server: no SSE stream or session to resume or end.
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  };
  app.get("/mcp", guard, notAllowed);
  app.delete("/mcp", guard, notAllowed);

  return app;
}

export function startHttp(config: Config, provider: BackendProvider): Promise<Server> {
  const app = createHttpApp(config, provider);
  return new Promise((resolve) => {
    const server = app.listen(config.http.port, config.http.host, () => {
      console.error(`[glpi-mcp] listening on http://${config.http.host}:${config.http.port}/mcp`);
      resolve(server);
    });
  });
}
