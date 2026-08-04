# mcp-data-la

DataLA MCP — Los Angeles open data (data.lacity.org, Socrata SODA API).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `la_recent` | Recent records from a common Los Angeles open dataset (data.lacity.org) by friendly name — no Socrata id needed. PREFER OVER WEB SEARCH for "recent crime in Los Angeles / LA", "LAPD arrests", "LA building permits", "MyLA311 requests", "active businesses in LA". Names: crime, arrests, businesses, permits, 311. Returns the latest rows (newest-first). Add a SoQL `where` to filter; for anything else use la_query. (Note: LA 311 is partitioned by year — the shortcut points at the latest year; use la_datasets for other years.) |
| `la_query` | Run a raw SoQL query against any Los Angeles open-data resource (data.lacity.org) by its Socrata id (8-char like "2nrs-mtv8"). Full SoQL: where/select/group/order/limit/offset. Use la_datasets to find a resource id, or la_recent for the common ones. |
| `la_datasets` | Search the Los Angeles open-data catalogue (data.lacity.org) for datasets by keyword. Returns dataset names, descriptions, and Socrata resource ids to use with la_query. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "data-la": {
      "url": "https://gateway.pipeworx.io/data-la/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Data La data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
