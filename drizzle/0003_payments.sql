CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`payee` text,
	`notes` text,
	`paid_at` integer NOT NULL,
	`screenshot_id` text,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`screenshot_id`) REFERENCES `screenshots`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_screenshot_id_unique` ON `payments` (`screenshot_id`);--> statement-breakpoint
CREATE INDEX `payments_user_paid_idx` ON `payments` (`user_id`,`paid_at`);