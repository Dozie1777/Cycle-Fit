import { describe, expect, it } from "vitest";
import {
	createAdminSession,
	createUserSession,
	startAdminRequest,
} from "../helpers/auth";
import { startWorkerRequest } from "../helpers/request";
import {
	createTrpcTestClient,
	type TrpcTestClient,
	trpcErrorCode,
} from "../helpers/trpc";

/**
 * Admin-leg outcome of each protected procedure — the tRPC codes the old
 * HTTP matrix statuses stood for: 200 → the call succeeds (null),
 * 400 → BAD_REQUEST, 404 → NOT_FOUND.
 */
type AdminLeg = "null" | "BAD_REQUEST" | "NOT_FOUND";

type ProtectedProcedure = {
	/** tRPC procedure path (e.g. "agents.list") — display only. */
	procedure: string;
	call: (client: TrpcTestClient) => Promise<unknown>;
	adminCode: AdminLeg;
};

// Bogus ids keep the old matrix's two flavors: "invalid" fails the
// id-shape check inside the handler (→ BAD_REQUEST) while "missing" is
// well-shaped but absent (→ NOT_FOUND where the old route answered 404).
// Auth rejects BEFORE input validation, so the anonymous/non-admin legs
// reuse the same call and only the admin leg asserts the domain code.
const PROTECTED_PROCEDURES = [
	// --- agents (old GET/POST /agents, POST/PATCH /agents/:id/credentials[/:id])
	{
		procedure: "agents.list",
		call: (client) => client.agents.list.query(),
		adminCode: "null",
	},
	{
		procedure: "agents.create",
		call: (client) => client.agents.create.mutate({ name: "", email: "" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "agents.registerCredential",
		call: (client) =>
			client.agents.registerCredential.mutate({
				agentId: "missing",
				provider: "github_app",
				externalId: "",
				appId: "",
				envelope: "pusher",
				privateKeyPem: "",
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "agents.updateCredential",
		call: (client) =>
			client.agents.updateCredential.mutate({
				agentId: "missing",
				credentialId: "missing",
				status: "active",
			}),
		adminCode: "NOT_FOUND",
	},

	// --- admins (old GET/POST /admins)
	{
		procedure: "admins.list",
		call: (client) => client.admins.list.query(),
		adminCode: "null",
	},
	{
		procedure: "admins.create",
		call: (client) =>
			client.admins.create.mutate({ name: "", email: "", password: "" }),
		adminCode: "BAD_REQUEST",
	},

	// --- designs (old /designs routes; design ids are lowercase UUIDs, so
	// "invalid" fails the isDesignId shape check)
	{
		procedure: "designs.list",
		call: (client) => client.designs.list.query(),
		adminCode: "null",
	},
	{
		procedure: "designs.create",
		call: (client) =>
			client.designs.create.mutate({ prompt: "", projectId: "invalid" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.get",
		call: (client) => client.designs.get.query({ projectId: "invalid" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.delete",
		call: (client) => client.designs.delete.mutate({ projectId: "invalid" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.listVersions",
		call: (client) =>
			client.designs.listVersions.query({ projectId: "invalid" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.restoreVersion",
		call: (client) =>
			client.designs.restoreVersion.mutate({ projectId: "invalid", n: 1 }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.listMessages",
		call: (client) =>
			client.designs.listMessages.query({ projectId: "invalid" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.debugExec",
		call: (client) =>
			client.designs.debugExec.mutate({
				projectId: "invalid",
				command: "echo hi",
			}),
		adminCode: "BAD_REQUEST",
	},

	// --- projects (old /projects routes; project ids are cuids/UUIDs, so
	// "missing" is shape-valid and reaches the NOT_FOUND paths)
	{
		procedure: "projects.list",
		call: (client) => client.projects.list.query(),
		adminCode: "null",
	},
	{
		procedure: "projects.create",
		call: (client) => client.projects.create.mutate({ name: "" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "projects.get",
		call: (client) => client.projects.get.query({ projectId: "missing" }),
		adminCode: "NOT_FOUND",
	},
	{
		procedure: "projects.update",
		call: (client) =>
			client.projects.update.mutate({ projectId: "missing", name: "Renamed" }),
		adminCode: "NOT_FOUND",
	},
	{
		procedure: "projects.delete",
		call: (client) => client.projects.delete.mutate({ projectId: "missing" }),
		adminCode: "NOT_FOUND",
	},
	{
		procedure: "projects.createDesign",
		call: (client) =>
			client.projects.createDesign.mutate({
				projectId: "missing",
				prompt: "make a site",
			}),
		adminCode: "NOT_FOUND",
	},

	// --- component library (old GET /projects/:id/components, repin)
	{
		procedure: "designs.components.list",
		call: (client) =>
			client.designs.components.list.query({ projectId: "missing" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.components.repin",
		call: (client) =>
			client.designs.components.repin.mutate({
				projectId: "missing",
				designId: "missing",
				pageId: "missing",
				blockId: "missing",
				componentId: "missing",
			}),
		adminCode: "BAD_REQUEST",
	},

	// --- studio pages/blocks (old /projects/:id/designs/:designId/pages/*)
	{
		procedure: "designs.pages.list",
		call: (client) =>
			client.designs.pages.list.query({
				projectId: "missing",
				designId: "missing",
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.pages.create",
		call: (client) =>
			client.designs.pages.create.mutate({
				projectId: "missing",
				designId: "missing",
				path: "home",
				title: "Home",
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.pages.update",
		call: (client) =>
			client.designs.pages.update.mutate({
				projectId: "missing",
				designId: "missing",
				pageId: "missing",
				title: "Home",
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.pages.delete",
		call: (client) =>
			client.designs.pages.delete.mutate({
				projectId: "missing",
				designId: "missing",
				pageId: "missing",
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "designs.pages.replaceBlocks",
		call: (client) =>
			client.designs.pages.replaceBlocks.mutate({
				projectId: "missing",
				designId: "missing",
				pageId: "missing",
				blocks: [],
			}),
		adminCode: "BAD_REQUEST",
	},

	// --- data collections (old /projects/:id/data/*)
	{
		procedure: "projects.data.list",
		call: (client) => client.projects.data.list.query({ projectId: "missing" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "projects.data.create",
		call: (client) =>
			client.projects.data.create.mutate({
				projectId: "missing",
				name: "contacts",
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "projects.data.rename",
		call: (client) =>
			client.projects.data.rename.mutate({
				projectId: "missing",
				collectionId: "missing",
				name: "contacts",
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "projects.data.delete",
		call: (client) =>
			client.projects.data.delete.mutate({
				projectId: "missing",
				collectionId: "missing",
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "projects.data.replaceRecords",
		call: (client) =>
			client.projects.data.replaceRecords.mutate({
				projectId: "missing",
				collectionId: "missing",
				records: [],
			}),
		adminCode: "BAD_REQUEST",
	},

	// --- templates (old /projects/:id/templates*)
	{
		procedure: "projects.templates.list",
		call: (client) =>
			client.projects.templates.list.query({ projectId: "missing" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "projects.templates.define",
		call: (client) =>
			client.projects.templates.define.mutate({
				projectId: "missing",
				body: { name: "hero", slots: [] },
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "projects.templates.delete",
		call: (client) =>
			client.projects.templates.delete.mutate({
				projectId: "missing",
				templateId: "missing",
			}),
		adminCode: "BAD_REQUEST",
	},

	// --- flows (old /projects/:id/flows*)
	{
		procedure: "projects.flows.list",
		call: (client) =>
			client.projects.flows.list.query({ projectId: "missing" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "projects.flows.define",
		call: (client) =>
			client.projects.flows.define.mutate({
				projectId: "missing",
				body: { name: "signup", steps: [] },
			}),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "projects.flows.delete",
		call: (client) =>
			client.projects.flows.delete.mutate({
				projectId: "missing",
				flowId: "missing",
			}),
		adminCode: "BAD_REQUEST",
	},

	// --- channels (KUK-890 calendar swimlanes)
	{
		procedure: "channels.list",
		call: (client) => client.channels.list.query(),
		adminCode: "null",
	},
	{
		procedure: "channels.create",
		call: (client) => client.channels.create.mutate({} as never),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "channels.update",
		call: (client) =>
			client.channels.update.mutate({ id: "missing", name: "Email" }),
		adminCode: "NOT_FOUND",
	},

	// --- skills (KUK-891 studio slash commands)
	{
		procedure: "skills.list",
		call: (client) => client.skills.list.query(),
		adminCode: "null",
	},
	{
		procedure: "skills.create",
		call: (client) => client.skills.create.mutate({} as never),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "skills.update",
		call: (client) =>
			client.skills.update.mutate({ id: "missing", name: "New name" }),
		adminCode: "NOT_FOUND",
	},
	{
		procedure: "skills.delete",
		call: (client) => client.skills.delete.mutate({ id: "missing" }),
		adminCode: "NOT_FOUND",
	},

	// --- campaigns (campaign ids are lowercase UUIDs, so "missing" fails
	// the isCampaignId shape check → BAD_REQUEST)
	{
		procedure: "campaigns.list",
		call: (client) => client.campaigns.list.query(),
		adminCode: "null",
	},
	{
		procedure: "campaigns.create",
		call: (client) =>
			client.campaigns.create.mutate({ projectId: "", name: "" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "campaigns.get",
		call: (client) => client.campaigns.get.query({ campaignId: "missing" }),
		adminCode: "BAD_REQUEST",
	},
	{
		procedure: "campaigns.delete",
		call: (client) => client.campaigns.delete.mutate({ campaignId: "missing" }),
		adminCode: "BAD_REQUEST",
	},
] as const satisfies readonly ProtectedProcedure[];

describe("tRPC authorization matrix", () => {
	it.each(
		PROTECTED_PROCEDURES,
	)("$procedure rejects anonymous and non-admin users before allowing an admin", async ({
		call,
		adminCode,
	}) => {
		const anonymous = createTrpcTestClient();
		expect(await trpcErrorCode(() => call(anonymous))).toBe("UNAUTHORIZED");

		const nonAdmin = createTrpcTestClient(
			(await createUserSession("user")).headers,
		);
		expect(await trpcErrorCode(() => call(nonAdmin))).toBe("FORBIDDEN");

		const admin = createTrpcTestClient((await createAdminSession()).headers);
		const adminResult = await trpcErrorCode(() => call(admin));
		if (adminCode === "null") {
			expect(adminResult).toBeNull();
		} else {
			expect(adminResult).toBe(adminCode);
		}
	});

	// The design chat stream stays a plain-HTTP Start route (streaming
	// response doesn't fit the JSON batch protocol) — its gate is the Start
	// adminMiddleware, so it keeps the old { error } bodies and statuses.
	it("keeps the design chat stream behind adminMiddleware on /designs/:projectId/chat", async () => {
		const chatInit: RequestInit = {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		};

		const anonymous = await startWorkerRequest("/designs/invalid/chat", {
			...chatInit,
		});
		expect(anonymous.status).toBe(401);
		expect(await anonymous.json()).toEqual({ error: "unauthorized" });

		const nonAdmin = await startAdminRequest(
			"/designs/invalid/chat",
			await createUserSession("user"),
			{ ...chatInit },
		);
		expect(nonAdmin.status).toBe(403);
		expect(await nonAdmin.json()).toEqual({
			error: "forbidden — admin role required",
		});

		const admin = await startAdminRequest(
			"/designs/invalid/chat",
			await createAdminSession(),
			{ ...chatInit },
		);
		expect(admin.status).toBe(400);
		expect(await admin.json()).toEqual({ error: "invalid project id" });
	});
});
