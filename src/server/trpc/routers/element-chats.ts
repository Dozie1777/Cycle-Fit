import { z } from "zod";
import {
	createElementChat,
	createElementChatBody,
	deleteElementChat,
	getElementChat,
	listElementChatMessages,
} from "@/server/data/element-chats";
import { adminProcedure, router } from "../trpc";

const elementChatIdInput = z.object({ elementChatId: z.string().min(1) });

export const elementChatsRouter = router({
	create: adminProcedure
		.input(createElementChatBody)
		.mutation(({ ctx, input }) =>
			createElementChat({ env: ctx.env, body: input }),
		),

	get: adminProcedure
		.input(elementChatIdInput)
		.query(({ ctx, input }) => getElementChat(ctx.env, input.elementChatId)),

	listMessages: adminProcedure
		.input(elementChatIdInput)
		.query(({ ctx, input }) =>
			listElementChatMessages(ctx.env, input.elementChatId),
		),

	delete: adminProcedure
		.input(elementChatIdInput)
		.mutation(({ ctx, input }) =>
			deleteElementChat(ctx.env, input.elementChatId),
		),
});
