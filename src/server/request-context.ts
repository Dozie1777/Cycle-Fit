export type WorkerRequestContext = {
	env: Env;
	executionCtx: ExecutionContext;
};

declare module "@tanstack/react-router" {
	interface Register {
		server: {
			requestContext: WorkerRequestContext;
		};
	}
}

declare module "@tanstack/react-start" {
	interface Register {
		server: {
			requestContext: WorkerRequestContext;
		};
	}
}
