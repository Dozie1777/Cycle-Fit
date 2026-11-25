import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
	type DesignChatConnState,
	designChat,
} from "../../src/server/rivet/actors/design-chat/index";
import { createApiSession, createUserSession } from "../helpers/auth";

type CreateConnStateFn = (
	c: { request?: Request; key: string[] },
	params: unknown,
) => Promise<DesignChatConnState>;

function getCreateConnState(): CreateConnStateFn {
	return (
		designChat.config as unknown as { createConnState: CreateConnStateFn }
	).createConnState;
}

async function makeAdminSession() {
	const session = await createApiSession();
	await env.DB.prepare(`UPDATE "user" SET role = ? WHERE id = ?`)
		.bind("admin", session.userId)
		.run();
	return session;
}

describe("design chat actor authorization", () => {
	it("lets an admin connect to a design chat actor", async () => {
		const session = await makeAdminSession();
		const state = await getCreateConnState()(
			{
				request: new Request("http://localhost/rivet", {
					headers: session.headers,
				}),
				key: ["design", "design-1"],
			},
			undefined,
		);
		expect(state.userId).toBe(session.userId);
		expect(state.role).toBe("admin");
	});

	it("rejects a non-admin caller", async () => {
		const session = await createUserSession("user");
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet", {
						headers: session.headers,
					}),
					key: ["design", "design-1"],
				},
				undefined,
			),
		).rejects.toMatchObject({ code: "forbidden" });
	});

	it("rejects unauthenticated callers", async () => {
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet"),
					key: ["design", "design-1"],
				},
				undefined,
			),
		).rejects.toMatchObject({ code: "unauthorized" });
	});

	it("rejects an invalid actor key", async () => {
		const session = await makeAdminSession();
		await expect(
			getCreateConnState()(
				{
					request: new Request("http://localhost/rivet", {
						headers: session.headers,
					}),
					key: ["wrong", "design-1"],
				},
				undefined,
			),
		).rejects.toMatchObject({ code: "invalid_actor_key" });
	});
});

describe("design chat actor contract", () => {
	it("exports the sendMessage action", () => {
		const config = designChat.config as unknown as {
			actions: Record<string, unknown>;
		};
		expect(config.actions.sendMessage).toBeDefined();
	});

	it("exports ui message stream events", () => {
		const config = designChat.config as unknown as {
			events: Record<string, unknown>;
		};
		expect(config.events.uiMessageChunk).toBeDefined();
		expect(config.events.turnFinished).toBeDefined();
		expect(config.events.turnFailed).toBeDefined();
	});
});
