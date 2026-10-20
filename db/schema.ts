import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
export const feedCache = sqliteTable("feed_cache", {
  key: text("key").primaryKey(),
  body: text("body").notNull(),
  expires: integer("expires").notNull(),
});
export const dominance = sqliteTable("dominance", {
  time: integer("time").primaryKey(),
  source: text("source").notNull().default("CoinGecko"),
  btc: real("btc").notNull(),
  usdt: real("usdt").notNull(),
});
