import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "MCP Release — Check an MCP server before release.";

export default function OgImage() {
  const logoData = readFileSync(
    join(process.cwd(), "public", "brand", "mcp-release-logo-light-text.png"),
  );
  const logoSrc = `data:image/png;base64,${logoData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 1200,
          height: 630,
          background: "#0b0c0f",
        }}
      >
        {/* Top accent bar */}
        <div
          style={{
            display: "flex",
            width: "100%",
            height: 3,
            background: "#4a7cf6",
          }}
        />

        {/* Content area */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            paddingLeft: 80,
            paddingRight: 80,
            paddingBottom: 24,
          }}
        >
          {/* Logo — original 571 × 227, displayed at 320 × 127.
              Satori does not support CSS background-image with data URIs;
              <img> with objectFit is the correct approach. The no-img-element
              ESLint rule is disabled for this file in eslint.config.mjs. */}
          <img
            src={logoSrc}
            width={320}
            height={127}
            alt="MCP Release"
            style={{ objectFit: "contain" }}
          />

          {/* Headline */}
          <div
            style={{
              display: "flex",
              marginTop: 40,
              color: "#dde3ec",
              fontSize: 54,
              fontWeight: 700,
              lineHeight: 1.2,
              textAlign: "center",
            }}
          >
            Check an MCP server before release.
          </div>

          {/* Supporting text */}
          <div
            style={{
              display: "flex",
              marginTop: 20,
              color: "#7a8499",
              fontSize: 26,
              lineHeight: 1.5,
              textAlign: "center",
            }}
          >
            Validate handshake, tools, schemas, and network behavior.
          </div>

          {/* Domain */}
          <div
            style={{
              display: "flex",
              marginTop: 40,
              color: "#4a7cf6",
              fontSize: 22,
              letterSpacing: "1px",
            }}
          >
            mcprelease.dev
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
