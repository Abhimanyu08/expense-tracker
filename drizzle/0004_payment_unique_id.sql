ALTER TABLE `payments` ADD `unique_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_user_unique_idx` ON `payments` (`user_id`,`unique_id`);