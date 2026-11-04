/**
 * Picks the backend for the configured GLPI.
 *
 * GLPI_API_MODE=auto (default):
 *   - OAuth credentials present and GLPI lists High-Level API versions -> hlapi
 *   - otherwise legacy credentials present -> legacy
 * The choice is made on the first tool call, so the MCP server starts even if
 * GLPI is unreachable at that moment.
 */
import { ConfigError, hasLegacyCredentials, hasOAuthCredentials, type Config } from "../config.js";
import type { FetchLike } from "./http.js";
import { HlapiBackend } from "./hlapi.js";
import { LegacyBackend } from "./legacy.js";
import type { GlpiBackend } from "./types.js";

export async function createBackend(config: Config, fetchImpl: FetchLike = fetch): Promise<GlpiBackend> {
  const legacyOk = hasLegacyCredentials(config);
  const oauthOk = hasOAuthCredentials(config);

  if (config.apiMode === "legacy") {
    if (!legacyOk) throw new ConfigError("GLPI_API_MODE=legacy needs GLPI_USER_TOKEN, or GLPI_USERNAME and GLPI_PASSWORD");
    return new LegacyBackend(config, fetchImpl);
  }
  if (config.apiMode === "hlapi") {
    if (!oauthOk) {
      throw new ConfigError(
        "GLPI_API_MODE=hlapi needs GLPI_OAUTH_CLIENT_ID, GLPI_OAUTH_CLIENT_SECRET and a username/password",
      );
    }
    const hl = new HlapiBackend(config, fetchImpl);
    await hl.pinnedVersion();
    return hl;
  }

  // auto
  if (oauthOk) {
    const hl = new HlapiBackend(config, fetchImpl);
    try {
      await hl.pinnedVersion();
      return hl;
    } catch (err) {
      if (!legacyOk) {
        throw new Error(
          `OAuth credentials are set but the High-Level API is not available (${(err as Error).message}). ` +
            "It needs GLPI 11 or newer; for GLPI 10 set GLPI_USER_TOKEN (and GLPI_APP_TOKEN if required).",
        );
      }
    }
  }
  if (legacyOk) return new LegacyBackend(config, fetchImpl);
  throw new ConfigError(
    "No GLPI credentials configured. Set GLPI_USER_TOKEN (legacy API, GLPI 9-11) or " +
      "GLPI_OAUTH_CLIENT_ID/GLPI_OAUTH_CLIENT_SECRET/GLPI_USERNAME/GLPI_PASSWORD (High-Level API, GLPI 11+).",
  );
}

/** Lazily creates one backend and shares it between tool calls. */
export class BackendProvider {
  private backend?: GlpiBackend;
  private pending?: Promise<GlpiBackend>;

  constructor(
    private readonly config: Config,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async get(): Promise<GlpiBackend> {
    if (this.backend) return this.backend;
    this.pending ??= createBackend(this.config, this.fetchImpl)
      .then((b) => (this.backend = b))
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  async close(): Promise<void> {
    await this.backend?.close();
    this.backend = undefined;
  }
}
