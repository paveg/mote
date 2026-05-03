import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import * as v from "valibot";

const EntrySchema = v.object({
  userId: v.number(),
  approvedAt: v.number(),
  note: v.optional(v.string()),
});
const FileSchema = v.object({
  version: v.literal(1),
  approved: v.array(EntrySchema),
});

export type AllowlistEntry = v.InferOutput<typeof EntrySchema>;

export interface Allowlist {
  has(userId: number): boolean;
  add(entry: AllowlistEntry): Promise<void>;
  remove(userId: number): Promise<void>;
  list(): readonly AllowlistEntry[];
}

export async function loadAllowlist(filePath: string): Promise<Allowlist> {
  let entries: AllowlistEntry[] = [];
  try {
    const raw = await readFile(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`malformed allowlist file at ${filePath}: ${(err as Error).message}`);
    }
    const result = v.safeParse(FileSchema, parsed);
    if (!result.success) {
      throw new Error(`malformed allowlist file at ${filePath}: schema validation failed`);
    }
    entries = [...result.output.approved];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // file missing → empty allowlist, fall through
    } else {
      throw err;
    }
  }

  const persist = async (): Promise<void> => {
    const tmp = `${filePath}.tmp`;
    const body = JSON.stringify({ version: 1, approved: entries }, null, 2);
    await writeFile(tmp, body, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, filePath);
  };

  return {
    has: (userId) => entries.some((e) => e.userId === userId),
    add: async (entry) => {
      entries = entries.filter((e) => e.userId !== entry.userId).concat(entry);
      await persist();
    },
    remove: async (userId) => {
      const next = entries.filter((e) => e.userId !== userId);
      if (next.length === entries.length) return;
      entries = next;
      await persist();
    },
    list: () => entries,
  };
}
