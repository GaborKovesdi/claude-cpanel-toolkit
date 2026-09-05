#!/usr/bin/env node
/**
 * cpanel-mcp - MCP stdio server exposing the tool registry in src/tools.mjs.
 *
 * Nothing is written to stdout except MCP protocol frames; diagnostics go to stderr.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, TOOL_BY_NAME, checkArgs } from "./tools.mjs";
import { redact, loadDotEnv } from "./config.mjs";

loadDotEnv();

const server = new Server(
  { name: "cpanel", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      readOnlyHint: !t.destructive,
      destructiveHint: !!t.destructive,
    },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const tool = TOOL_BY_NAME[name];
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool "${name}". Available: ${Object.keys(TOOL_BY_NAME).join(", ")}` }],
    };
  }
  try {
    checkArgs(tool, args ?? {});
    const result = await tool.handler(args ?? {});
    return { content: [{ type: "text", text: redact(JSON.stringify(result, null, 2)) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: redact(err?.message ?? String(err)) }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`cpanel-mcp ready (${TOOLS.length} tools)\n`);
