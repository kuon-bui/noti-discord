CREATE TABLE `checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_id` integer NOT NULL,
	`checked_at` text NOT NULL,
	`status` text NOT NULL,
	`http_status` integer,
	`latency_ms` integer,
	`error` text,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_checks_target_time` ON `checks` (`target_id`,`checked_at`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_id` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`reason` text,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_incidents_target_time` ON `incidents` (`target_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`method` text DEFAULT 'GET' NOT NULL,
	`expected_status` text DEFAULT '200-299' NOT NULL,
	`latency_threshold_ms` integer,
	`interval_seconds` integer NOT NULL,
	`timeout_ms` integer NOT NULL,
	`alert_channel_id` text,
	`paused_until` text,
	`current_status` text DEFAULT 'UNKNOWN' NOT NULL,
	`last_checked_at` text,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `targets_name_unique` ON `targets` (`name`);