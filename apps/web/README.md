# @mcp-launch/web

Next.js 15 (App Router) web interface for MCP Launch release validation.

> **Status**: Milestone 3 local MVP. Not yet publicly deployed. No authentication, billing, or persistent storage.

## Architecture

```
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx              HTML shell, global metadata
│   │   ├── page.tsx                Landing page (server component)
│   │   ├── globals.css             Design tokens, reset, base styles
│   │   └── api/check/
│   │       ├── handler.ts          Core request handler (injectable deps, testable)
│   │       └── route.ts            Next.js route entry (POST /api/check)
│   ├── components/
│   │   ├── Header.tsx              Sticky header — wordmark, GitHub link
│   │   ├── Footer.tsx              Site footer
│   │   ├── CheckClient.tsx         Client component — form, loading, error states
│   │   └── Results.tsx             Report display — status, findings, tools, exports
│   ├── lib/
│   │   ├── constants.ts            Public configuration (site name, GitHub URL, timeouts)
│   │   ├── rate-limit.ts           Sliding-window IP rate limiter (in-memory)
│   │   └── concurrency.ts          Concurrency guard (in-memory)
│   └── types/
│       └── api.ts                  Request/response type definitions
└── tests/
    ├── api/check.test.ts           19 API handler tests (node environment)
    └── ui/CheckClient.test.tsx     22 UI component tests (jsdom environment)
```

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
| `endpoint` | string | yes | Valid HTTPS URL, no embedded credentials |
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

## Environment expectations

No environment variables are required to run the web app. All configuration lives in `src/lib/constants.ts` and is safe for browser exposure.

When running in production:
- All endpoint URLs are validated as HTTPS before any network request
- Rate limiting uses `x-forwarded-for` as the IP key (not verified without a trusted proxy — see limitations)
- No secrets, tokens, or external service credentials are needed

To set the GitHub repository link, update `GITHUB_URL` in `src/lib/constants.ts`.

## Local development

```bash
# from the workspace root
pnpm install
pnpm build                    # build core and reporter first
cd apps/web
pnpm dev                      # start dev server on http://localhost:3000
```

Or from the workspace root:

```bash
pnpm install && pnpm -r run build --filter @mcp-launch/core --filter @mcp-launch/reporter
cd apps/web && pnpm dev
```

## Running tests

Tests run from the workspace root with vitest:

```bash
pnpm test                               # all tests
pnpm test -- apps/web/tests/api/        # API tests only (node environment)
pnpm test -- apps/web/tests/ui/         # UI tests only (jsdom environment)
```

API tests (`check.test.ts`): inject a mock validator function, fresh rate limiter, and fresh concurrency guard — no network required, no module state shared between tests.

UI tests (`CheckClient.test.tsx`): render components in jsdom, stub `window.fetch` — no network required.

## Production prerequisites

Before public deployment the following must be addressed:

1. **Proxy-verified IP for rate limiting**: `x-forwarded-for` is currently read without verification. Use a trusted proxy header or the verified source IP from your deployment platform.

2. **Shared rate limiting**: Replace `src/lib/rate-limit.ts` singleton with a shared store (Redis, Upstash, etc.) before running multiple app instances.

3. **Shared concurrency guard**: Replace `src/lib/concurrency.ts` singleton similarly.

4. **Content Security Policy**: Add a strict `Content-Security-Policy` header in `next.config.ts` matching the production asset origins.

5. **Monitoring and alerting**: Add request duration metrics and error rate alerts for the `/api/check` route.

MCP tools are **never invoked** — only `initialize` and `tools/list` are called.
