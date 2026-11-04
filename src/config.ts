/**
 * Configuration, read from environment variables.
 *
 * Only GLPI_URL is always required. Which credentials are needed depends on the
 * API mode: the legacy REST API uses an App-Token plus a user token (or a login
 * and password); the High-Level API (GLPI 11+) uses an OAuth2 client with the
 * password grant.
 */

export type ApiMode = "auto" | "legacy" | "hlapi";
export type TransportMode = "stdio" | "http";

export interface LegacyCredentials {
  appToken?: string;
  userToken?: string;
  username?: string;
  password?: string;
}

export interface OAuthCredentials {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  scope: string;
}

export interface Config {
  glpiUrl: string;
  apiMode: ApiMode;
  /** "auto" or an exact "major.minor" High-Level API version such as "2.3". */
  hlapiVersion: string;
  legacy: LegacyCredentials;
  oauth: OAuthCredentials;
  readOnly: boolean;
  allowDelete: boolean;
  timeoutMs: number;
  /** Max rows a list/search tool may return in one call. */
  maxLimit: number;
  transport: TransportMode;
  http: {
    host: string;
    port: number;
    /** Bearer token clients must send to /mcp. Required unless explicitly disabled. */
    authToken?: string;
    allowNoAuth: boolean;
    allowedOrigins: string[];
  };
}

export class ConfigError extends Error {}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${name} must be a positive integer`);
  return n;
}

function opt(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawUrl = opt(env.GLPI_URL);
  if (!rawUrl) throw new ConfigError("GLPI_URL is required (the GLPI root, e.g. https://glpi.example.com)");
  let glpiUrl = rawUrl.replace(/\/+$/, "");
  // Accept a URL pasted with the API suffix and strip it.
  glpiUrl = glpiUrl.replace(/\/(apirest\.php|api\.php)(\/.*)?$/i, "");
  try {
    new URL(glpiUrl);
  } catch {
    throw new ConfigError(`GLPI_URL is not a valid URL: ${rawUrl}`);
  }

  const apiMode = (opt(env.GLPI_API_MODE) ?? "auto").toLowerCase();
  if (!["auto", "legacy", "hlapi"].includes(apiMode)) {
    throw new ConfigError("GLPI_API_MODE must be auto, legacy or hlapi");
  }

  const transport = (opt(env.MCP_TRANSPORT) ?? "stdio").toLowerCase();
  if (!["stdio", "http"].includes(transport)) throw new ConfigError("MCP_TRANSPORT must be stdio or http");

  const hlapiVersion = opt(env.GLPI_HLAPI_VERSION) ?? "auto";
  if (hlapiVersion !== "auto" && !/^\d+\.\d+$/.test(hlapiVersion)) {
    throw new ConfigError('GLPI_HLAPI_VERSION must be "auto" or "major.minor", e.g. 2.3');
  }

  return {
    glpiUrl,
    apiMode: apiMode as ApiMode,
    hlapiVersion,
    legacy: {
      appToken: opt(env.GLPI_APP_TOKEN),
      userToken: opt(env.GLPI_USER_TOKEN),
      username: opt(env.GLPI_USERNAME),
      password: opt(env.GLPI_PASSWORD),
    },
    oauth: {
      clientId: opt(env.GLPI_OAUTH_CLIENT_ID),
      clientSecret: opt(env.GLPI_OAUTH_CLIENT_SECRET),
      username: opt(env.GLPI_OAUTH_USERNAME) ?? opt(env.GLPI_USERNAME),
      password: opt(env.GLPI_OAUTH_PASSWORD) ?? opt(env.GLPI_PASSWORD),
      scope: opt(env.GLPI_OAUTH_SCOPE) ?? "api",
    },
    readOnly: bool(env.GLPI_READ_ONLY, true),
    allowDelete: bool(env.GLPI_ALLOW_DELETE, false),
    timeoutMs: int(env.GLPI_TIMEOUT_MS, 30000, "GLPI_TIMEOUT_MS"),
    maxLimit: int(env.GLPI_MAX_LIMIT, 100, "GLPI_MAX_LIMIT"),
    transport: transport as TransportMode,
    http: {
      host: opt(env.MCP_HTTP_HOST) ?? "127.0.0.1",
      port: int(env.MCP_HTTP_PORT ?? env.PORT, 8000, "MCP_HTTP_PORT"),
      authToken: opt(env.MCP_AUTH_TOKEN),
      allowNoAuth: bool(env.MCP_ALLOW_NO_AUTH, false),
      allowedOrigins: (opt(env.MCP_ALLOWED_ORIGINS) ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
}

export function hasLegacyCredentials(c: Config): boolean {
  return Boolean(c.legacy.userToken || (c.legacy.username && c.legacy.password));
}

export function hasOAuthCredentials(c: Config): boolean {
  const o = c.oauth;
  return Boolean(o.clientId && o.clientSecret && o.username && o.password);
}
