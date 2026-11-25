import { createFileRoute } from "@tanstack/react-router";
import { TERMINAL_UI_HTML } from "../lib/terminal-ui";
import { adminMiddleware } from "../server/middleware";

// The xterm page drives a root shell in the review sandbox, so it sits behind
// the same admin gate as every other operator surface.
export const Route = createFileRoute("/ui")({
	server: {
		middleware: [adminMiddleware],
		handlers: {
			GET: () =>
				new Response(TERMINAL_UI_HTML, {
					headers: { "content-type": "text/html; charset=UTF-8" },
				}),
			ANY: () => new Response(null, { status: 405, headers: { Allow: "GET" } }),
		},
	},
});
