ALTER TABLE `project_statuses` ADD `code` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `project_statuses_team_code_unique` ON `project_statuses` (`team_id`,`code`);--> statement-breakpoint
ALTER TABLE `projects` ADD `blockers` text DEFAULT '[]' NOT NULL;