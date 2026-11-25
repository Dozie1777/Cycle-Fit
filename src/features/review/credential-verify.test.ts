import { describe, expect, it } from "vitest";
import {
	assertEnvelope,
	checkEnvelopePermissions,
	deriveBotIdentity,
	gitHubClientOptions,
	pendingPermissionUpdateHint,
} from "./credential-verify";

describe("gitHubClientOptions", () => {
	it("keeps GitHub's production endpoint by default", () => {
		expect(gitHubClientOptions()).toEqual({});
	});

	it("allows an explicit API endpoint for integration tests and GitHub Enterprise", () => {
		expect(gitHubClientOptions("http://127.0.0.1:4321")).toEqual({
			baseUrl: "http://127.0.0.1:4321",
		});
	});
});

describe("assertEnvelope", () => {
	it("accepts the two declared envelopes", () => {
		expect(assertEnvelope("pusher")).toBe("pusher");
		expect(assertEnvelope("reviewer")).toBe("reviewer");
	});

	it("rejects anything else", () => {
		expect(() => assertEnvelope("pusher ")).toThrow(/invalid envelope/);
		expect(() => assertEnvelope("review")).toThrow(/invalid envelope/);
		expect(() => assertEnvelope("admin")).toThrow(/invalid envelope/);
	});
});

describe("checkEnvelopePermissions — pusher", () => {
	it("accepts exactly contents: write + pull_requests: write", () => {
		expect(
			checkEnvelopePermissions(
				{ contents: "write", pull_requests: "write" },
				"pusher",
			),
		).toEqual({ ok: true });
	});

	it("requires pull_requests: write (fixes are proposed as PRs)", () => {
		const result = checkEnvelopePermissions({ contents: "write" }, "pusher");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.violation).toContain(
				"add to the GitHub App: pull_requests: write",
			);
		}
	});

	it("rejects contents: read only", () => {
		const result = checkEnvelopePermissions({ contents: "read" }, "pusher");
		expect(result.ok).toBe(false);
		// contents is present at the wrong level: the message says what to
		// remove (read) and what the envelope expects (write).
		if (!result.ok) {
			expect(result.violation).toContain(
				"remove from the GitHub App: contents: read",
			);
			expect(result.violation).toContain(
				"add to the GitHub App: contents: write, pull_requests: write",
			);
		}
	});

	it("rejects unrelated permissions outside the envelope", () => {
		const result = checkEnvelopePermissions(
			{ contents: "write", pull_requests: "write", issues: "write" },
			"pusher",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.violation).toContain("issues");
	});
});

describe("checkEnvelopePermissions — reviewer", () => {
	it("accepts exactly contents: read + pull_requests: write", () => {
		expect(
			checkEnvelopePermissions(
				{ contents: "read", pull_requests: "write" },
				"reviewer",
			),
		).toEqual({ ok: true });
	});

	it("rejects contents: write (a pushing reviewer breaks the split)", () => {
		const result = checkEnvelopePermissions(
			{ contents: "write", pull_requests: "write" },
			"reviewer",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.violation).toContain("contents");
	});

	it("requires pull_requests: write", () => {
		const result = checkEnvelopePermissions({ contents: "read" }, "reviewer");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.violation).toContain("pull_requests");
	});

	it("requires contents: read exactly", () => {
		const result = checkEnvelopePermissions(
			{ contents: "write", pull_requests: "write" },
			"reviewer",
		);
		expect(result.ok).toBe(false);
	});
});

describe("checkEnvelopePermissions — GitHub-mandatory permissions", () => {
	it("accepts metadata: read alongside the pusher set", () => {
		expect(
			checkEnvelopePermissions(
				{ contents: "write", pull_requests: "write", metadata: "read" },
				"pusher",
			),
		).toEqual({ ok: true });
	});

	it("accepts metadata: read alongside the reviewer set", () => {
		expect(
			checkEnvelopePermissions(
				{ contents: "read", pull_requests: "write", metadata: "read" },
				"reviewer",
			),
		).toEqual({ ok: true });
	});

	it("still rejects a mandatory permission at an unexpected level", () => {
		// GitHub only ever grants metadata: read; a write level would be a real
		// escalation, so the exemption must not be level-agnostic.
		const result = checkEnvelopePermissions(
			{ contents: "write", pull_requests: "write", metadata: "write" },
			"pusher",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.violation).toContain("metadata");
	});
});

describe("checkEnvelopePermissions — message lists every fix", () => {
	it("lists every permission to remove, not just the first", () => {
		const result = checkEnvelopePermissions(
			{
				actions: "read",
				checks: "write",
				contents: "write",
				pull_requests: "write",
			},
			"pusher",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.violation).toContain(
				"remove from the GitHub App: actions: read, checks: write",
			);
			expect(result.violation).toContain(
				"The 'pusher' envelope requires exactly: contents: write, pull_requests: write",
			);
			expect(result.violation).toContain("metadata: read is mandatory");
		}
	});

	it("names required permissions that are missing", () => {
		const result = checkEnvelopePermissions({}, "pusher");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.violation).toContain(
				"add to the GitHub App: contents: write, pull_requests: write",
			);
		}
	});

	it("reports what to remove and add in one message", () => {
		const result = checkEnvelopePermissions(
			{ contents: "write", actions: "read" },
			"reviewer",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.violation).toContain(
				"remove from the GitHub App: contents: write, actions: read",
			);
			expect(result.violation).toContain(
				"add to the GitHub App: contents: read, pull_requests: write",
			);
		}
	});
});

describe("pendingPermissionUpdateHint", () => {
	it("flags a removed permission the installation still serves", () => {
		const hint = pendingPermissionUpdateHint(
			{ contents: "write", metadata: "read", pull_requests: "write" },
			{ contents: "write", metadata: "read" },
			"pusher",
		);
		expect(hint).toContain(
			"pull_requests: removed from the app — installation still serves write",
		);
		expect(hint).toContain("approved");
	});

	it("flags a required permission the installation has not adopted", () => {
		const hint = pendingPermissionUpdateHint(
			{ contents: "read", metadata: "read" },
			{ contents: "read", metadata: "read", pull_requests: "write" },
			"reviewer",
		);
		expect(hint).toContain(
			"pull_requests: app requests write — not yet granted to the installation",
		);
	});

	it("describes a level change without listing the permission twice", () => {
		const hint = pendingPermissionUpdateHint(
			{ contents: "read", metadata: "read" },
			{ contents: "write", metadata: "read" },
			"pusher",
		);
		expect(hint).toContain(
			"contents: app requests write — installation still serves read",
		);
		expect(hint?.match(/contents/g)).toHaveLength(1);
	});

	it("stays silent when the token matches the app's settings", () => {
		expect(
			pendingPermissionUpdateHint(
				{ contents: "write", metadata: "read", pull_requests: "write" },
				{ contents: "write", metadata: "read", pull_requests: "write" },
				"pusher",
			),
		).toBeNull();
	});

	it("ignores user-scoped app permissions the token never carries", () => {
		expect(
			pendingPermissionUpdateHint(
				{ contents: "write", metadata: "read" },
				{ contents: "write", metadata: "read", email: "read" },
				"pusher",
			),
		).toBeNull();
	});
});

describe("deriveBotIdentity", () => {
	it("builds GitHub's bot login and noreply email from the app", () => {
		expect(deriveBotIdentity({ id: 12345, slug: "my-app" })).toEqual({
			botLogin: "my-app[bot]",
			botEmail: "12345+my-app[bot]@users.noreply.github.com",
		});
	});

	it("never trusts operator-supplied identity fields", () => {
		// The function has no input for them — this test pins that contract.
		const keys = Object.keys(deriveBotIdentity({ id: 1, slug: "x" }));
		expect(keys.sort()).toEqual(["botEmail", "botLogin"]);
	});
});
