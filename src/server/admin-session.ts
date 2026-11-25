import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getAuth } from "../lib/auth";

export const getAdminSession = createServerFn({ method: "GET" }).handler(
	async ({ context }) => {
		return getAuth(context.env).api.getSession({
			headers: getRequestHeaders(),
		});
	},
);
