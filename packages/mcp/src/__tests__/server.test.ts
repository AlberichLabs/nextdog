import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { SidecarClient } from '../client.js';
import { createMcpServer } from '../server.js';
import { makeFetch } from './fixtures.js';

async function connect(sidecar: SidecarClient) {
  const server = createMcpServer({ client: sidecar });
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('MCP server wiring', () => {
  it('advertises the four read-only tools', async () => {
    const client = await connect(new SidecarClient({ fetchImpl: makeFetch().fetchImpl }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['get_errors', 'get_trace', 'list_recent_traces', 'search_logs'].sort(),
    );
  });

  it('search_logs returns matching results through the transport', async () => {
    const client = await connect(new SidecarClient({ fetchImpl: makeFetch().fetchImpl }));
    const res = await client.callTool({
      name: 'search_logs',
      arguments: { filter: 'level:error' },
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('checkout failed: card declined');
    expect(res.isError).toBeFalsy();
  });

  it('returns a clean tool error (not a crash) when the sidecar is down', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const client = await connect(
      new SidecarClient({ baseUrl: 'http://localhost:6789', fetchImpl }),
    );
    const res = await client.callTool({
      name: 'list_recent_traces',
      arguments: {},
    });
    expect(res.isError).toBe(true);
    const text = (res.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toMatch(/Could not reach the NextDog sidecar/);
  });
});
