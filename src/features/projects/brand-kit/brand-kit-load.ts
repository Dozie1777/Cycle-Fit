// Server-side brand-kit loader shared by the prompt-injection call sites
// (design chat, KUK-898; campaign asset seeding, KUK-899): one place for
// the include shape so every consumer threads the same rows. The db import
// is type-only — no runtime dependency — so unit tests can stub the client.
import type { BrandKitLike } from "./brand-kit";

type PrismaDb = ReturnType<typeof import("@/lib/db")["getPrisma"]>;

/**
 * The brand kit of `projectId` with its palettes/colors, typography roles
 * and fonts (the same include shape the brand-kits API returns), or null
 * when the project has none. Rows satisfy BrandKitLike structurally.
 */
export async function loadBrandKit(
	prisma: PrismaDb,
	projectId: string,
): Promise<BrandKitLike | null> {
	return prisma.brandKit.findUnique({
		where: { projectId },
		include: {
			palettes: {
				orderBy: { mode: "asc" },
				include: { colors: { orderBy: { role: "asc" } } },
			},
			typography: { orderBy: { role: "asc" } },
			fonts: { orderBy: { createdAt: "asc" } },
		},
	});
}
