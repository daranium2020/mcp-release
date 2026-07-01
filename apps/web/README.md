# @mcp-release/web

Next.js 15 (App Router) web interface for MCP Release. Live at [https://mcprelease.dev](https://mcprelease.dev).

## Application structure

```
apps/web/src/
├── app/
│   ├── layout.tsx              HTML shell, global metadata, Open Graph tags
│   ├── page.tsx                Landing page and validation form
│   ├── globals.css             Design tokens, reset, base styles
│   ├── docs/page.tsx           Documentation page (/docs)
│   ├── robots.ts               /robots.txt
│   ├── sitemap.ts              /sitemap.xml
│   ├── opengraph-image.tsx     /opengraph-image (1200×630 PNG via next/og)
│   ├── twitter-image.tsx       /twitter-image
│   └── api/check/
│       ├── handler.ts          Request handler (injectable deps, testable)
│       └── route.ts            Next.js route entry (POST /api/check)
├── components/
│   ├── Header.tsx              Sticky header — wordmark, Docs link, Feedback link
│   ├── Footer.tsx              Site footer
│   ├── CheckClient.tsx         Client component — form, loading, error states
│   └── Results.tsx             Report display — status, findings, tools, exports
└── lib/
    ├── constants.ts            Site URL, demo endpoint, timeout bounds
    ├── rate-limit.ts           Sliding-window IP rate limiter (in-memory)
    └── concurrency.ts          Concurrency guard (in-memory)
```

## Routes

| Route | Description |
|---|---|
| `/` | Homepage — validation form and results |
| `/docs` | Documentation page |
| `/api/check` | `POST` — runs validation and returns a report |
| `/robots.txt` | Crawl rules (allows `/`, disallows `/api/`) |
| `/sitemap.xml` | Sitemap (homepage and `/docs`) |
| `/opengraph-image` | OG preview image |
| `/twitter-image` | Twitter card image |

## API contract

### `POST /api/check`

**Request**

```json
{
  "endpoint": "https://your-mcp-server.example.com/mcp",
  "timeoutMs": 10000
}
```

| Field | Type | Required | Constraints |
|---|---|---|---|
| `endpoint` | string | yes | HTTPS URL, no embedded credentials |
| `timeoutMs` | number | no | 1000–30000 (default 10000) |

Unexpected fields are rejected.

**Success response (200)**

```json
{ "report": { /* CheckReport — see packages/core */ } }
```

**Error response**

```json
{ "error": "ERROR_CODE", "message": "Human-readable description" }
```

| Status | Error code | Cause |
|---|---|---|
| 400 | `INVALID_JSON` | Malformed JSON body |
| 400 | `INVALID_BODY` | Body is not a JSON object |
| 400 | `MISSING_ENDPOINT` | `endpoint` field missing or empty |
| 400 | `UNEXPECTED_FIELD` | Unknown field in request |
| 400 | `INVALID_URL` | `endpoint` is not a parseable URL |
| 400 | `EMBEDDED_CREDENTIALS` | URL contains `user:pass@` |
| 400 | `HTTPS_REQUIRED` | `endpoint` uses HTTP |
| 400 | `INVALID_TIMEOUT` | `timeoutMs` out of range or non-numeric |
| 413 | `BODY_TOO_LARGE` | Body exceeds 4 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Content-Type is not `application/json` |
| 429 | `RATE_LIMIT_EXCEEDED` | IP rate limit exceeded |
| 429 | `CONCURRENCY_LIMIT_EXCEEDED` | Server is handling too many checks |
| 500 | `VALIDATOR_ERROR` | Unexpected error from the core validator |

**Security headers (all responses)**

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Cache-Control: no-store
```

No CORS headers — the API is same-origin only.

## Abuse controls (in-memory)

- **Rate limit:** 10 requests per IP per minute (sliding window)
- **Concurrency:** max 5 simultaneous outbound checks

Both are per-process. See the Known Limitations section in the documentation page.

## Deployment

Pushes to `main` deploy automatically to Vercel (`mcprelease.dev`). The build command in `vercel.json` builds `packages/core` and `packages/reporter` before `apps/web`:

```
pnpm --filter @mcp-release/core build && pnpm --filter @mcp-release/reporter build && pnpm --filter @mcp-release/web build
```

No environment variables are required. All configuration is in `src/lib/constants.ts`.

## Local development

```bash
# From the workspace root
pnpm install
pnpm build                                 # build all packages first
pnpm --filter @mcp-release/web dev         # start dev server on http://localhost:3000
```

The development server shows fixture buttons (PASS / WARNING / FAIL) that load sample reports without network requests. These are removed in production builds.

## Tests

Tests run from the workspace root:

```bash
pnpm test                                  # all tests
pnpm test -- apps/web/tests/api/           # API handler tests (node environment)
pnpm test -- apps/web/tests/ui/            # UI tests (jsdom environment)
```

API tests inject a mock validator and fresh rate limiter/concurrency guard — no network required. UI tests render components in jsdom with `window.fetch` stubbed.

## Feedback

[feedback@mcprelease.dev](mailto:feedback@mcprelease.dev)
