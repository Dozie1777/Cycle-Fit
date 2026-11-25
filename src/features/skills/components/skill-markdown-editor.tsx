"use client";

import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
	Bold,
	Code,
	Heading2,
	Heading3,
	Italic,
	Link2,
	List,
	ListOrdered,
	Quote,
	RotateCcw,
	RotateCw,
	Strikethrough,
	Table as TableIcon,
	Terminal,
} from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/client/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

/**
 * Minimal Tiptap WYSIWYG editor for skill markdown (a "simple editor").
 *
 * Deliberately text-only: StarterKit + Link + tables + the official
 * @tiptap/markdown round-trip — no image, video, or media extensions, and
 * pasted media is dropped because no such node types are registered. Value
 * flows as markdown strings (the storage format of the Skill table); the
 * editor serializes back to markdown on every change so nothing is lost
 * between edit sessions.
 *
 * Hook-based useEditor API (not the composable <Tiptap> API): this is a
 * single-purpose editor inside one component, where the hook form is fine.
 */
export function SkillMarkdownEditor({
	value,
	onChange,
	disabled = false,
	className,
}: {
	value: string;
	onChange: (markdown: string) => void;
	disabled?: boolean;
	className?: string;
}) {
	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				// Keep the starter kit lean — no horizontal rules, no hard-break
				// games; markdown round-trips through paragraphs and lists.
				horizontalRule: false,
			}),
			Markdown,
			TableKit.configure({ table: { resizable: false } }),
		],
		content: value,
		contentType: "markdown",
		editable: !disabled,
		editorProps: {
			attributes: {
				class:
					"min-h-64 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] max-h-[60vh] overflow-y-auto prose-sm",
			},
		},
		onUpdate: ({ editor: current }) => {
			onChange(current.getMarkdown());
		},
	});

	// Sync external resets (e.g. switching the selected skill) into the
	// editor without clobbering the doc on every parent render.
	useEffect(() => {
		if (!editor) return;
		const current = editor.getMarkdown();
		if (value !== current) {
			editor.commands.setContent(value, { contentType: "markdown" });
		}
	}, [editor, value]);

	useEffect(() => {
		if (editor) editor.setEditable(!disabled);
	}, [editor, disabled]);

	if (!editor) {
		return (
			<div
				className={cn(
					"min-h-64 w-full animate-pulse rounded-md border bg-muted/40",
					className,
				)}
			/>
		);
	}

	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<div
				className="flex flex-wrap items-center gap-1"
				role="toolbar"
				aria-label="Formatting"
			>
				<ToolbarButton
					active={editor.isActive("bold")}
					disabled={disabled}
					label="Bold"
					onClick={() => editor.chain().focus().toggleBold().run()}
				>
					<Bold className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("italic")}
					disabled={disabled}
					label="Italic"
					onClick={() => editor.chain().focus().toggleItalic().run()}
				>
					<Italic className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("strike")}
					disabled={disabled}
					label="Strikethrough"
					onClick={() => editor.chain().focus().toggleStrike().run()}
				>
					<Strikethrough className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("code")}
					disabled={disabled}
					label="Inline code"
					onClick={() => editor.chain().focus().toggleCode().run()}
				>
					<Code className="size-4" />
				</ToolbarButton>
				<Separator orientation="vertical" className="mx-1 h-5" />
				<ToolbarButton
					active={editor.isActive("heading", { level: 2 })}
					disabled={disabled}
					label="Heading 2"
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 2 }).run()
					}
				>
					<Heading2 className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("heading", { level: 3 })}
					disabled={disabled}
					label="Heading 3"
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 3 }).run()
					}
				>
					<Heading3 className="size-4" />
				</ToolbarButton>
				<Separator orientation="vertical" className="mx-1 h-5" />
				<ToolbarButton
					active={editor.isActive("bulletList")}
					disabled={disabled}
					label="Bullet list"
					onClick={() => editor.chain().focus().toggleBulletList().run()}
				>
					<List className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("orderedList")}
					disabled={disabled}
					label="Numbered list"
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
				>
					<ListOrdered className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("blockquote")}
					disabled={disabled}
					label="Blockquote"
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
				>
					<Quote className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("codeBlock")}
					disabled={disabled}
					label="Code block"
					onClick={() => editor.chain().focus().toggleCodeBlock().run()}
				>
					<Terminal className="size-4" />
				</ToolbarButton>
				<Separator orientation="vertical" className="mx-1 h-5" />
				<ToolbarButton
					active={editor.isActive("link")}
					disabled={disabled}
					label="Link"
					onClick={() => {
						const existing = editor.getAttributes("link").href as
							| string
							| undefined;
						const href = window.prompt("Link URL", existing ?? "https://");
						if (href === null) return;
						if (href.trim() === "" || href === "https://") {
							editor.chain().focus().unsetLink().run();
							return;
						}
						editor.chain().focus().setLink({ href: href.trim() }).run();
					}}
				>
					<Link2 className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					active={editor.isActive("table")}
					disabled={disabled}
					label="Insert table"
					onClick={() =>
						editor
							.chain()
							.focus()
							.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
							.run()
					}
				>
					<TableIcon className="size-4" />
				</ToolbarButton>
				<Separator orientation="vertical" className="mx-1 h-5" />
				<ToolbarButton
					active={false}
					disabled={disabled || !editor.can().undo()}
					label="Undo"
					onClick={() => editor.chain().focus().undo().run()}
				>
					<RotateCcw className="size-4" />
				</ToolbarButton>
				<ToolbarButton
					active={false}
					disabled={disabled || !editor.can().redo()}
					label="Redo"
					onClick={() => editor.chain().focus().redo().run()}
				>
					<RotateCw className="size-4" />
				</ToolbarButton>
			</div>
			<EditorContent editor={editor} />
			<p className="text-muted-foreground text-xs">
				Plain text and tables only — images, video, and other media are not
				editable here and are stripped on paste.
			</p>
		</div>
	);
}

function ToolbarButton({
	active,
	disabled,
	label,
	onClick,
	children,
}: {
	active: boolean;
	disabled?: boolean;
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label={label}
			aria-pressed={active}
			title={label}
			disabled={disabled}
			onClick={onClick}
			className={cn(active && "bg-accent text-accent-foreground")}
		>
			{children}
		</Button>
	);
}
