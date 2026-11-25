export function relativeTime(iso: string): string {
	const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

// One shared formatter so timestamps render identically across the admin UI
// (toLocaleString varies by browser/locale and runs wide on mobile).
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
});

export function formatDateTime(iso: string): string {
	const date = new Date(iso);
	// Invalid input used to render the harmless "Invalid Date"; keep a
	// graceful fallback instead of Intl's RangeError.
	return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}

export function formatBytes(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
