// Unit tests for the component lifecycle state machine (KUK-921). A prisma
// stub covers the reads/writes each operation performs (see design-tokens
// makePrismaStub style): the client type is derived from the functions'
// parameters and the stub is cast — no runtime mock needed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publicationPageSegment } from "@/features/design-studio/publish/publication-segment";
import {
	assertComponentVersionDeletable,
	publishComponentVersion,
	restoreComponentVersion,
	retirePublishedVersion,
} from "./component-publish";

type PrismaDb = Parameters<typeof publishComponentVersion>[0];

const publishedJs =
	'class TbHero extends HTMLElement { connectedCallback() { if (this.hasAttribute("data-ssr")) return; } }\ncustomElements.define("tb-hero", TbHero);';

function componentRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "comp-1",
		projectId: "proj-1",
		name: "Hero",
		kind: "section",
		tagName: "tb-hero",
		publishedVersionId: null as string | null,
		createdTurnId: null,
		deletedAt: null,
		...overrides,
	};
}

function versionRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "v-2",
		componentId: "comp-1",
		version: 2,
		status: "draft",
		js: publishedJs,
		html: "<p>hi</p>",
		css: "p { color: red }",
		shadowMode: "light",
		apiSchema: null,
		defaults: null,
		previewR2Key: null,
		changeNote: null,
		createdTurnId: null,
		component: componentRow(),
		...overrides,
	};
}

type R2Write = {
	key: string;
	value: string;
	contentType?: string;
	cacheControl?: string;
};

function makeEnv() {
	const writes: R2Write[] = [];
	return {
		writes,
		DESIGNS: {
			put: vi.fn(
				async (
					key: string,
					value: string,
					options?: {
						httpMetadata?: { contentType?: string; cacheControl?: string };
					},
				) => {
					writes.push({
						key,
						value,
						contentType: options?.httpMetadata?.contentType,
						cacheControl: options?.httpMetadata?.cacheControl,
					});
				},
			),
		},
	} as unknown as Parameters<typeof publishComponentVersion>[1] & {
		writes: R2Write[];
	};
}

/**
 * The stub: every method the operations touch is a vi.fn whose return value
 * comes from a mutable `state` bag so each test seeds its own scenario.
 * $transaction runs the callback against the stub itself (single-node D1
 * serializes transactions).
 */
function makePrismaStub(
	state: {
		component?: Record<string, unknown> | null;
		version?: Record<string, unknown> | null;
		latestVersion?: number | null;
		turnLease?: { id: string } | null;
		pinnedByBlock?: { id: string } | null;
		createdVersion?: Record<string, unknown>;
		/** Overrides for the conditional-update guards (default: all pass). */
		fenceCount?: number;
		flipCount?: number;
	} = {},
) {
	const stub = {
		component: {
			findUnique: vi.fn(async () => state.component ?? null),
			// The publish/retire race fence: a conditional UPDATE on the
			// current pointer value.
			updateMany: vi.fn(
				async (_args: {
					where: { id: string; publishedVersionId?: string | null };
				}) => ({ count: state.fenceCount ?? 1 }),
			),
		},
		componentVersion: {
			findUnique: vi.fn(async () => state.version ?? null),
			findFirst: vi.fn(async () =>
				state.latestVersion ? { version: state.latestVersion } : null,
			),
			create: vi.fn(async (args: { data: Record<string, unknown> }) => {
				state.createdVersion = args.data;
				// The created draft becomes the row findUnique resolves — the
				// publish flow reloads it by id, like the real client would.
				state.version = {
					id: "v-new",
					componentId: "comp-1",
					component: state.component,
					...args.data,
				};
				return state.version;
			}),
			update: vi.fn(async () => ({})),
			updateMany: vi.fn(
				async (args: { where: { id: string; status: string } }) => {
					if (state.flipCount !== undefined) return { count: state.flipCount };
					const version = state.version;
					if (!version) return { count: 0 };
					if (
						version.id !== args.where.id ||
						version.status !== args.where.status
					) {
						return { count: 0 };
					}
					return { count: 1 };
				},
			),
		},
		design: {
			findFirst: vi.fn(async () => state.turnLease ?? null),
		},
		pageBlock: {
			findFirst: vi.fn(async () => state.pinnedByBlock ?? null),
		},
		templateSlot: {
			findFirst: vi.fn(async () => null),
		},
		publication: {
			findFirst: vi.fn(async () => null),
		},
	};
	return stub;
}

describe("publishComponentVersion", () => {
	let prisma: ReturnType<typeof makePrismaStub>;
	let env: ReturnType<typeof makeEnv>;
	const draft = () =>
		versionRow({
			component: componentRow({ publishedVersionId: "v-1" }),
		});

	beforeEach(() => {
		prisma = makePrismaStub({
			component: componentRow({ publishedVersionId: "v-1" }),
			version: draft(),
		});
		env = makeEnv();
	});

	it("publishes a draft: flips the pointer, retires the old published version", async () => {
		const result = await publishComponentVersion(
			prisma as unknown as PrismaDb,
			env,
			{
				componentId: "comp-1",
				versionId: "v-2",
			},
		);
		expect(result).toEqual({
			componentId: "comp-1",
			versionId: "v-2",
			version: 2,
			retiredVersionId: "v-1",
		});
		// The pointer fence is a conditional UPDATE on the current pointer
		// value; the old row retires and the draft flips through status guards.
		expect(prisma.component.updateMany).toHaveBeenCalledWith({
			where: { id: "comp-1", publishedVersionId: "v-1" },
			data: { publishedVersionId: "v-2" },
		});
		expect(prisma.componentVersion.updateMany).toHaveBeenCalledWith({
			where: { id: "v-1", status: "published" },
			data: { status: "retired" },
		});
		expect(prisma.componentVersion.updateMany).toHaveBeenCalledWith({
			where: { id: "v-2", status: "draft" },
			data: { status: "published" },
		});
	});

	it("writes immutable R2 bundles with content types + cache headers", async () => {
		await publishComponentVersion(prisma as unknown as PrismaDb, env, {
			componentId: "comp-1",
			versionId: "v-2",
		});
		expect(env.writes).toEqual([
			{
				key: "components/comp-1/v2.js",
				value: publishedJs,
				contentType: "text/javascript",
				cacheControl: "public, max-age=31536000, immutable",
			},
			{
				key: "components/comp-1/v2.css",
				value: "p { color: red }",
				contentType: "text/css",
				cacheControl: "public, max-age=31536000, immutable",
			},
		]);
	});

	it("skips the css bundle when the version has no css", async () => {
		prisma.componentVersion.findUnique.mockResolvedValue(
			versionRow({
				css: null,
				component: componentRow({ publishedVersionId: "v-1" }),
			}),
		);
		await publishComponentVersion(prisma as unknown as PrismaDb, env, {
			componentId: "comp-1",
			versionId: "v-2",
		});
		expect(env.writes.map((write) => write.key)).toEqual([
			"components/comp-1/v2.js",
		]);
	});

	it("rejects a draft that fails validation before any write", async () => {
		prisma.componentVersion.findUnique.mockResolvedValue(
			versionRow({
				js: "const x = 1;", // no class/define — invalid
				component: componentRow({ publishedVersionId: "v-1" }),
			}),
		);
		await expect(
			publishComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-2",
			}),
		).rejects.toMatchObject({
			name: "ComponentPublishError",
			status: 400,
			message: expect.stringContaining("component draft rejected"),
		});
		// Nothing was written: no status flips, no pointer move, no R2 bundles.
		expect(prisma.componentVersion.updateMany).not.toHaveBeenCalled();
		expect(prisma.componentVersion.update).not.toHaveBeenCalled();
		expect(prisma.component.updateMany).not.toHaveBeenCalled();
		expect(env.writes).toEqual([]);
	});

	it("refuses to publish a non-draft version", async () => {
		prisma.componentVersion.findUnique.mockResolvedValue(
			versionRow({ status: "published" }),
		);
		await expect(
			publishComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-2",
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "component version v2 is published, not draft",
		});
		expect(prisma.componentVersion.updateMany).not.toHaveBeenCalled();
	});

	it("fails the race fence when another publish moved the pointer", async () => {
		// The conditional pointer UPDATE returns count 0 when the pointer no
		// longer matches what was read (another publish moved it).
		prisma.component.updateMany.mockResolvedValue({ count: 0 });
		await expect(
			publishComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-2",
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "component publish raced with another publish; retry",
		});
		expect(prisma.componentVersion.updateMany).not.toHaveBeenCalled();
	});

	it("fails when the draft stopped being a draft before the flip", async () => {
		// The fence passes but the status-guarded flip counts 0 (the row was
		// mutated between read and commit). The pointer must roll back so the
		// component never points at a still-draft row with no live version.
		prisma.componentVersion.updateMany.mockResolvedValue({ count: 0 });
		await expect(
			publishComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-2",
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "component version v2 is no longer a draft",
		});
		expect(prisma.component.updateMany).toHaveBeenCalledWith({
			where: { id: "comp-1", publishedVersionId: "v-2" },
			data: { publishedVersionId: "v-1" },
		});
	});

	it("commits nothing to the DB when the R2 bundle write fails", async () => {
		// Bundles are written BEFORE the fence: keys/bytes are version-stable
		// so pre-writing is harmless, while writing after would leave a
		// published component whose bundles never landed (a retry is rejected
		// with 409 — the version is no longer a draft).
		// The stub's put is a vi.fn cast to the R2 signature — reach the mock
		// through a local alias to make it fail.
		const put = env.DESIGNS.put as unknown as {
			mockRejectedValue: (error: unknown) => void;
		};
		put.mockRejectedValue(new Error("r2 down"));
		await expect(
			publishComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-2",
			}),
		).rejects.toThrow("r2 down");
		expect(prisma.component.updateMany).not.toHaveBeenCalled();
		expect(prisma.componentVersion.updateMany).not.toHaveBeenCalled();
	});

	it("enforces the turn lease when a turnId is given", async () => {
		await expect(
			publishComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-2",
				turnId: "turn-1",
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "stale design chat turn",
		});
		prisma.design.findFirst.mockResolvedValue({ id: "design-1" });
		await expect(
			publishComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-2",
				turnId: "turn-1",
			}),
		).resolves.toMatchObject({ versionId: "v-2" });
	});

	it("never touches PageBlock pins (manual re-pin model)", async () => {
		await publishComponentVersion(prisma as unknown as PrismaDb, env, {
			componentId: "comp-1",
			versionId: "v-2",
		});
		// Publishing must not even READ (let alone mutate) page pins.
		expect(prisma.pageBlock.findFirst).not.toHaveBeenCalled();
	});
});

describe("restoreComponentVersion", () => {
	let prisma: ReturnType<typeof makePrismaStub>;
	let env: ReturnType<typeof makeEnv>;

	beforeEach(() => {
		prisma = makePrismaStub({
			component: componentRow(),
			// The restore SOURCE is an old retired version.
			version: versionRow({ id: "v-1", version: 1, status: "retired" }),
			latestVersion: 3,
		});
		env = makeEnv();
	});

	it("copies the old row into a new draft and publishes it", async () => {
		const result = await restoreComponentVersion(
			prisma as unknown as PrismaDb,
			env,
			{
				componentId: "comp-1",
				versionId: "v-1",
			},
		);
		// New version = max(existing)+1; content copied verbatim.
		expect(prisma.componentVersion.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				componentId: "comp-1",
				version: 4,
				status: "draft",
				js: publishedJs,
				changeNote: "restored from v1",
			}),
		});
		// The publish flow ran against the NEW draft, not the source row.
		expect(result).toMatchObject({ versionId: "v-new", version: 4 });
		expect(prisma.componentVersion.updateMany).toHaveBeenCalledWith({
			where: { id: "v-new", status: "draft" },
			data: { status: "published" },
		});
	});

	it("retries when a concurrent restore takes the next version (P2002)", async () => {
		// The [componentId, version] unique absorbs a concurrent restore: the
		// first create loses the race, the loop recomputes the latest version
		// and retries — the same restore still lands as a published version.
		const create = prisma.componentVersion.create as unknown as {
			mockImplementationOnce: (fn: () => Promise<never>) => void;
		};
		create.mockImplementationOnce(async () => {
			throw Object.assign(new Error("unique constraint"), { code: "P2002" });
		});
		await expect(
			restoreComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-1",
			}),
		).resolves.toMatchObject({ versionId: "v-new", version: 4 });
		// One lost race + one successful create; the latest version was
		// re-read between attempts.
		expect(prisma.componentVersion.create).toHaveBeenCalledTimes(2);
		expect(prisma.componentVersion.findFirst).toHaveBeenCalledTimes(2);
	});

	it("refuses to publish or restore a soft-deleted component", async () => {
		// Both flows must refuse before any write: a deleted component has no
		// library surface to publish into until it is restored. The component
		// reaches the flows through the version row's include, so the deleted
		// row is seeded there.
		const deleted = componentRow({
			publishedVersionId: "v-1",
			deletedAt: new Date(),
		});
		prisma.componentVersion.findUnique.mockResolvedValue(
			versionRow({ component: deleted }),
		);
		await expect(
			publishComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-2",
			}),
		).rejects.toMatchObject({
			status: 409,
			message: expect.stringContaining(
				'component "Hero" is deleted; restore it before publishing',
			),
		});
		await expect(
			restoreComponentVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
				versionId: "v-1",
			}),
		).rejects.toMatchObject({ status: 409 });
		// Nothing was written on either path.
		expect(prisma.componentVersion.create).not.toHaveBeenCalled();
		expect(prisma.component.updateMany).not.toHaveBeenCalled();
		expect(prisma.componentVersion.updateMany).not.toHaveBeenCalled();
		expect(env.writes).toEqual([]);
	});
});

describe("retirePublishedVersion", () => {
	it("retires the published version and nulls the pointer", async () => {
		const prisma = makePrismaStub({
			component: componentRow({ publishedVersionId: "v-1" }),
		});
		const env = makeEnv();
		await expect(
			retirePublishedVersion(prisma as unknown as PrismaDb, env, {
				componentId: "comp-1",
			}),
		).resolves.toEqual({ componentId: "comp-1", retiredVersionId: "v-1" });
		expect(prisma.component.updateMany).toHaveBeenCalledWith({
			where: { id: "comp-1", publishedVersionId: "v-1" },
			data: { publishedVersionId: null },
		});
		expect(prisma.componentVersion.updateMany).toHaveBeenCalledWith({
			where: { id: "v-1", status: "published" },
			data: { status: "retired" },
		});
	});

	it("refuses when nothing is published", async () => {
		const prisma = makePrismaStub({ component: componentRow() });
		await expect(
			retirePublishedVersion(prisma as unknown as PrismaDb, makeEnv(), {
				componentId: "comp-1",
			}),
		).rejects.toMatchObject({
			status: 409,
			message: 'component "Hero" has no published version',
		});
	});
});

describe("assertComponentVersionDeletable", () => {
	it("rejects a version pinned by a PageBlock or TemplateSlot", async () => {
		const prisma = makePrismaStub({
			component: componentRow(),
			version: versionRow({ id: "v-1" }),
			pinnedByBlock: { id: "block-1" },
		});
		await expect(
			assertComponentVersionDeletable(prisma as unknown as PrismaDb, {
				componentId: "comp-1",
				versionId: "v-1",
			}),
		).rejects.toMatchObject({
			status: 409,
			message: expect.stringContaining("cannot be deleted"),
		});
	});

	it("accepts an unpinned version", async () => {
		const prisma = makePrismaStub({
			component: componentRow(),
			version: versionRow({ id: "v-1" }),
		});
		await expect(
			assertComponentVersionDeletable(prisma as unknown as PrismaDb, {
				componentId: "comp-1",
				versionId: "v-1",
			}),
		).resolves.toBeUndefined();
	});
});

describe("publicationPageSegment (snapshot key injectivity)", () => {
	it("maps distinct site paths to distinct snapshot keys", () => {
		const paths = ["/", "/index", "/a b", "/a-b", "/x", "//x", "/x/", "/p/x"];
		const segments = paths.map(publicationPageSegment);
		expect(new Set(segments).size).toBe(paths.length);
		expect(segments).toEqual([
			"index",
			"p/index",
			"p/a%20b",
			"p/a-b",
			"p/x",
			"p//x",
			"p/x/",
			"p/p/x",
		]);
	});
});
