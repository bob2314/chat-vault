import { PostgresSearchProvider } from "@/lib/search/postgres-provider";
import { SqliteSearchProvider } from "@/lib/search/sqlite-provider";
import { TypesenseSearchProvider } from "@/lib/search/typesense-provider";

export function getSearchProvider() {
  const defaultProvider = (process.env.DB_PROVIDER || "sqlite").toLowerCase() === "postgres" ? "postgres" : "sqlite";
  const provider = (process.env.SEARCH_PROVIDER || defaultProvider).toLowerCase();
  if (provider === "typesense") {
    return new TypesenseSearchProvider();
  }
  if (provider === "postgres") {
    return new PostgresSearchProvider();
  }
  return new SqliteSearchProvider();
}
