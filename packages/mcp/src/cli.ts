#!/usr/bin/env node
/**
 * stdio entry point for the NextDog MCP server.
 *
 * Registered in an MCP client (Claude Code / Cursor / Claude Desktop) via
 * `.mcp.json` — see the package README. Reads the sidecar URL from `NEXTDOG_URL`
 * (default http://localhost:6789). All logging goes to stderr so it never
 * corrupts the stdio JSON-RPC stream on stdout.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { DEFAULT_SIDECAR_URL } from './client.js';

async function main(): Promise<void> {
  const baseUrl = process.env.NEXTDOG_URL ?? DEFAULT_SIDECAR_URL;
  const server = createMcpServer({ baseUrl });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the JSON-RPC channel.
  process.stderr.write(`[nextdog-mcp] connected (sidecar: ${baseUrl})\n`);
}

main().catch((err) => {
  process.stderr.write(`[nextdog-mcp] failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
