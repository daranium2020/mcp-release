/**
 * OG image render tests.
 *
 * Verifies that opengraph-image.tsx uses an <img> element (not CSS
 * background-image) and that the element carries the correct src, dimensions,
 * and objectFit style that Satori needs to render the logo without clipping.
 *
 * Strategy:
 *  - next/og is mocked so ImageResponse captures the JSX tree without loading
 *    Satori's native binaries.
 *  - node:fs is mocked so readFileSync returns deterministic fake logo bytes,
 *    letting us verify the data URI prefix in the rendered src.
 *  - The captured React element tree is JSON-serialised for assertions; Symbols
 *    ($$typeof) are silently dropped by JSON.stringify, so type/props survive.
 *  - The "logo file exists on disk" assertion uses vi.importActual to bypass
 *    the mocked fs and read the real filesystem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Shared capture store — must be created with vi.hoisted so it's available
// inside the vi.mock factory (which is hoisted before imports).
// ---------------------------------------------------------------------------
const store = vi.hoisted(() => ({ capturedJsx: null as unknown }));

vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(jsx: unknown) {
      store.capturedJsx = jsx;
    }
  },
}));

vi.mock("node:fs", () => ({
  // Return a deterministic buffer so we can verify the data URI prefix.
  readFileSync: () => Buffer.from("fake-logo-data"),
}));

import OgImage from "../../src/app/opengraph-image.js";

// ---------------------------------------------------------------------------
// Helper — serialise the captured React element tree
// ---------------------------------------------------------------------------
function capturedJson(): string {
  return JSON.stringify(store.capturedJsx) ?? "";
}

// ---------------------------------------------------------------------------
// 1. Approved logo file exists on disk
// ---------------------------------------------------------------------------

describe("approved logo asset", () => {
  it("file exists at apps/web/public/brand/mcp-release-logo-light-text.png", async () => {
    const { existsSync } =
      await vi.importActual<typeof import("node:fs")>("node:fs");
    const logoPath = join(
      process.cwd(),
      "apps",
      "web",
      "public",
      "brand",
      "mcp-release-logo-light-text.png",
    );
    expect(existsSync(logoPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. OgImage render — <img> element (not backgroundImage)
// ---------------------------------------------------------------------------

describe("OgImage render — img element", () => {
  beforeEach(() => {
    store.capturedJsx = null;
    OgImage();
  });

  it("uses <img> — type is 'img' in the JSX tree", () => {
    expect(capturedJson()).toContain('"img"');
  });

  it("does NOT use CSS backgroundImage (broken Satori path)", () => {
    expect(capturedJson()).not.toContain('"backgroundImage"');
  });

  it("logo src is a PNG data URI from the approved asset", () => {
    // readFileSync is mocked to return Buffer.from('fake-logo-data'),
    // which base64-encodes to 'ZmFrZS1sb2dvLWRhdGE='.
    expect(capturedJson()).toContain('"data:image/png;base64,ZmFrZS1sb2dvLWRhdGE="');
  });
});

// ---------------------------------------------------------------------------
// 3. OgImage render — explicit dimensions and objectFit
// ---------------------------------------------------------------------------

describe("OgImage render — dimensions and objectFit", () => {
  beforeEach(() => {
    store.capturedJsx = null;
    OgImage();
  });

  it("img has explicit width of 320", () => {
    expect(capturedJson()).toContain('"width":320');
  });

  it("img has explicit height of 127", () => {
    // 571 × 227 original; at 320 px wide: 320 × (227/571) ≈ 127
    expect(capturedJson()).toContain('"height":127');
  });

  it("img style has objectFit property", () => {
    expect(capturedJson()).toContain('"objectFit"');
  });

  it("objectFit value is contain", () => {
    expect(capturedJson()).toContain('"contain"');
  });
});
