// Admin domain functions for the KUK-928 studio building-block views (data
// collections, templates, flows). Project-scoped — the studio renders these
// from the inspector next to the design-scoped page composer, but data
// collections, templates and flows belong to the whole project (pages bind
// to collections by name and templates are instantiated across designs).
// Same conventions as the other handlers: zod bounds the envelope, the lib
// ops do the shape checks, and their model-correctable failures map onto
// tRPC error codes (400→BAD_REQUEST, 404→NOT_FOUND, 409→CONFLICT).

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isProjectId } from "@/features/design-studio/assets/design-files";
import {
	createDataCollectionTool,
	type DataCollectionMutationResult,
	type DataRecordsResult,
	type DeleteResult,
	defineFlowTool,
	defineTemplateTool,
	deleteDataCollectionTool,
	deleteFlowTool,
	deleteTemplateTool,
	listProjectDataCollections,
	listProjectFlows,
	listProjectTemplates,
	type PageToolFailure,
	renameDataCollectionTool,
	replaceDataRecordsTool,
} from "@/features/design-studio/tools/page-tools";
import { getPrisma } from "@/lib/db";

function invalidProjectId(): never {
	throw new TRPCError({ code: "BAD_REQUEST", message: "invalid project id" });
}

/**
 * The lib ops report model-correctable failures as values (never thrown).
 * The legacy HTTP layer answered `{ errors: string[] }` with the op's
 * status; the client surfaced `errors.join("; ")` — keep that exact text
 * as the tRPC error message.
 */
function failOp(result: PageToolFailure): never {
	const message = result.errors.join("; ");
	const code =
		result.status === 404
			? "NOT_FOUND"
			: result.status === 409
				? "CONFLICT"
				: "BAD_REQUEST";
	throw new TRPCError({ code, message });
}

// ---------------------------------------------------------------------------
// Data collections + records.
// ---------------------------------------------------------------------------

export const collectionBody = z.object({
	name: z.string().min(1).max(80),
});

export const renameCollectionBody = z.object({
	name: z.string().min(1).max(80),
});

// Loose on purpose: the lib op validates each record is a plain
// JSON-serializable object and caps the count.
export const recordsBody = z.object({
	records: z.array(z.unknown()).max(1000),
});

export async function listDataCollections(input: {
	env: Env;
	projectId: string;
}) {
	if (!isProjectId(input.projectId)) invalidProjectId();
	const collections = await listProjectDataCollections(getPrisma(input.env), {
		projectId: input.projectId,
	});
	return { collections };
}

export async function createDataCollection(input: {
	env: Env;
	projectId: string;
	name: string;
}) {
	const { env, projectId, name } = input;
	if (!isProjectId(projectId)) invalidProjectId();
	const result = await createDataCollectionTool(getPrisma(env), {
		projectId,
		name,
	});
	if (!result.ok) failOp(result);
	return { collection: result.collection };
}

export async function renameDataCollection(input: {
	env: Env;
	projectId: string;
	collectionId: string;
	name: string;
}) {
	const { env, projectId, collectionId, name } = input;
	if (!isProjectId(projectId)) invalidProjectId();
	const result: DataCollectionMutationResult = await renameDataCollectionTool(
		getPrisma(env),
		{
			projectId,
			collectionId,
			name,
		},
	);
	if (!result.ok) failOp(result);
	return { collection: result.collection };
}

export async function deleteDataCollection(input: {
	env: Env;
	projectId: string;
	collectionId: string;
}): Promise<void> {
	if (!isProjectId(input.projectId)) invalidProjectId();
	const result = await deleteDataCollectionTool(getPrisma(input.env), {
		projectId: input.projectId,
		collectionId: input.collectionId,
	});
	if (!result.ok) failOp(result);
}

export async function replaceDataRecords(input: {
	env: Env;
	projectId: string;
	collectionId: string;
	records: unknown[];
}) {
	const { env, projectId, collectionId, records } = input;
	if (!isProjectId(projectId)) invalidProjectId();
	const result: DataRecordsResult = await replaceDataRecordsTool(
		getPrisma(env),
		env.DB,
		{
			projectId,
			collectionId,
			records,
		},
	);
	if (!result.ok) failOp(result);
	return {
		collectionId: result.collectionId,
		name: result.name,
		count: result.count,
	};
}

// ---------------------------------------------------------------------------
// Templates.
// ---------------------------------------------------------------------------

// Loose on purpose: defineTemplateTool validates every slot's component pin
// and props overrides with model-correctable errors.
export const defineTemplateBody = z.object({
	name: z.string().min(1).max(80),
	slots: z
		.array(
			z.object({
				component: z.object({
					name: z.string().min(1).max(80),
					version: z.number().int().positive().nullish(),
				}),
				propsOverrides: z.record(z.string(), z.unknown()).nullish(),
			}),
		)
		.max(50),
});

export async function listTemplates(input: { env: Env; projectId: string }) {
	if (!isProjectId(input.projectId)) invalidProjectId();
	const templates = await listProjectTemplates(getPrisma(input.env), {
		projectId: input.projectId,
	});
	return { templates };
}

export async function defineTemplate(input: {
	env: Env;
	projectId: string;
	body: z.infer<typeof defineTemplateBody>;
}) {
	const { env, projectId, body } = input;
	if (!isProjectId(projectId)) invalidProjectId();
	const result = await defineTemplateTool(getPrisma(env), env.DB, {
		projectId,
		name: body.name,
		slots: body.slots.map((slot) => ({
			component: {
				name: slot.component.name,
				...(slot.component.version != null
					? { version: slot.component.version }
					: {}),
			},
			...(slot.propsOverrides != null
				? { propsOverrides: slot.propsOverrides }
				: {}),
		})),
	});
	if (!result.ok) failOp(result);
	return { template: result.template };
}

export async function deleteTemplate(input: {
	env: Env;
	projectId: string;
	templateId: string;
}): Promise<void> {
	if (!isProjectId(input.projectId)) invalidProjectId();
	const result: DeleteResult = await deleteTemplateTool(getPrisma(input.env), {
		projectId: input.projectId,
		templateId: input.templateId,
	});
	if (!result.ok) failOp(result);
}

// ---------------------------------------------------------------------------
// Flows.
// ---------------------------------------------------------------------------

// Loose on purpose: defineFlowTool validates every step's page path and
// action lengths with model-correctable errors.
export const defineFlowBody = z.object({
	name: z.string().min(1).max(80),
	steps: z
		.array(
			z.object({
				path: z.string().min(1).max(200),
				entryAction: z.string().max(300).nullish(),
				exitTarget: z.string().max(300).nullish(),
			}),
		)
		.max(50),
});

export async function listFlows(input: { env: Env; projectId: string }) {
	if (!isProjectId(input.projectId)) invalidProjectId();
	const view = await listProjectFlows(getPrisma(input.env), {
		projectId: input.projectId,
	});
	return view;
}

export async function defineFlow(input: {
	env: Env;
	projectId: string;
	body: z.infer<typeof defineFlowBody>;
}) {
	const { env, projectId, body } = input;
	if (!isProjectId(projectId)) invalidProjectId();
	const result = await defineFlowTool(getPrisma(env), env.DB, {
		projectId,
		name: body.name,
		steps: body.steps.map((step) => ({
			path: step.path,
			...(step.entryAction != null ? { entryAction: step.entryAction } : {}),
			...(step.exitTarget != null ? { exitTarget: step.exitTarget } : {}),
		})),
	});
	if (!result.ok) failOp(result);
	return { flow: result.flow };
}

export async function deleteFlow(input: {
	env: Env;
	projectId: string;
	flowId: string;
}): Promise<void> {
	if (!isProjectId(input.projectId)) invalidProjectId();
	const result: DeleteResult = await deleteFlowTool(getPrisma(input.env), {
		projectId: input.projectId,
		flowId: input.flowId,
	});
	if (!result.ok) failOp(result);
}
