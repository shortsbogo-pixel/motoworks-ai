ALTER TABLE `vehicles` ADD `plate_digits_hash` text;--> statement-breakpoint
CREATE INDEX `vehicles_plate_digits_idx` ON `vehicles` (`organization_id`,`plate_digits_hash`);--> statement-breakpoint
CREATE TABLE `security_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`window_start` integer NOT NULL,
	`consecutive_no_match` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);