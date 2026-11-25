import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createAdminSession, createUserSession } from "../helpers/auth";
import {
	createDesign,
	createDesignAsset,
	createProject,
} from "../helpers/fixtures";
import { startWorkerRequest } from "../helpers/request";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
	trpcErrorMessage,
} from "../helpers/trpc";

// Regression coverage for the asset route split (PR after #771): the file
// route must be PUBLIC — served design pages and the agent's browser tools
// fetch asset originals without a session — while update/delete stay
// admin-gated (now as the designs.assets tRPC procedures). #771 gated all
// three via the parent layout's middleware, which cascaded and 401'd the
// public fetches.

function adminClient(session: { headers: HeadersInit }): TrpcTestClient {
	return createTrpcTestClient(session.headers);
}

describe("Start design asset routes", () => {
	it("serves visible asset bytes without a session", async () => {
		const design = await createDesign();
		const asset = await createDesignAsset({ designId: design.id });

		const response = await startWorkerRequest(
			`/designs/${design.id}/assets/${asset.id}/file`,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(asset.contentType);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(asset.bytes);
	});

	it("returns 404 for unknown assets and assets not visible to the design", async () => {
		const design = await createDesign();
		const otherDesign = await createDesign();
		const asset = await createDesignAsset({ designId: design.id });

		const missing = await startWorkerRequest(
			`/designs/${design.id}/assets/${crypto.randomUUID()}/file`,
		);
		expect(missing.status).toBe(404);

		// The other design has no project-library or link relation to this asset.
		const hidden = await startWorkerRequest(
			`/designs/${otherDesign.id}/assets/${asset.id}/file`,
		);
		expect(hidden.status).toBe(404);
	});

	it("serves project-library assets to designs filed into that project", async () => {
		const container = await createProject();
		const libraryAsset = await createDesignAsset({ projectId: container.id });
		const design = await createDesign({ projectId: container.id });

		const response = await startWorkerRequest(
			`/designs/${design.id}/assets/${libraryAsset.id}/file`,
		);
		expect(response.status).toBe(200);
	});

	it("gates update and delete with the admin session", async () => {
		const design = await createDesign();
		const asset = await createDesignAsset({ designId: design.id });

		const anonymous = createTrpcTestClient();
		const nonAdmin = adminClient(await createUserSession("user"));

		const updateCall = (client: TrpcTestClient) => () =>
			client.designs.assets.update.mutate({
				projectId: design.id,
				assetId: asset.id,
				description: "hero backdrop",
			});
		expect(await trpcErrorCode(updateCall(anonymous))).toBe("UNAUTHORIZED");
		expect(await trpcErrorCode(updateCall(nonAdmin))).toBe("FORBIDDEN");
		expect(await trpcErrorMessage(updateCall(anonymous))).toBe("unauthorized");

		const deleteCall = (client: TrpcTestClient) => () =>
			client.designs.assets.delete.mutate({
				projectId: design.id,
				assetId: asset.id,
			});
		expect(await trpcErrorCode(deleteCall(anonymous))).toBe("UNAUTHORIZED");
	});

	it("updates the description and deletes the asset for admins", async () => {
		const design = await createDesign();
		const asset = await createDesignAsset({ designId: design.id });
		const session = await createAdminSession();
		const client = adminClient(session);

		const patched = await client.designs.assets.update.mutate({
			projectId: design.id,
			assetId: asset.id,
			description: "hero backdrop",
		});
		expect(patched.description).toBe("hero backdrop");

		expect(
			await client.designs.assets.delete.mutate({
				projectId: design.id,
				assetId: asset.id,
			}),
		).toBeUndefined();
		expect(
			await env.DESIGNS.get(`assets/${asset.id}/${asset.filename}`),
		).toBeNull();
		expect(
			await env.DB.prepare('SELECT COUNT(*) AS count FROM "Asset" WHERE id = ?')
				.bind(asset.id)
				.first()
				.then((row) => row?.count),
		).toBe(0);
	});
});
