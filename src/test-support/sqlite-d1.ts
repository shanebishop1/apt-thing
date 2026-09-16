import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1DatabaseLike } from "../lib/shared-listing-store";

const migrationsDirectory = new URL("../../migrations/", import.meta.url);

export type SqliteD1 = D1DatabaseLike & {
  sqlite: DatabaseSync;
  close(): void;
};

/**
 * D1-shaped adapter over node:sqlite for tests. Every statement method is async so
 * concurrent callers interleave at the same await points they would against D1.
 */
export function createSqliteD1({ migrate = true }: { migrate?: boolean } = {}): SqliteD1 {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  if (migrate) applyMigrations(sqlite);

  const prepare = (query: string) => createStatement(sqlite, query, []);

  return {
    sqlite,
    prepare,
    async batch(statements) {
      const results: unknown[] = [];
      sqlite.exec("BEGIN");
      try {
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      return results;
    },
    close: () => sqlite.close(),
  };
}

export function applyMigrations(sqlite: DatabaseSync, { through }: { through?: string } = {}) {
  const files = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (through && file > through) break;
    sqlite.exec(readFileSync(new URL(file, migrationsDirectory), "utf8"));
  }
}

type Statement = ReturnType<D1DatabaseLike["prepare"]>;

function createStatement(sqlite: DatabaseSync, query: string, values: SQLInputValue[]): Statement {
  return {
    bind: (...nextValues) => createStatement(sqlite, query, nextValues.map(toSqliteValue)),
    async first<T>() {
      await Promise.resolve();
      return (sqlite.prepare(query).get(...values) as T | undefined) ?? null;
    },
    async all<T>() {
      await Promise.resolve();
      return { results: sqlite.prepare(query).all(...values) as T[] };
    },
    async run() {
      await Promise.resolve();
      const result = sqlite.prepare(query).run(...values);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  };
}

function toSqliteValue(value: unknown): SQLInputValue {
  if (value === undefined) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  return value as SQLInputValue;
}
