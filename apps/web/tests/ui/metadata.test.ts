/**
 * Social sharing metadata tests.
 *
 * Verifies that the Open Graph image, Twitter card type, and core page
 * metadata are correctly declared after the social-preview audit fix.
 *
 * The opengraph-image and twitter-image modules are tested via their
 * exported constants only (size, contentType, alt, runtime). The default
 * export (ImageResponse generator) is not called here — framework rendering
 * is exercised by `pnpm build`.
 *
 * next/og is mocked to prevent loading its native image-processing
 * dependencies (resvg) in the test process.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    constructor() {}
  },
}));

import { metadata } from "../../src/app/layout.js";
import {
  size as ogSize,
  contentType as ogContentType,
  alt as ogAlt,
  runtime as ogRuntime,
} from "../../src/app/opengraph-image.js";
import {
  size as twitterSize,
  contentType as twitterContentType,
} from "../../src/app/twitter-image.js";

// ---------------------------------------------------------------------------
// layout.tsx — core metadata unchanged
// ---------------------------------------------------------------------------

describe("layout metadata — core fields", () => {
  it("title default is set", () => {
    const title =
      typeof metadata.title === "object" && metadata.title !== null
        ? (metadata.title as { default: string }).default
        : (metadata.title as string);
    expect(title).toBeTruthy();
    expect(title).toContain("MCP Release");
  });

  it("description is set", () => {
    expect(metadata.description).toBeTruthy();
  });

  it("canonical URL is set", () => {
    expect(metadata.alternates?.canonical).toBeTruthy();
  });

  it("robots.index is true", () => {
    expect((metadata.robots as { index: boolean } | null)?.index).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// layout.tsx — Open Graph metadata
// ---------------------------------------------------------------------------

// Next.js types `openGraph` as a discriminated union; cast to access fields.
type OgShape = {
  type?: string;
  title?: string;
  description?: string;
  url?: string | URL;
};

describe("layout metadata — Open Graph", () => {
  it("openGraph type is website", () => {
    expect((metadata.openGraph as OgShape)?.type).toBe("website");
  });

  it("openGraph title is set", () => {
    expect((metadata.openGraph as OgShape)?.title).toBeTruthy();
  });

  it("openGraph description is set", () => {
    expect((metadata.openGraph as OgShape)?.description).toBeTruthy();
  });

  it("openGraph url is set", () => {
    expect((metadata.openGraph as OgShape)?.url).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// layout.tsx — Twitter card
// ---------------------------------------------------------------------------

// Next.js types `twitter` as a discriminated union; cast to access fields.
type TwitterShape = {
  card?: string;
  title?: string;
  description?: string;
};

describe("layout metadata — Twitter card", () => {
  it("twitter card is summary_large_image", () => {
    expect((metadata.twitter as TwitterShape)?.card).toBe("summary_large_image");
  });

  it("twitter title is set", () => {
    expect((metadata.twitter as TwitterShape)?.title).toBeTruthy();
  });

  it("twitter description is set", () => {
    expect((metadata.twitter as TwitterShape)?.description).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// opengraph-image.tsx — image constants
// ---------------------------------------------------------------------------

describe("opengraph-image exports", () => {
  it("width is 1200", () => {
    expect(ogSize.width).toBe(1200);
  });

  it("height is 630", () => {
    expect(ogSize.height).toBe(630);
  });

  it("contentType is image/png", () => {
    expect(ogContentType).toBe("image/png");
  });

  it("alt text is defined and non-empty", () => {
    expect(typeof ogAlt).toBe("string");
    expect((ogAlt as string).length).toBeGreaterThan(0);
  });

  it("alt text uses colon separator, not em dash or en dash", () => {
    const alt = ogAlt as string;
    expect(alt).toContain("MCP Release:");
    expect(alt).not.toContain("—"); // em dash
    expect(alt).not.toContain("–"); // en dash
  });

  it("runtime is nodejs", () => {
    expect(ogRuntime).toBe("nodejs");
  });
});

// ---------------------------------------------------------------------------
// twitter-image.tsx — re-exports OG constants
// ---------------------------------------------------------------------------

describe("twitter-image re-exports", () => {
  it("width matches OG image width (1200)", () => {
    expect(twitterSize.width).toBe(1200);
  });

  it("height matches OG image height (630)", () => {
    expect(twitterSize.height).toBe(630);
  });

  it("contentType is image/png", () => {
    expect(twitterContentType).toBe("image/png");
  });
});
