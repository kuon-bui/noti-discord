CREATE TABLE `destinations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_id` integer,
	`provider` text NOT NULL,
	`address` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `targets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_destinations_target` ON `destinations` (`target_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_destinations_unique` ON `destinations` (`target_id`,`provider`,`address`);