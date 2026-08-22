CREATE TABLE `link_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `telegram_albums` (
	`media_group_id` text PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`message_id` integer,
	`count` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `telegram_updates` (
	`update_id` integer PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `screenshots` ADD `width` integer;--> statement-breakpoint
ALTER TABLE `screenshots` ADD `height` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `telegram_chat_id` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `telegram_username` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_telegram_chat_id_unique` ON `users` (`telegram_chat_id`);