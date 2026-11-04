import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import type { BackendProvider } from "./glpi/factory.js";
import { registerTools } from "./tools.js";
import { VERSION } from "./version.js";

const INSTRUCTIONS = `Tools for the GLPI IT service management instance at the configured URL.
- Every call acts with the rights of one GLPI user (see glpi_whoami).
- Find IDs first (glpi_search_items for users, groups, categories, assets), then act on tickets.
- Before creating or changing anything, confirm the exact content with the user.
- Public followups and solutions are visible to the requester and can send emails.`;

export function createServer(config: Config, provider: BackendProvider): McpServer {
  const server = new McpServer({ name: "glpi-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
  registerTools(server, provider, config);
  return server;
}
