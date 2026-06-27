export const runtime = "nodejs";

import { handleHealthRequest } from "../../mcp-handler";

export function GET(req: Request): Response {
  return handleHealthRequest(req);
}
