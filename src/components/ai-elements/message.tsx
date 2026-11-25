"use client";

import type { HTMLAttributes } from "react";
import { cn } from "@/client/utils";
import {
	MessageContent as MessageContentPrimitive,
	Message as MessagePrimitive,
} from "@/components/ui/message";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: "user" | "assistant";
};

export const Message = ({
	className,
	from,
	children,
	...props
}: MessageProps) => (
	<MessagePrimitive
		align={from === "user" ? "end" : "start"}
		className={className}
		{...props}
	>
		{children}
	</MessagePrimitive>
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
	className,
	children,
	...props
}: MessageContentProps) => (
	<MessageContentPrimitive className={cn("text-sm", className)} {...props}>
		{children}
	</MessageContentPrimitive>
);
