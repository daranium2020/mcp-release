import { z } from "zod";
import { startMcpFixture, type FixtureServer } from "./helpers.js";

export async function startValidServer(): Promise<FixtureServer> {
  return startMcpFixture((server) => {
    server.tool(
      "get_weather",
      "Get the current weather for a location",
      {
        location: z.string().describe("City name or coordinates"),
        units: z.enum(["celsius", "fahrenheit"]).optional().describe("Temperature units"),
      },
      async ({ location, units }) => {
        void location;
        void units;
        return { content: [{ type: "text", text: "sunny" }] };
      },
    );

    server.tool(
      "search_web",
      "Search the web for information",
      {
        query: z.string().describe("The search query"),
        limit: z.number().int().min(1).max(20).optional().describe("Maximum results"),
      },
      async ({ query, limit }) => {
        void query;
        void limit;
        return { content: [{ type: "text", text: "results" }] };
      },
    );
  });
}
