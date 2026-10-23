import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// Remote MCP servers attached to an agent via `mcp_servers` in the agent YAML.
// Credentials live in the per-agent secret store and are referenced as ${{ secrets.NAME }}.

export const MCP_TIMEOUT_MS = Number(process.env.MCP_TIMEOUT_MS) > 0 ? Number(process.env.MCP_TIMEOUT_MS) : 15_000;
export const MCP_MAX_TOOL_ITERATIONS = Number(process.env.MCP_MAX_TOOL_ITERATIONS) > 0 ? Number(process.env.MCP_MAX_TOOL_ITERATIONS) : 5;
const MAX_RESULT_CHARS = 32_000;

export const MCP_TOOL_PREFIX = 'mcp__';
const SERVER_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
export const SECRET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const SECRET_REF_RE = /^\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]{0,63})\s*\}\}$/;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;

export type McpAuth =
    | { type: 'none' }
    | { type: 'bearer'; token: string }
    | { type: 'header'; name: string; value: string };

export interface McpServerConfig {
    name: string;
    url: string;
    auth: McpAuth;
    tools: string[];
}

export interface McpToolInfo {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
}

export class McpConfigError extends Error {}

/** A safe-to-surface error: message never contains credentials. */
export class McpError extends Error {
    constructor(message: string, readonly server: string) {
        super(message);
    }
}

function validateUrl(raw: unknown, where: string): string {
    if (typeof raw !== 'string' || !raw.trim()) throw new McpConfigError(`${where}.url is required`);
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new McpConfigError(`${where}.url is not a valid URL`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new McpConfigError(`${where}.url must use http or https`);
    }
    if (url.username || url.password) {
        throw new McpConfigError(`${where}.url must not embed credentials; use auth with a secret`);
    }
    return url.toString();
}

function validateAuth(raw: unknown, where: string): McpAuth {
    if (raw === undefined || raw === null) return { type: 'none' };
    if (typeof raw !== 'object') throw new McpConfigError(`${where}.auth must be an object`);
    const a = raw as Record<string, unknown>;
    const type = a.type ?? 'none';
    if (type === 'none') return { type: 'none' };
    if (type === 'bearer') {
        if (typeof a.token !== 'string' || !a.token) throw new McpConfigError(`${where}.auth.token is required`);
        return { type: 'bearer', token: a.token };
    }
    if (type === 'header') {
        if (typeof a.name !== 'string' || !HEADER_NAME_RE.test(a.name)) throw new McpConfigError(`${where}.auth.name must be a valid header name`);
        if (typeof a.value !== 'string' || !a.value) throw new McpConfigError(`${where}.auth.value is required`);
        return { type: 'header', name: a.name, value: a.value };
    }
    throw new McpConfigError(`${where}.auth.type must be one of: none, bearer, header`);
}

/** Validate a single server entry (used by both agent YAML and the discover endpoint). */
export function parseMcpServer(raw: unknown, where = 'mcp_server'): McpServerConfig {
    if (!raw || typeof raw !== 'object') throw new McpConfigError(`${where} must be an object`);
    const s = raw as Record<string, unknown>;
    if (typeof s.name !== 'string' || !SERVER_NAME_RE.test(s.name)) {
        throw new McpConfigError(`${where}.name must match ${SERVER_NAME_RE.source}`);
    }
    const tools = s.tools ?? [];
    if (!Array.isArray(tools) || tools.some(t => typeof t !== 'string' || !t)) {
        throw new McpConfigError(`${where}.tools must be a list of tool names`);
    }
    return {
        name: s.name,
        url: validateUrl(s.url, where),
        auth: validateAuth(s.auth, where),
        tools: [...new Set(tools as string[])],
    };
}

/** Parse `mcp_servers` from a parsed agent YAML object. Throws McpConfigError on invalid input. */
export function parseMcpServers(raw: unknown): McpServerConfig[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new McpConfigError('mcp_servers must be a list');
    const servers = raw.map((s, i) => parseMcpServer(s, `mcp_servers[${i}]`));
    const names = new Set<string>();
    for (const s of servers) {
        if (names.has(s.name)) throw new McpConfigError(`mcp_servers: duplicate server name '${s.name}'`);
        names.add(s.name);
    }
    return servers;
}

function secretRef(value: string): string | null {
    return SECRET_REF_RE.exec(value.trim())?.[1] ?? null;
}

/** Names of all secrets referenced by these servers. */
export function referencedSecrets(servers: McpServerConfig[]): string[] {
    const names = new Set<string>();
    for (const s of servers) {
        const v = s.auth.type === 'bearer' ? s.auth.token : s.auth.type === 'header' ? s.auth.value : null;
        const ref = v ? secretRef(v) : null;
        if (ref) names.add(ref);
    }
    return [...names];
}

/**
 * Credentials in agent YAML must be secret references, never literals, so YAML
 * views/downloads can't leak them.
 */
export function assertNoLiteralCredentials(servers: McpServerConfig[]): void {
    for (const s of servers) {
        const v = s.auth.type === 'bearer' ? s.auth.token : s.auth.type === 'header' ? s.auth.value : null;
        if (v && !secretRef(v)) {
            throw new McpConfigError(`mcp_servers '${s.name}': credentials must be a secret reference like \${{ secrets.NAME }}`);
        }
    }
}

function resolveValue(value: string, secrets: Record<string, string>, server: string): string {
    const ref = secretRef(value);
    if (!ref) return value;
    const resolved = secrets[ref];
    if (resolved === undefined) throw new McpError(`MCP server '${server}': secret '${ref}' is not set`, server);
    return resolved;
}

function buildHeaders(server: McpServerConfig, secrets: Record<string, string>): Record<string, string> {
    if (server.auth.type === 'bearer') {
        return { Authorization: `Bearer ${resolveValue(server.auth.token, secrets, server.name)}` };
    }
    if (server.auth.type === 'header') {
        return { [server.auth.name]: resolveValue(server.auth.value, secrets, server.name) };
    }
    return {};
}

function describeError(err: unknown): string {
    if (err instanceof McpDestinationError) return err.message;
    const code = (err as { code?: unknown })?.code;
    if (typeof code === 'number' && code === -32001) return 'request timed out';
    const status = (err as { status?: unknown })?.status;
    if (typeof status === 'number') return `HTTP ${status}`;
    const msg = err instanceof Error ? err.message : '';
    const httpMatch = /HTTP (\d{3})/.exec(msg);
    if (httpMatch) return `HTTP ${httpMatch[1]}`;
    if (/timed? ?out/i.test(msg)) return 'request timed out';
    if (/ECONNREFUSED|ENOTFOUND|fetch failed|EAI_AGAIN/i.test(msg)) return 'server unreachable';
    return 'request failed';
}

class McpDestinationError extends Error {}

function envList(name: string): string[] {
    return (process.env[name] || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
}

function isPrivateAddress(ip: string): boolean {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (isIP(ip) === 4) {
        const [a, b] = ip.split('.').map(Number);
        return a === 0 || a === 10 || a === 127 || a >= 224
            || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254)
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 198 && (b === 18 || b === 19));
    }
    const v6 = ip.toLowerCase();
    return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff');
}

/**
 * Operator policy for outbound MCP requests. MCP_ALLOWED_HOSTS (comma list) restricts
 * hostnames; private/loopback/link-local targets need MCP_ALLOW_PRIVATE_NETWORKS=true.
 */
async function assertAllowedDestination(url: URL): Promise<void> {
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const allowedHosts = envList('MCP_ALLOWED_HOSTS');
    if (allowedHosts.length && !allowedHosts.includes(host)) {
        throw new McpDestinationError(`destination host '${host}' is not allowed`);
    }
    if (process.env.MCP_ALLOW_PRIVATE_NETWORKS === 'true') return;
    let addresses: string[];
    try {
        addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map(a => a.address);
    } catch {
        throw new McpDestinationError('server unreachable');
    }
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
        throw new McpDestinationError(`destination host '${host}' resolves to a private network address`);
    }
}

// Every transport request (including redirects, which are refused) is checked against the policy.
const guardedFetch: typeof fetch = async (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    await assertAllowedDestination(new URL(target));
    return fetch(input, { ...init, redirect: 'error' });
};

export interface McpConnection {
    listTools(): Promise<McpToolInfo[]>;
    callTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
    close(): Promise<void>;
}

export async function connectMcpServer(server: McpServerConfig, secrets: Record<string, string>): Promise<McpConnection> {
    const headers = buildHeaders(server, secrets);
    try {
        await assertAllowedDestination(new URL(server.url));
    } catch (err) {
        throw new McpError(`MCP server '${server.name}' connection failed: ${describeError(err)}`, server.name);
    }
    const transport = new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers }, fetch: guardedFetch });
    const client = new Client({ name: 'ozwell-reference-server', version: '1.0.0' });
    try {
        await client.connect(transport, { timeout: MCP_TIMEOUT_MS });
    } catch (err) {
        await client.close().catch(() => undefined);
        throw new McpError(`MCP server '${server.name}' connection failed: ${describeError(err)}`, server.name);
    }

    return {
        async listTools() {
            try {
                const tools: McpToolInfo[] = [];
                let cursor: string | undefined;
                do {
                    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: MCP_TIMEOUT_MS });
                    for (const t of page.tools) {
                        tools.push({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> });
                    }
                    cursor = page.nextCursor;
                } while (cursor);
                return tools;
            } catch (err) {
                throw new McpError(`MCP server '${server.name}' tools/list failed: ${describeError(err)}`, server.name);
            }
        },
        async callTool(name, args) {
            try {
                const result = await client.callTool({ name, arguments: args }, undefined, { timeout: MCP_TIMEOUT_MS });
                const content = Array.isArray(result.content) ? result.content : [];
                const text = content
                    .map((c: { type?: string; text?: string }) => (c.type === 'text' && typeof c.text === 'string' ? c.text : JSON.stringify(c)))
                    .join('\n');
                const structured = !text && result.structuredContent ? JSON.stringify(result.structuredContent) : '';
                const out = text || structured;
                return {
                    text: out.length > MAX_RESULT_CHARS ? `${out.slice(0, MAX_RESULT_CHARS)}\n[truncated]` : out,
                    isError: Boolean(result.isError),
                };
            } catch (err) {
                throw new McpError(`MCP tool '${name}' on '${server.name}' failed: ${describeError(err)}`, server.name);
            }
        },
        close: () => client.close().catch(() => undefined),
    };
}

/** One-shot tools/list for the agent editor. */
export async function discoverMcpTools(server: McpServerConfig, secrets: Record<string, string>): Promise<McpToolInfo[]> {
    const conn = await connectMcpServer(server, secrets);
    try {
        return await conn.listTools();
    } finally {
        await conn.close();
    }
}

type ChatTool = { type: 'function'; function: { name: string; description?: string; parameters?: Record<string, unknown> } };

/** Allowlisted MCP tools for one chat request, exposed to the LLM under namespaced names. */
export interface McpSession {
    tools: ChatTool[];
    isMcpTool(name: string): boolean;
    call(exposedName: string, rawArgs: string): Promise<string>;
    close(): Promise<void>;
}

function exposedToolName(server: string, tool: string, taken: Set<string>): string {
    const base = `${MCP_TOOL_PREFIX}${server}__${tool.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64);
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base.slice(0, 60)}_${i}`;
    taken.add(name);
    return name;
}

/**
 * Connects to every server that has at least one allowlisted tool. Servers that
 * fail to connect are skipped and reported via onError; only tools that are both
 * allowlisted and actually offered by the server are exposed.
 */
export async function openMcpSession(
    servers: McpServerConfig[],
    secrets: Record<string, string>,
    onError: (err: McpError) => void,
): Promise<McpSession> {
    const connections: McpConnection[] = [];
    const routes = new Map<string, { conn: McpConnection; tool: string }>();
    const tools: ChatTool[] = [];
    const taken = new Set<string>();

    await Promise.all(servers.filter(s => s.tools.length > 0).map(async (server) => {
        let conn: McpConnection;
        try {
            conn = await connectMcpServer(server, secrets);
        } catch (err) {
            onError(err instanceof McpError ? err : new McpError(`MCP server '${server.name}' connection failed`, server.name));
            return;
        }
        connections.push(conn);
        try {
            const allow = new Set(server.tools);
            for (const t of await conn.listTools()) {
                if (!allow.has(t.name)) continue;
                const exposed = exposedToolName(server.name, t.name, taken);
                routes.set(exposed, { conn, tool: t.name });
                tools.push({
                    type: 'function',
                    function: {
                        name: exposed,
                        ...(t.description && { description: t.description }),
                        parameters: t.inputSchema ?? { type: 'object', properties: {} },
                    },
                });
            }
        } catch (err) {
            onError(err instanceof McpError ? err : new McpError(`MCP server '${server.name}' tools/list failed`, server.name));
        }
    }));

    return {
        tools,
        isMcpTool: (name) => routes.has(name),
        async call(exposedName, rawArgs) {
            const route = routes.get(exposedName);
            if (!route) return JSON.stringify({ error: `Tool '${exposedName}' is not available` });
            let args: Record<string, unknown> = {};
            try {
                const parsed = rawArgs ? JSON.parse(rawArgs) : {};
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
            } catch {
                return JSON.stringify({ error: 'Tool arguments were not valid JSON' });
            }
            try {
                const result = await route.conn.callTool(route.tool, args);
                return result.isError ? JSON.stringify({ error: result.text || 'Tool returned an error' }) : result.text;
            } catch (err) {
                onError(err instanceof McpError ? err : new McpError(`MCP tool '${route.tool}' failed`, ''));
                return JSON.stringify({ error: err instanceof McpError ? err.message : 'Tool call failed' });
            }
        },
        async close() {
            await Promise.all(connections.map(c => c.close()));
        },
    };
}
