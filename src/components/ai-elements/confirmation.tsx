"use client";

import { cn } from "cn";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export type ConfirmationAction = {
	label: string;
	value: string;
	variant?: "default" | "outline" | "secondary" | "destructive";
};

export type ConfirmationProps = {
	title: ReactNode;
	description?: ReactNode;
	actions: ConfirmationAction[];
	onAction: (value: string) => void;
	disabled?: boolean;
	className?: string;
};

export function Confirmation({
	title,
	description,
	actions,
	onAction,
	disabled,
	className,
}: ConfirmationProps) {
	return (
		<Card
			className={cn(
				"w-full border-border/50 bg-card/50 shadow-none",
				className,
			)}
		>
			<CardHeader className="pb-2">
				<CardTitle className="text-sm font-medium">{title}</CardTitle>
				{description && (
					<CardDescription className="text-xs">{description}</CardDescription>
				)}
			</CardHeader>
			<CardFooter className="flex flex-wrap gap-2 pt-2">
				{actions.map((action) => (
					<Button
						key={action.value}
						size="sm"
						variant={action.variant ?? "default"}
						disabled={disabled}
						onClick={() => onAction(action.value)}
					>
						{action.label}
					</Button>
				))}
			</CardFooter>
		</Card>
	);
}
