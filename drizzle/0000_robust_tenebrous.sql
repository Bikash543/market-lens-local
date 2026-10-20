CREATE TABLE `dominance` (
	`time` integer PRIMARY KEY NOT NULL,
	`btc` real NOT NULL,
	`usdt` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feed_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`expires` integer NOT NULL
);
