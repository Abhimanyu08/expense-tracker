ALTER TABLE `screenshots` ADD `parse_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `screenshots` ADD `parse_status_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `screenshots` ADD `parse_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `screenshots` ADD `parse_error` text;--> statement-breakpoint
CREATE INDEX `screenshots_parse_idx` ON `screenshots` (`parse_status`,`parse_status_at`);