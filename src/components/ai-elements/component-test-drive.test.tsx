// Unit tests for the ComponentTestDrive pure guards (component-test-drive.tsx).
// The message pipeline can't be simulated end-to-end with react-test-renderer
// (WindowProxy identity is not constructible), so the frame check, height
// clamp, and error formatting are exported pure functions and tested here.
import { describe, expect, it } from "vitest";
import {
	clampHarnessHeight,
	harnessErrorLine,
	isHarnessFrameEvent,
} from "./component-test-drive";

describe("isHarnessFrameEvent", () => {
	it("accepts only events whose source is the preview frame", () => {
		const frame = { contentWindow: { postMessage: () => {} } } as unknown as {
			contentWindow: Window;
		};
		const foreign = { contentWindow: { postMessage: () => {} } } as unknown as {
			contentWindow: Window;
		};
		const event = { source: frame.contentWindow } as MessageEvent;
		expect(isHarnessFrameEvent(event, frame?.contentWindow)).toBe(true);
		// A sibling/other window claiming to be the harness is rejected —
		// the sandboxed preview has an opaque origin, so identity is the
		// only trustworthy signal.
		expect(isHarnessFrameEvent(event, foreign?.contentWindow)).toBe(false);
	});

	it("rejects everything while the frame is not mounted", () => {
		const event = { source: {} } as unknown as MessageEvent;
		expect(isHarnessFrameEvent(event, null)).toBe(false);
		expect(isHarnessFrameEvent(event, undefined)).toBe(false);
	});
});

describe("clampHarnessHeight", () => {
	it("clamps into bounds and pads for body margins", () => {
		expect(clampHarnessHeight(92)).toBe(240); // below MIN → clamped up
		expect(clampHarnessHeight(400)).toBe(432); // in range → padded +32
		expect(clampHarnessHeight(0)).toBe(240); // MIN_HEIGHT
		expect(clampHarnessHeight(5000)).toBe(720); // MAX_HEIGHT
	});

	it("falls back to the default for non-finite heights", () => {
		expect(clampHarnessHeight(Number.NaN)).toBe(320);
		expect(clampHarnessHeight(Number.POSITIVE_INFINITY)).toBe(320);
	});
});

describe("harnessErrorLine", () => {
	it("formats console and runtime kinds differently", () => {
		expect(harnessErrorLine({ kind: "console", message: "boom" })).toBe(
			"console.error: boom",
		);
		expect(harnessErrorLine({ kind: "error", message: "boom" })).toBe(
			"Runtime error: boom",
		);
		expect(harnessErrorLine({ message: "boom" })).toBe("Runtime error: boom");
	});

	it("returns null for entries without a usable message", () => {
		expect(harnessErrorLine({})).toBeNull();
		expect(harnessErrorLine(undefined)).toBeNull();
	});
});
