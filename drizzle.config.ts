import type { Config } from "drizzle-kit";

export default {
  schema: "./src/infrastructure/schema/drizzle",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL || "file:books.sqlite",
  },
  verbose: true,
  strict: true,
} satisfies Config;
