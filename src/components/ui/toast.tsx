import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { cn } from "@/client/utils";
import { Button } from "@/components/ui/button";

/**
 * Lightweight toast (KUK-905): the app previously had no success feedback
 * anywhere — project creation closed its dialog silently. This is a
 * deliberate module-level pub/sub rather than React context so any client
 * component can fire a toast without prop threading, and a single <Toaster />
 * mount in AppLayout covers every admin page. No new dependencies.
 *
 * The toast list lives at module level, not in <Toaster/> state: AppLayout
 * is rendered per leaf route, so <Toaster/> remounts on every admin
 * navigation — and toasts that pair with a navigate() call (project create,
 * project delete) would otherwise be discarded by that very navigation.
 */

type ToastVariant = "default" | "success" | "destructive";

type ToastInput = {
	title: string;
	description?: string;
	/** Optional link-style action, e.g. "Start a design →". */
	actionLabel?: string;
	/** Client-route path the action navigates to. */
	actionHref?: string;
	variant?: ToastVariant;
	/** Auto-dismiss delay; defaults to 6s. */
	durationMs?: number;
};

type ToastData = ToastInput & { id: number };

let nextId = 1;
let toasts: ToastData[] = [];
const listeners = new Set<(snapshot: ToastData[]) => void>();
const timeouts = new Map<number, number>();

function notify(): void {
	const snapshot = [...toasts];
	for (const listener of listeners) listener(snapshot);
}

function dismiss(id: number): void {
	const timeout = timeouts.get(id);
	if (timeout !== undefined) {
		window.clearTimeout(timeout);
		timeouts.delete(id);
	}
	toasts = toasts.filter((item) => item.id !== id);
	notify();
}

function emit(input: ToastInput): number {
	const id = nextId++;
	toasts = [...toasts.slice(-3), { ...input, id }];
	notify();
	timeouts.set(
		id,
		window.setTimeout(() => dismiss(id), input.durationMs ?? 6000),
	);
	return id;
}

/** Fire a toast from anywhere (client components only). */
export function toast(input: ToastInput): number {
	return emit(input);
}

const VARIANT_CLASSES: Record<ToastVariant, string> = {
	default: "",
	success: "border-l-2 border-l-primary",
	destructive: "border-l-2 border-l-destructive",
};

export function Toaster() {
	// Seed from the module list so toasts fired just before this mount
	// (e.g. right before a navigate) are still visible after it.
	const [items, setItems] = useState<ToastData[]>(toasts);
	const navigate = useNavigate();

	useEffect(() => {
		const listener = (snapshot: ToastData[]) => setItems(snapshot);
		listeners.add(listener);
		// Re-sync on mount in case a toast fired between render and effect.
		notify();
		return () => {
			listeners.delete(listener);
		};
	}, []);

	if (items.length === 0) return null;

	return (
		<div
			aria-live="polite"
			className="pointer-events-none fixed top-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
		>
			{items.map((item) => (
				<div
					className={cn(
						"pointer-events-auto rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg",
						VARIANT_CLASSES[item.variant ?? "default"],
					)}
					key={item.id}
				>
					<div className="flex items-start justify-between gap-2">
						<div className="min-w-0">
							<p className="text-sm font-medium">{item.title}</p>
							{item.description && (
								<p className="mt-0.5 text-xs text-muted-foreground">
									{item.description}
								</p>
							)}
						</div>
						<Button
							aria-label="Dismiss notification"
							className="-mt-1 -mr-1 h-6 w-6 shrink-0 text-base leading-none"
							onClick={() => dismiss(item.id)}
							size="icon"
							type="button"
							variant="ghost"
						>
							<span aria-hidden="true">×</span>
						</Button>
					</div>
					{item.actionLabel && item.actionHref && (
						<Button
							className="mt-1.5 h-7 px-2 text-xs"
							onClick={() => {
								if (!item.actionHref) return;
								dismiss(item.id);
								// Client-route navigation (no full reload); `href`
								// accepts arbitrary paths, matching the ?from= pattern.
								void navigate({ href: item.actionHref });
							}}
							size="sm"
							type="button"
							variant="link"
						>
							{item.actionLabel}
						</Button>
					)}
				</div>
			))}
		</div>
	);
}
