CREATE TABLE IF NOT EXISTS `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`code` text NOT NULL,
	`severity` text DEFAULT 'P2' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`title` text NOT NULL,
	`impact` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`temporary_action` text DEFAULT '' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `incidents_team_code_unique` ON `incidents` (`team_id`,`code`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `incidents_team_id_idx` ON `incidents` (`team_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `incidents_team_status_idx` ON `incidents` (`team_id`,`status`);
