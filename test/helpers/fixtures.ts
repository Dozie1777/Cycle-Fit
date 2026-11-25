import { env } from "cloudflare:workers";

export type TestDesign = {
	id: string;
	prompt: string;
	uploadToken: string;
	status: string;
	projectId?: string | null;
};

export type TestProject = {
	id: string;
	name: string;
	description: string | null;
};

export async function createProject(
	overrides: Partial<TestProject> = {},
): Promise<TestProject> {
	const project: TestProject = {
		id: crypto.randomUUID(),
		name: "Worker test project",
		description: null,
		...overrides,
	};
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "Project"
			(id, name, description, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?)`,
	)
		.bind(project.id, project.name, project.description, now, now)
		.run();
	return project;
}

export async function createDesign(
	overrides: Partial<TestDesign> = {},
): Promise<TestDesign> {
	const project: TestDesign = {
		id: crypto.randomUUID(),
		prompt: "Worker test design",
		uploadToken: crypto.randomUUID(),
		status: "ready",
		...overrides,
	};
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "Design"
			(id, prompt, uploadToken, status, projectId, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			project.id,
			project.prompt,
			project.uploadToken,
			project.status,
			project.projectId ?? null,
			now,
			now,
		)
		.run();
	return project;
}

export type TestCampaign = {
	id: string;
	name: string;
	projectId: string;
	status: string;
};

export async function createCampaign(
	overrides: Partial<TestCampaign> = {},
): Promise<TestCampaign> {
	const campaign: TestCampaign = {
		id: crypto.randomUUID(),
		name: "Worker test campaign",
		projectId: (await createProject()).id,
		status: "ready",
		...overrides,
	};
	const now = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO "Campaign"
			(id, name, projectId, status, createdAt, updatedAt)
			VALUES (?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			campaign.id,
			campaign.name,
			campaign.projectId,
			campaign.status,
			now,
			now,
		)
		.run();
	return campaign;
}

export async function putDesignFile(
	projectId: string,
	path: string,
	body: Parameters<R2Bucket["put"]>[1],
	contentType: string,
): Promise<void> {
	await env.DESIGNS.put(`designs/${projectId}/${path}`, body, {
		httpMetadata: { contentType },
	});
}

export type TestDesignAsset = {
	id: string;
	projectId: string | null;
	designId: string | null;
	kind: string;
	filename: string;
	contentType: string;
	bytes: Uint8Array;
	description: string | null;
};

/** Inserts an Asset row + its R2 object (`assets/<id>/<filename>`). */
export async function createDesignAsset(
	overrides: Partial<TestDesignAsset> = {},
): Promise<TestDesignAsset> {
	const asset: TestDesignAsset = {
		id: crypto.randomUUID(),
		projectId: null,
		designId: null,
		kind: "image",
		filename: "asset.png",
		contentType: "image/png",
		bytes: Uint8Array.from([8, 6, 7, 5]),
		description: null,
		...overrides,
	};
	const r2Key = `assets/${asset.id}/${asset.filename}`;
	await env.DESIGNS.put(r2Key, asset.bytes, {
		httpMetadata: { contentType: asset.contentType },
	});
	await env.DB.prepare(
		`INSERT INTO "Asset"
			(id, projectId, designId, kind, r2Key, filename, contentType, sizeBytes, description, descriptionStatus, uploadedById, createdAt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 'test-admin', ?)`,
	)
		.bind(
			asset.id,
			asset.projectId,
			asset.designId,
			asset.kind,
			r2Key,
			asset.filename,
			asset.contentType,
			asset.bytes.byteLength,
			asset.description,
			new Date().toISOString(),
		)
		.run();
	return asset;
}

export async function createPublishedDesign() {
	const project = await createDesign();
	const html = "<!doctype html><title>Worker fixture</title><p>public-file</p>";
	const previewBytes = Uint8Array.from(
		atob(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
		),
		(character) => character.charCodeAt(0),
	);
	const fileText = "distinguishable worker fixture file\n";
	await putDesignFile(project.id, "index.html", html, "text/html");
	await putDesignFile(project.id, "preview.png", previewBytes, "image/png");
	await putDesignFile(project.id, "files/note.txt", fileText, "text/plain");
	return { project, html, previewBytes, fileText };
}
