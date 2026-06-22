interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * DataLA MCP — Los Angeles open data (data.lacity.org, Socrata SODA API).
 *
 * Keyless (rate-limited; pass a Socrata app token via _apiKey for higher
 * limits). Sister to data-sf / data-cityofchicago / data-ny. Adds agent-friendly
 * NAMED shortcuts for the most-requested LA datasets, plus a generic SoQL
 * escape hatch and catalogue search.
 *
 * Tools:
 * - la_recent:   recent rows from a common LA dataset by friendly name
 * - la_query:    raw SoQL query against any data.lacity.org resource id
 * - la_datasets: search the LA open-data catalogue
 */


const BASE = 'https://data.lacity.org';
const UA = 'pipeworx-mcp-data-la/1.0 (+https://pipeworx.io)';

// Friendly name -> Socrata resource id + the date column to sort "recent" by.
const DATASETS: Record<string, { id: string; label: string; date: string }> = {
  crime: { id: '2nrs-mtv8', label: 'Crime Data from 2020 to Present', date: 'date_occ' },
  arrests: { id: 'amvf-fr72', label: 'Arrest Data from 2020 to Present', date: 'arst_date' },
  businesses: { id: '6rrh-rzua', label: 'Listing of Active Businesses', date: 'location_start_date' },
  permits: { id: 'xnhu-aczu', label: 'Building & Safety Permit Information', date: 'issue_date' },
  '311': { id: 'h73f-gn57', label: 'MyLA311 Service Request Data (2025; data is year-partitioned)', date: 'createddate' },
};

const API_KEY_PROP = {
  type: 'string' as const,
  description: 'Optional — your own Socrata app token for higher rate limits. Omit to use the keyless endpoint.',
};

const tools: McpToolExport['tools'] = [
  {
    name: 'la_recent',
    description:
      "Recent records from a common Los Angeles open dataset (data.lacity.org) by friendly name — no Socrata id needed. PREFER OVER WEB SEARCH for \"recent crime in Los Angeles / LA\", \"LAPD arrests\", \"LA building permits\", \"MyLA311 requests\", \"active businesses in LA\". Names: crime, arrests, businesses, permits, 311. Returns the latest rows (newest-first). Add a SoQL `where` to filter; for anything else use la_query. (Note: LA 311 is partitioned by year — the shortcut points at the latest year; use la_datasets for other years.)",
    inputSchema: {
      type: 'object' as const,
      properties: {
        dataset: { type: 'string', description: 'One of: crime, arrests, businesses, permits, 311.', enum: Object.keys(DATASETS) },
        where: { type: 'string', description: "Optional SoQL filter, e.g. \"crm_cd_desc='BURGLARY'\" or \"area_name='Hollywood'\". Omit for all recent rows." },
        limit: { type: 'number', description: 'Rows to return (1-1000, default 20).' },
        _apiKey: API_KEY_PROP,
      },
      required: ['dataset'],
    },
  },
  {
    name: 'la_query',
    description:
      'Run a raw SoQL query against any Los Angeles open-data resource (data.lacity.org) by its Socrata id (8-char like "2nrs-mtv8"). Full SoQL: where/select/group/order/limit/offset. Use la_datasets to find a resource id, or la_recent for the common ones.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        resource_id: { type: 'string', description: 'Socrata resource id, e.g. "2nrs-mtv8" (crime data).' },
        where: { type: 'string', description: 'SoQL $where filter (e.g. "area_name=\'Central\'").' },
        select: { type: 'string', description: 'SoQL $select (e.g. "crm_cd_desc, count(*)").' },
        group: { type: 'string', description: 'SoQL $group (e.g. "crm_cd_desc").' },
        order: { type: 'string', description: 'SoQL $order (e.g. "date_occ DESC").' },
        limit: { type: 'number', description: 'Max rows (default 100, max 5000).' },
        offset: { type: 'number', description: 'Row offset for paging.' },
        _apiKey: API_KEY_PROP,
      },
      required: ['resource_id'],
    },
  },
  {
    name: 'la_datasets',
    description:
      'Search the Los Angeles open-data catalogue (data.lacity.org) for datasets by keyword. Returns dataset names, descriptions, and Socrata resource ids to use with la_query.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Keyword(s), e.g. "parking", "budget", "tree".' },
        limit: { type: 'number', description: 'Max datasets (1-100, default 20).' },
        offset: { type: 'number', description: 'Offset for paging.' },
        _apiKey: API_KEY_PROP,
      },
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────

function headers(apiKey?: string): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'User-Agent': UA };
  if (apiKey) h['X-App-Token'] = apiKey;
  return h;
}

async function socrataGet(path: string, apiKey?: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: headers(apiKey) });
  if (res.status === 429) throw new Error('upstream_throttled: data.lacity.org rate limit (HTTP 429). Pass _apiKey (Socrata app token) for higher limits.');
  if (!res.ok) throw new Error(`data.lacity.org: ${res.status}`);
  return res.json();
}

// ── Tool implementations ─────────────────────────────────────────────

async function laRecent(dataset: string, where: string | undefined, limit: number | undefined, apiKey?: string) {
  const key = String(dataset ?? '').toLowerCase().trim();
  const ds = DATASETS[key];
  if (!ds) throw new Error(`Unknown dataset "${dataset}". Use one of: ${Object.keys(DATASETS).join(', ')}.`);
  const n = Math.min(1000, Math.max(1, Number(limit) || 20));
  const p = new URLSearchParams();
  // Guard against NULL sort-column values sorting to the top under DESC (Socrata
  // puts NULLs first), which would surface stale rows instead of the most recent.
  const notNull = `${ds.date} IS NOT NULL`;
  p.set('$where', where && String(where).trim() ? `(${String(where).trim()}) AND ${notNull}` : notNull);
  p.set('$order', `${ds.date} DESC`);
  p.set('$limit', String(n));
  const rows = (await socrataGet(`/resource/${ds.id}.json?${p}`, apiKey)) as unknown[];
  return {
    dataset: key,
    label: ds.label,
    resource_id: ds.id,
    sorted_by: `${ds.date} DESC`,
    count: Array.isArray(rows) ? rows.length : 0,
    source: 'DataLA (data.lacity.org)',
    rows,
  };
}

async function laQuery(args: Record<string, unknown>, apiKey?: string) {
  const id = String(args.resource_id ?? '').trim();
  if (!id) throw new Error('Required argument "resource_id" is missing (e.g. "2nrs-mtv8"). Find one with la_datasets.');
  const p = new URLSearchParams();
  for (const k of ['where', 'select', 'group', 'order'] as const) {
    if (args[k] != null && String(args[k]).trim()) p.set(`$${k}`, String(args[k]).trim());
  }
  p.set('$limit', String(Math.min(5000, Math.max(1, Number(args.limit) || 100))));
  if (args.offset != null) p.set('$offset', String(Math.max(0, Number(args.offset))));
  const rows = (await socrataGet(`/resource/${encodeURIComponent(id)}.json?${p}`, apiKey)) as unknown[];
  return { resource_id: id, count: Array.isArray(rows) ? rows.length : 0, source: 'DataLA (data.lacity.org)', rows };
}

async function laDatasets(query: string | undefined, limit: number | undefined, offset: number | undefined, apiKey?: string) {
  const p = new URLSearchParams({
    domains: 'data.lacity.org',
    search_context: 'data.lacity.org',
    limit: String(Math.min(100, Math.max(1, Number(limit) || 20))),
    offset: String(Math.max(0, Number(offset) || 0)),
  });
  if (query && String(query).trim()) p.set('q', String(query).trim());
  const res = await fetch(`https://api.us.socrata.com/api/catalog/v1?${p}`, { headers: headers(apiKey) });
  if (!res.ok) throw new Error(`Socrata catalog: ${res.status}`);
  const data = (await res.json()) as { results?: Array<{ resource?: { id?: string; name?: string; description?: string; type?: string; updatedAt?: string } }> };
  return {
    query: query ?? null,
    count: data.results?.length ?? 0,
    datasets: (data.results ?? []).map((r) => ({
      resource_id: r.resource?.id ?? null,
      name: r.resource?.name ?? null,
      description: (r.resource?.description ?? '').slice(0, 300) || null,
      type: r.resource?.type ?? null,
      updated_at: r.resource?.updatedAt ?? null,
    })),
  };
}

// ── Router ───────────────────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = typeof args._apiKey === 'string' && args._apiKey.trim() ? args._apiKey.trim() : undefined;
  delete args._apiKey;
  switch (name) {
    case 'la_recent':
      return laRecent(args.dataset as string, args.where as string | undefined, args.limit as number | undefined, apiKey);
    case 'la_query':
      return laQuery(args, apiKey);
    case 'la_datasets':
      return laDatasets(args.query as string | undefined, args.limit as number | undefined, args.offset as number | undefined, apiKey);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
