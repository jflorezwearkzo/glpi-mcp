# glpi-mcp

MCP (Model Context Protocol) server that lets Claude work with **GLPI**: tickets, changes and problems
(with their timeline and team), assets, users, groups, the knowledge base and any other itemtype.

It speaks **both GLPI APIs** and picks one automatically:

| GLPI | API used | Auth |
|------|----------|------|
| 9.x / 10.x | Legacy REST API (`/apirest.php`) | App-Token (optional) + user token, or login/password |
| 11.x / 12.x | High-Level API (`/api.php`, version pinned) **or** legacy REST API | OAuth2 password grant, or user token |

And runs over **stdio** (Claude Desktop, Claude Code) or **Streamable HTTP** (remote server for Claude Code,
the Claude API MCP connector or your own agents).

---

## Tools

Read (always available):

| Tool | What it does |
|------|--------------|
| `glpi_server_info` | Active API and version, GLPI URL, safety modes |
| `glpi_whoami` | GLPI user, profile and entity the tools act as |
| `glpi_search_tickets` | Search tickets / changes / problems by status, priority, type, category, text, assignee* |
| `glpi_get_ticket` | One ticket with its timeline (followups, tasks, solutions) and team |
| `glpi_search_items` | Find any itemtype by name (Computer, User, Group, Location, ITILCategory...) |
| `glpi_list_items` / `glpi_get_item` | List or read items of any itemtype |
| `glpi_search_knowledgebase` | Search KB articles |
| `glpi_raw_get` | Read-only GET on any endpoint of the active API |

Write (only with `GLPI_READ_ONLY=false`):

`glpi_create_ticket`, `glpi_update_ticket`, `glpi_add_followup`, `glpi_add_task`, `glpi_add_solution`,
`glpi_assign` (requester / assigned / observer, user or group), `glpi_create_item`, `glpi_update_item`.

Delete (only with `GLPI_READ_ONLY=false` **and** `GLPI_ALLOW_DELETE=true`): `glpi_delete_item`.

\* Filtering by assignee or requester works on the legacy API only; the High-Level API computes the team per item.

Tools carry MCP annotations (`readOnlyHint`, `destructiveHint`) so Claude asks before writing.

---

## 1. Prepare GLPI

Create a **dedicated service user** (e.g. `svc-mcp`) with a profile that has only the rights the tools need
(e.g. a technician profile on the entities it should see). Every call runs with that user's rights.

**Legacy REST API** (any GLPI):
1. *Setup > General > API*: enable the REST API and "Enable login with external token".
2. Optionally add an API client with an App-Token (and restrict it by IP range).
3. Log in as the service user > *My settings* > *Remote access keys* > regenerate the **API token**.

**High-Level API** (GLPI 11+):
1. *Setup > General > API*: enable the API.
2. *Setup > OAuth clients* > Add: grant **Password**, scope **api**. Copy the client ID and secret.

## 2. Install

Requires Node.js 20+.

```sh
git clone https://github.com/zylarion-solutions/glpi-mcp.git
cd glpi-mcp
npm ci        # also builds dist/
cp .env.example .env   # reference for the variables
```

## 3. Connect it to Claude

### Claude Code (stdio)

```sh
claude mcp add glpi \
  -e GLPI_URL=https://glpi.example.com \
  -e GLPI_USER_TOKEN=xxxx \
  -e GLPI_APP_TOKEN=yyyy \
  -- node /absolute/path/to/glpi-mcp/dist/index.js
```

### Claude Desktop (stdio)

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "glpi": {
      "command": "node",
      "args": ["/absolute/path/to/glpi-mcp/dist/index.js"],
      "env": {
        "GLPI_URL": "https://glpi.example.com",
        "GLPI_OAUTH_CLIENT_ID": "...",
        "GLPI_OAUTH_CLIENT_SECRET": "...",
        "GLPI_USERNAME": "svc-mcp",
        "GLPI_PASSWORD": "...",
        "GLPI_READ_ONLY": "true"
      }
    }
  }
}
```

### Remote (Streamable HTTP)

```sh
docker build -t glpi-mcp .
docker run -d --name glpi-mcp -p 8000:8000 --env-file .env \
  -e MCP_TRANSPORT=http -e MCP_AUTH_TOKEN=$(openssl rand -hex 32) glpi-mcp
```

Put it behind HTTPS (reverse proxy, Cloudflare Tunnel, Azure Container Apps / App Service...) and connect:

```sh
claude mcp add --transport http glpi https://mcp.example.com/mcp \
  --header "Authorization: Bearer <MCP_AUTH_TOKEN>"
```

The same URL and token work with the Claude API MCP connector (`authorization_token`) and with agents.
`GET /healthz` is an unauthenticated health check.

> Custom connectors on claude.ai authenticate with OAuth, not a static header. Using this server as a
> claude.ai connector needs an OAuth layer in front of `/mcp` (on the roadmap).

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GLPI_URL` | — | GLPI root URL (required) |
| `GLPI_API_MODE` | `auto` | `auto`, `legacy` or `hlapi` |
| `GLPI_APP_TOKEN` | — | Legacy API client App-Token, if defined |
| `GLPI_USER_TOKEN` | — | Legacy API user token |
| `GLPI_USERNAME` / `GLPI_PASSWORD` | — | OAuth password grant user (also legacy Basic auth fallback) |
| `GLPI_OAUTH_CLIENT_ID` / `GLPI_OAUTH_CLIENT_SECRET` | — | High-Level API OAuth client |
| `GLPI_OAUTH_SCOPE` | `api` | OAuth scope(s) |
| `GLPI_HLAPI_VERSION` | `auto` | `auto` = newest 2.x offered (else newest), or exact `2.3`, `3.0`... |
| `GLPI_READ_ONLY` | `true` | Register write tools only when `false` |
| `GLPI_ALLOW_DELETE` | `false` | Register the delete tool |
| `GLPI_TIMEOUT_MS` | `30000` | Timeout per GLPI request |
| `GLPI_MAX_LIMIT` | `100` | Max rows per list/search call |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | `127.0.0.1` / `8000` | HTTP listen address (`0.0.0.0` in Docker) |
| `MCP_AUTH_TOKEN` | — | Bearer token required on `/mcp` (mandatory for http) |
| `MCP_ALLOWED_ORIGINS` | — | Allowed browser `Origin` values, comma-separated |

### How `auto` chooses

1. OAuth credentials set and `GET /api.php/` lists High-Level API versions → **High-Level API**, version pinned.
2. Otherwise, a user token (or login/password) is set → **legacy REST API**.

Ask Claude to run `glpi_server_info` to see the choice.

## Security notes

- Read-only by default; deleting needs two explicit switches.
- Use a least-privilege service user; GLPI enforces its profile and entities on every call.
- Secrets come from the environment only and are never logged.
- HTTP mode refuses to start without `MCP_AUTH_TOKEN` (unless `MCP_ALLOW_NO_AUTH=true` for local tests),
  compares tokens in constant time, and binds to `127.0.0.1` unless told otherwise.
- Itemtypes and raw paths are validated (no path traversal).

## Development

```sh
npm run dev                         # run from source (tsx)
npm test                            # vitest, HTTP mocked
npm run typecheck
npm run ci                          # typecheck + tests + build (same as CI)
npx @modelcontextprotocol/inspector node dist/index.js   # try the tools interactively
```

```
src/
  index.ts         entry point (stdio | http)
  http.ts          Streamable HTTP transport + bearer auth
  server.ts        MCP server
  tools.ts         tool definitions (API-agnostic)
  config.ts        environment
  glpi/
    types.ts       backend contract
    legacy.ts      /apirest.php client (session, search engine, sub-items)
    hlapi.ts       /api.php client (OAuth2, version pinning, RSQL)
    factory.ts     auto-detection
```

## Contributing

Branches, pull requests and commit conventions: [CONTRIBUTING.md](CONTRIBUTING.md) (Spanish). Report vulnerabilities privately to **security@zylarion.io** — see [SECURITY.md](SECURITY.md).

## Roadmap

- OAuth for the HTTP transport (claude.ai custom connectors)
- Per-user tokens in HTTP mode (each Claude user acts as their own GLPI user)
- Documents (upload/download), validations, SLA/OLA views, statistics

## License

MIT
