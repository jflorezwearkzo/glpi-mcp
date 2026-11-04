#!/usr/bin/env node
/**
 * glpi-mcp entry point.
 *   MCP_TRANSPORT=stdio (default) -> Claude Desktop / Claude Code
 *   MCP_TRANSPORT=http            -> Streamable HTTP on /mcp (remote connector)
 *
 * In stdio mode, stdout is the MCP channel: logs go to stderr only.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config.js";
import { BackendProvider } from "./glpi/factory.js";
import { startHttp } from "./http.js";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

async function main() {
  if (process.argv.includes("--version")) {
    console.log(VERSION);
    return;
  }
  const config = loadConfig();
  const provider = new BackendProvider(config);

  const shutdown = async () => {
    await provider.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.error(
    `[glpi-mcp] v${VERSION} -> ${config.glpiUrl} (api: ${config.apiMode}, ` +
      `${config.readOnly ? "read-only" : config.allowDelete ? "read-write + delete" : "read-write"})`,
  );

  if (config.transport === "http") {
    await startHttp(config, provider);
  } else {
    const server = createServer(config, provider);
    await server.connect(new StdioServerTransport());
  }
}

main().catch((err) => {
  console.error(`[glpi-mcp] ${err instanceof ConfigError ? "configuration error" : "fatal"}: ${err.message}`);
  process.exit(1);
});
