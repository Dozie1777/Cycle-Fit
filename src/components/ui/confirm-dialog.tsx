import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

/**
 * Styled destructive-confirmation dialog (KUK-909). Replaces the native
 * `window.confirm` used by the most dangerous flows — unstyled and
 * unescapable-by-style — so every destructive action in the app confirms
 * through the same themed Dialog the studio already used.
 *
 * The caller owns the mutation. The dialog guards itself: it stays open
 * while `pending` (external closes are ignored), focuses Cancel instead of
 * the destructive button, and surfaces failures inline.
 */
export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmLabel = "Delete",
	pending = false,
	onConfirm,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	confirmLabel?: string;
	pending?: boolean;
	onConfirm: () => void | Promise<void>;
}) {
	const [actionError, setActionError] = useState<string | null>(null);

	return (
		<Dialog
			onOpenChange={(next) => {
				// Ignore external closes (overlay click, Esc) while the
				// destructive action is still running — a closing dialog
				// mid-delete reads like the tap did nothing.
				if (pending && !next) return;
				if (!next) setActionError(null);
				onOpenChange(next);
			}}
			open={open}
		>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				{actionError && (
					<p className="text-sm text-destructive">{actionError}</p>
				)}
				<DialogFooter>
					<Button
						autoFocus
						disabled={pending}
						onClick={() => onOpenChange(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={pending}
						onClick={async () => {
							setActionError(null);
							try {
								await onConfirm();
								onOpenChange(false);
							} catch (e) {
								// Keep the dialog open and show what went wrong — a
								// silently closing dialog reads like the tap did nothing.
								setActionError(
									e instanceof Error ? e.message : "Delete failed — try again",
								);
							}
						}}
						type="button"
						variant="destructive"
					>
						{pending
							? `${confirmLabel.startsWith("Delete") ? "Deleting…" : `${confirmLabel}…`}`
							: confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
