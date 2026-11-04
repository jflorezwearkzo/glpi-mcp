/**
 * MCP tools. They talk to a GlpiBackend, so they behave the same on the legacy
 * REST API and on the High-Level API.
 *
 * Safety: write tools are only registered when GLPI_READ_ONLY=false, and the
 * delete tool only when GLPI_ALLOW_DELETE=true as well.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import type { BackendProvider } from "./glpi/factory.js";
import { ITIL_TYPES, type GlpiBackend, type ItilType } from "./glpi/types.js";

const MAX_TEXT = 100_000;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  let text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  if (text.length > MAX_TEXT) {
    text = `${text.slice(0, MAX_TEXT)}\n... [truncated ${text.length - MAX_TEXT} characters; narrow the query or lower the limit]`;
  }
  return { content: [{ type: "text", text }] };
}

function fail(err: unknown): ToolResult {
  return { content: [{ type: "text", text: `Error: ${(err as Error)?.message ?? String(err)}` }], isError: true };
}

const itilType = z
  .enum(ITIL_TYPES)
  .default("Ticket")
  .describe("ITIL object: Ticket (default), Change or Problem");
const id = z.number().int().positive();
const level = z.number().int().min(1).max(5);
const itemtype = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
  .describe(
    "GLPI itemtype, e.g. Computer, Monitor, NetworkEquipment, Printer, Phone, Software, User, Group, Entity, " +
      "Location, ITILCategory, Supplier, Contract, Document, KnowbaseItem",
  );
const fieldsObj = z.record(z.string(), z.unknown());

export function registerTools(server: McpServer, provider: BackendProvider, config: Config): string[] {
  const names: string[] = [];
  const limitSchema = z.number().int().min(1).max(config.maxLimit).default(Math.min(20, config.maxLimit));
  const startSchema = z.number().int().min(0).default(0).describe("Offset for pagination");

  const run =
    <A>(fn: (b: GlpiBackend, args: A) => Promise<unknown>) =>
    async (args: A): Promise<ToolResult> => {
      try {
        return ok(await fn(await provider.get(), args));
      } catch (err) {
        return fail(err);
      }
    };

  const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

  const add = (
    name: string,
    title: string,
    description: string,
    inputSchema: z.ZodRawShape,
    annotations: Record<string, boolean>,
    handler: (args: any) => Promise<ToolResult>,
  ) => {
    server.registerTool(name, { title, description, inputSchema, annotations: { title, ...annotations } }, handler);
    names.push(name);
  };

  // ------------------------------------------------------------- read tools

  add(
    "glpi_server_info",
    "GLPI server info",
    "Show which GLPI API this server uses (legacy REST or High-Level API and its pinned version), the GLPI URL " +
      "and the safety modes (read-only, delete allowed). Call it first when a connection problem is suspected.",
    {},
    read,
    run(async (b) => ({
      ...(await b.describe()),
      glpi_url: config.glpiUrl,
      read_only: config.readOnly,
      delete_allowed: !config.readOnly && config.allowDelete,
      max_limit: config.maxLimit,
    })),
  );

  add(
    "glpi_whoami",
    "Current GLPI user",
    "The GLPI user the tools act as, with the active profile and entity. Every call runs with that user's rights.",
    {},
    read,
    run((b) => b.whoami()),
  );

  add(
    "glpi_search_tickets",
    "Search tickets, changes or problems",
    "List tickets (or changes/problems), newest change first, with a compact summary of each. " +
      "Status IDs: 1 new, 2 processing (assigned), 3 processing (planned), 4 pending, 5 solved, 6 closed. " +
      "Priority IDs: 1 very low ... 5 very high, 6 major. Ticket type: 1 incident, 2 request. " +
      "Use glpi_get_ticket for the description, timeline and team of one item. " +
      "Filtering by assignee/requester works on the legacy API only.",
    {
      itil_type: itilType,
      text: z.string().min(1).optional().describe("Text to look for in the title (and content on the High-Level API)"),
      statuses: z.array(z.number().int().min(1).max(6)).optional().describe("Status IDs to include"),
      open_only: z.boolean().default(true).describe("Exclude solved and closed items (ignored when statuses is set)"),
      priorities: z.array(z.number().int().min(1).max(6)).optional(),
      ticket_type: z.number().int().min(1).max(2).optional().describe("1 incident, 2 request (tickets only)"),
      category_id: id.optional(),
      assigned_user_id: id.optional(),
      assigned_group_id: id.optional(),
      requester_user_id: id.optional(),
      start: startSchema,
      limit: limitSchema,
    },
    read,
    run((b, a: any) =>
      b.listItil({
        itilType: a.itil_type as ItilType,
        text: a.text,
        statuses: a.statuses,
        openOnly: a.open_only,
        priorities: a.priorities,
        ticketType: a.ticket_type,
        categoryId: a.category_id,
        assignedUserId: a.assigned_user_id,
        assignedGroupId: a.assigned_group_id,
        requesterUserId: a.requester_user_id,
        start: a.start,
        limit: a.limit,
      }),
    ),
  );

  add(
    "glpi_get_ticket",
    "Get a ticket, change or problem",
    "Full details of one ticket (or change/problem). Optionally include its timeline (followups, tasks, " +
      "solutions) and its team (requesters, assigned technicians and groups, observers).",
    {
      id,
      itil_type: itilType,
      include_timeline: z.boolean().default(true),
      include_team: z.boolean().default(true),
    },
    read,
    run(async (b, a: any) => {
      const [item, timeline, team] = await Promise.all([
        b.getItil(a.itil_type, a.id),
        a.include_timeline ? b.getItilTimeline(a.itil_type, a.id) : Promise.resolve(undefined),
        a.include_team ? b.getItilTeam(a.itil_type, a.id) : Promise.resolve(undefined),
      ]);
      return { item, timeline, team };
    }),
  );

  add(
    "glpi_search_items",
    "Search GLPI items by name",
    "Find assets, users, groups, locations, categories, suppliers, KB articles or any other itemtype by name " +
      "(partial match). Returns IDs to use with glpi_get_item or the ticket tools.",
    { itemtype, query: z.string().min(1), start: startSchema, limit: limitSchema },
    read,
    run((b, a: any) => b.searchItems(a.itemtype, a.query, a.start, a.limit)),
  );

  add(
    "glpi_list_items",
    "List GLPI items",
    "List items of one itemtype (e.g. all Computers), paginated.",
    { itemtype, start: startSchema, limit: limitSchema },
    read,
    run((b, a: any) => b.listItems(a.itemtype, a.start, a.limit)),
  );

  add(
    "glpi_get_item",
    "Get a GLPI item",
    "Full record of one item of any itemtype (asset, user, group, KB article, ...).",
    { itemtype, id },
    read,
    run((b, a: any) => b.getItem(a.itemtype, a.id)),
  );

  add(
    "glpi_search_knowledgebase",
    "Search the knowledge base",
    "Find knowledge base articles whose title matches the text. Read one with glpi_get_item (itemtype KnowbaseItem).",
    { query: z.string().min(1), start: startSchema, limit: limitSchema },
    read,
    run((b, a: any) => b.searchItems("KnowbaseItem", a.query, a.start, a.limit)),
  );

  add(
    "glpi_raw_get",
    "Raw GET on the GLPI API",
    "Read-only escape hatch: GET any endpoint of the API in use, relative to its root. " +
      "Legacy examples: 'Ticket/12/Document_Item', 'search/Computer' with query {criteria: [...]}, 'listSearchOptions/Ticket'. " +
      "High-Level examples: 'Assets/Computer/5', 'Administration/User/Me'. Call glpi_server_info to know which API is active.",
    {
      path: z.string().min(1).max(300),
      query: fieldsObj.optional().describe("Query parameters; nested objects/arrays are encoded PHP-style"),
    },
    read,
    run((b, a: any) => b.rawGet(a.path, a.query)),
  );

  if (config.readOnly) return names;

  // ------------------------------------------------------------ write tools

  add(
    "glpi_create_ticket",
    "Create a ticket, change or problem",
    "Create a ticket (or change/problem). Priority is computed by GLPI from urgency and impact when omitted. " +
      "Optionally set the requester and the assigned technician/group. Confirm the content with the user before creating.",
    {
      itil_type: itilType,
      name: z.string().min(1).max(255).describe("Title"),
      content: z.string().min(1).describe("Description (HTML or plain text)"),
      ticket_type: z.number().int().min(1).max(2).optional().describe("1 incident, 2 request (tickets only)"),
      urgency: level.optional(),
      impact: level.optional(),
      priority: z.number().int().min(1).max(6).optional(),
      category_id: id.optional(),
      entity_id: z.number().int().min(0).optional(),
      location_id: id.optional(),
      requester_user_id: id.optional(),
      assigned_user_id: id.optional(),
      assigned_group_id: id.optional(),
    },
    write,
    run((b, a: any) =>
      b.createItil({
        itilType: a.itil_type,
        name: a.name,
        content: a.content,
        ticketType: a.ticket_type,
        urgency: a.urgency,
        impact: a.impact,
        priority: a.priority,
        categoryId: a.category_id,
        entityId: a.entity_id,
        locationId: a.location_id,
        requesterUserId: a.requester_user_id,
        assignedUserId: a.assigned_user_id,
        assignedGroupId: a.assigned_group_id,
      }),
    ),
  );

  add(
    "glpi_update_ticket",
    "Update a ticket, change or problem",
    "Change fields of a ticket (status, priority, urgency, impact, category, title, description...). " +
      "Use 'extra' for other fields, in the active API's own field names.",
    {
      id,
      itil_type: itilType,
      name: z.string().min(1).max(255).optional(),
      content: z.string().min(1).optional(),
      status: z.number().int().min(1).max(6).optional(),
      urgency: level.optional(),
      impact: level.optional(),
      priority: z.number().int().min(1).max(6).optional(),
      ticket_type: z.number().int().min(1).max(2).optional(),
      category_id: id.optional(),
      location_id: id.optional(),
      extra: fieldsObj.optional(),
    },
    { ...write, idempotentHint: true },
    run((b, a: any) =>
      b.updateItil(a.itil_type, a.id, {
        name: a.name,
        content: a.content,
        status: a.status,
        urgency: a.urgency,
        impact: a.impact,
        priority: a.priority,
        ticketType: a.ticket_type,
        categoryId: a.category_id,
        locationId: a.location_id,
        extra: a.extra,
      }),
    ),
  );

  add(
    "glpi_add_followup",
    "Add a followup",
    "Add a followup (a reply/comment in the conversation) to a ticket, change or problem. " +
      "Public followups are visible to the requester and may trigger email notifications.",
    { id, itil_type: itilType, content: z.string().min(1), is_private: z.boolean().default(false) },
    write,
    run((b, a: any) => b.addFollowup(a.itil_type, a.id, a.content, a.is_private)),
  );

  add(
    "glpi_add_task",
    "Add a task",
    "Add a task (work to do or done, with time spent) to a ticket, change or problem.",
    {
      id,
      itil_type: itilType,
      content: z.string().min(1),
      is_private: z.boolean().default(true),
      state: z.number().int().min(0).max(2).optional().describe("0 information, 1 to do, 2 done"),
      duration_seconds: z.number().int().min(0).optional().describe("Time spent, in seconds"),
      tech_user_id: id.optional().describe("Technician in charge of the task"),
    },
    write,
    run((b, a: any) =>
      b.addTask(a.itil_type, a.id, {
        content: a.content,
        isPrivate: a.is_private,
        state: a.state,
        durationSeconds: a.duration_seconds,
        techUserId: a.tech_user_id,
      }),
    ),
  );

  add(
    "glpi_add_solution",
    "Add a solution",
    "Add a solution to a ticket, change or problem, which marks it solved (the requester may approve or refuse it).",
    { id, itil_type: itilType, content: z.string().min(1) },
    write,
    run((b, a: any) => b.addSolution(a.itil_type, a.id, a.content)),
  );

  add(
    "glpi_assign",
    "Assign or add a team member",
    "Add a user or group to a ticket, change or problem as requester, assigned technician/group, or observer. " +
      "To assign a technician: member_type 'User', role 'assigned'.",
    {
      id,
      itil_type: itilType,
      member_type: z.enum(["User", "Group"]),
      member_id: id,
      role: z.enum(["requester", "assigned", "observer"]).default("assigned"),
    },
    write,
    run((b, a: any) => b.addTeamMember(a.itil_type, a.id, a.member_type, a.member_id, a.role)),
  );

  add(
    "glpi_create_item",
    "Create a GLPI item",
    "Create an item of any itemtype (asset, location, KB article...). Fields use the active API's field names; " +
      "check an existing item with glpi_get_item to see them.",
    { itemtype, fields: fieldsObj },
    write,
    run((b, a: any) => b.createItem(a.itemtype, a.fields)),
  );

  add(
    "glpi_update_item",
    "Update a GLPI item",
    "Change fields of an item of any itemtype. Fields use the active API's field names.",
    { itemtype, id, fields: fieldsObj },
    { ...write, idempotentHint: true },
    run((b, a: any) => b.updateItem(a.itemtype, a.id, a.fields)),
  );

  if (!config.allowDelete) return names;

  add(
    "glpi_delete_item",
    "Delete a GLPI item",
    "Move an item to the trash, or purge it permanently with purge=true. Always confirm with the user first.",
    { itemtype, id, purge: z.boolean().default(false).describe("Delete permanently instead of moving to the trash") },
    { ...write, destructiveHint: true, idempotentHint: true },
    run((b, a: any) => b.deleteItem(a.itemtype, a.id, a.purge)),
  );

  return names;
}
