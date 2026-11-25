import type { ReactNode } from "react";

/**
 * Minimal server-safe markdown renderer for the public campaign share page.
 * Deliberately NOT Streamdown: streamdown's dist pulls `katex/dist/katex.min.css`
 * through the route tree, which the plain-node unit test project cannot load.
 * This covers the shapes the agent actually writes into brief bodies, phase
 * detail, and report metrics/bodies — headings, lists, pipe tables, bold /
 * italic / inline code — with no CSS imports and no new dependencies.
 * Text is rendered as React children, so it is XSS-safe by construction.
 *
 * Every node gets a content-derived id (plus an occurrence counter for exact
 * duplicates) instead of an array index: the snapshot content is static and
 * this keeps React keys stable without index-key lint noise.
 */

type Block =
	| { kind: "heading"; id: string; level: 1 | 2 | 3; text: string }
	| { kind: "paragraph"; id: string; text: string }
	| { kind: "list"; id: string; ordered: boolean; items: string[] }
	| { kind: "table"; id: string; head: string[]; rows: string[][] };

/** Unique-per-scope id from content, appending #2, #3, ... for duplicates. */
function uniqueId(scope: Map<string, number>, content: string): string {
	const count = scope.get(content) ?? 0;
	scope.set(content, count + 1);
	return count === 0 ? content : `${content}#${count + 1}`;
}

function parseTable(lines: string[], ids: Map<string, number>): Block | null {
	if (lines.length < 2) return null;
	const cells = (line: string) =>
		line
			.trim()
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split("|")
			.map((cell) => cell.trim());
	const head = cells(lines[0]);
	if (head.length < 2) return null;
	// The second line must be the alignment separator (| --- | --- |).
	if (!/^\|?[\s:|-]+\|[\s:|-]*$/.test(lines[1])) return null;
	const rows = lines.slice(2).map(cells);
	return {
		kind: "table",
		id: uniqueId(ids, `table:${head.join("|")}`),
		head,
		rows,
	};
}

function parseBlocks(markdown: string): Block[] {
	const ids = new Map<string, number>();
	const blocks: Block[] = [];
	const lines = markdown.split("\n");
	let index = 0;
	while (index < lines.length) {
		const trimmed = lines[index].trim();
		if (trimmed === "") {
			index += 1;
			continue;
		}
		const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
		if (heading) {
			blocks.push({
				kind: "heading",
				id: uniqueId(ids, `heading:${heading[2]}`),
				level: heading[1].length as 1 | 2 | 3,
				text: heading[2],
			});
			index += 1;
			continue;
		}
		if (trimmed.startsWith("|")) {
			const tableLines: string[] = [];
			while (index < lines.length && lines[index].trim().startsWith("|")) {
				tableLines.push(lines[index].trim());
				index += 1;
			}
			const table = parseTable(tableLines, ids);
			if (table) {
				blocks.push(table);
				continue;
			}
			// Not a real table — fall through as paragraph text.
			blocks.push({
				kind: "paragraph",
				id: uniqueId(ids, `paragraph:${tableLines.join(" ")}`),
				text: tableLines.join(" "),
			});
			continue;
		}
		const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
		const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
		if (bullet || ordered) {
			const orderedList = Boolean(ordered);
			const items: string[] = [];
			while (index < lines.length) {
				const candidate = lines[index].trim();
				const item =
					/^[-*]\s+(.*)$/.exec(candidate)?.[1] ??
					/^\d+[.)]\s+(.*)$/.exec(candidate)?.[1];
				if (!item) break;
				items.push(item);
				index += 1;
			}
			blocks.push({
				kind: "list",
				id: uniqueId(ids, `list:${orderedList}:${items.join("|")}`),
				ordered: orderedList,
				items,
			});
			continue;
		}
		// Paragraph: consecutive non-empty, non-structural lines.
		const paragraph: string[] = [];
		while (index < lines.length) {
			const candidate = lines[index].trim();
			if (
				candidate === "" ||
				/^#{1,3}\s/.test(candidate) ||
				candidate.startsWith("|") ||
				/^[-*]\s+/.test(candidate) ||
				/^\d+[.)]\s+/.test(candidate)
			) {
				break;
			}
			paragraph.push(candidate);
			index += 1;
		}
		if (paragraph.length > 0) {
			blocks.push({
				kind: "paragraph",
				id: uniqueId(ids, `paragraph:${paragraph.join(" ")}`),
				text: paragraph.join(" "),
			});
		}
	}
	return blocks;
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
	const counts = new Map<string, number>();
	return text.split(INLINE_PATTERN).map((part) => {
		const key = `${keyPrefix}:${part}:${uniqueId(counts, part)}`;
		if (part.startsWith("**") && part.endsWith("**")) {
			return (
				<span key={key} className="font-semibold">
					{part.slice(2, -2)}
				</span>
			);
		}
		if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
			return (
				<code
					key={key}
					className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.85em]"
				>
					{part.slice(1, -1)}
				</code>
			);
		}
		if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
			return (
				<span key={key} className="italic">
					{part.slice(1, -1)}
				</span>
			);
		}
		return part;
	});
}

export function ShareMarkdown({ text }: { text: string }) {
	const blocks = parseBlocks(text);
	if (blocks.length === 0) return null;
	return (
		<div className="space-y-3">
			{blocks.map((block) => {
				if (block.kind === "heading") {
					const sizes = {
						1: "text-lg font-bold",
						2: "text-base font-semibold",
						3: "text-sm font-semibold",
					} as const;
					return (
						<p key={block.id} className={sizes[block.level]}>
							{renderInline(block.text, block.id)}
						</p>
					);
				}
				if (block.kind === "paragraph") {
					return (
						<p key={block.id} className="text-sm leading-relaxed">
							{renderInline(block.text, block.id)}
						</p>
					);
				}
				if (block.kind === "list") {
					const itemIds = new Map<string, number>();
					const items = block.items.map((item) => {
						const itemId = uniqueId(itemIds, item);
						return (
							<li
								key={`li:${block.id}:${itemId}`}
								className="text-sm leading-relaxed"
							>
								{renderInline(item, `li:${block.id}:${itemId}`)}
							</li>
						);
					});
					return block.ordered ? (
						<ol key={block.id} className="list-decimal space-y-1 pl-5">
							{items}
						</ol>
					) : (
						<ul key={block.id} className="list-disc space-y-1 pl-5">
							{items}
						</ul>
					);
				}
				const headIds = new Map<string, number>();
				const rowIds = new Map<string, number>();
				return (
					<div key={block.id} className="overflow-x-auto">
						<table className="w-full border-collapse text-sm">
							<thead>
								<tr>
									{block.head.map((cell) => {
										const cellId = uniqueId(headIds, cell);
										return (
											<th
												key={`th:${block.id}:${cellId}`}
												className="border-b border-gray-300 px-2 py-1.5 text-left font-semibold"
											>
												{renderInline(cell, `th:${block.id}:${cellId}`)}
											</th>
										);
									})}
								</tr>
							</thead>
							<tbody>
								{block.rows.map((row) => {
									const rowId = uniqueId(rowIds, row.join("|"));
									const cellIds = new Map<string, number>();
									return (
										<tr key={`tr:${block.id}:${rowId}`}>
											{row.map((cell) => {
												const cellId = uniqueId(cellIds, cell);
												return (
													<td
														key={`td:${block.id}:${rowId}:${cellId}`}
														className="border-b border-gray-100 px-2 py-1.5"
													>
														{renderInline(
															cell,
															`td:${block.id}:${rowId}:${cellId}`,
														)}
													</td>
												);
											})}
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				);
			})}
		</div>
	);
}
