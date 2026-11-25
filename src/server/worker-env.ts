import { AsyncLocalStorage } from "node:async_hooks";

const workerEnv = new AsyncLocalStorage<Env>();

export function runWithWorkerEnv<T>(env: Env, callback: () => T): T {
	return workerEnv.run(env, callback);
}

export function getWorkerEnv(): Env | undefined {
	return workerEnv.getStore();
}
