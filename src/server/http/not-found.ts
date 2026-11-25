export function apiNotFoundResponse() {
	return new Response("Try /api/trpc, /ui, /api/auth, or /process-logs", {
		status: 404,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}
