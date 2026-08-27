CREATE TABLE `messenger_identities` (
	`psid` text PRIMARY KEY NOT NULL,
	`discord_user_id` text,
	`is_admin` integer DEFAULT 0 NOT NULL,
	`last_inbound_at` text,
	`linked_at` text
);
--> statement-breakpoint
CREATE TABLE `messenger_link_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `messenger_seen_mids` (
	`mid` text PRIMARY KEY NOT NULL,
	`seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_messenger_seen_mids_time` ON `messenger_seen_mids` (`seen_at`);