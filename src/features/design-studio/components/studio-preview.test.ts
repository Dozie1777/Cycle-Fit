import { describe, expect, it } from "vitest";
import { designRevision, selectableDesignPreviewUrl } from "./studio-preview";

const files = [
	{ path: "index.html", lastModified: "same-timestamp" },
	{ path: "versions/1/index.html", lastModified: "same-timestamp" },
	{ path: "versions/2/index.html", lastModified: "same-timestamp" },
	{ path: "versions/3/index.html", lastModified: "same-timestamp" },
];

describe("designRevision", () => {
	it("changes when a restore appends a version even if timestamps collide", () => {
		expect(designRevision({ files: files.slice(0, 3) } as never)).toBe(
			"2:same-timestamp",
		);
		expect(designRevision({ files } as never)).toBe("3:same-timestamp");
	});

	it("falls back to the live file timestamp for unversioned updates", () => {
		expect(designRevision({ files: files.slice(0, 1) } as never)).toBe(
			"same-timestamp",
		);
	});

	it("changes iframe revision and URL for upload-only edits under a pointer", () => {
		const detail = {
			liveTurnId: "turn-1",
			files: [
				{ path: "index.html", lastModified: "legacy-timestamp" },
				{ path: "versions/4/index.html", lastModified: "version-timestamp" },
				{ path: "turns/turn-1/index.html", lastModified: "upload-1" },
			],
		};
		const edited = {
			...detail,
			files: detail.files.map((file) =>
				file.path === "turns/turn-1/index.html"
					? { ...file, lastModified: "upload-2" }
					: file,
			),
		};
		const before = designRevision(detail as never);
		const after = designRevision(edited as never);
		expect(before).toBe("4:turn-1:upload-1");
		expect(after).toBe("4:turn-1:upload-2");
		expect(after).not.toBe(before);
		expect(selectableDesignPreviewUrl("project-id", after)).not.toBe(
			selectableDesignPreviewUrl("project-id", before),
		);
	});
});

describe("selectableDesignPreviewUrl", () => {
	it("gives v2 and v3 different selectable URLs when timestamps collide", () => {
		const v2 = selectableDesignPreviewUrl("project-id", "2:same-timestamp");
		const v3 = selectableDesignPreviewUrl("project-id", "3:same-timestamp");
		expect(v2).not.toBe(v3);
		expect(v2).toBe(
			"/designs/project-id/site?selectable=1&revision=2%3Asame-timestamp",
		);
		expect(v3).toBe(
			"/designs/project-id/site?selectable=1&revision=3%3Asame-timestamp",
		);
	});
});
