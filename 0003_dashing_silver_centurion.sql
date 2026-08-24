ALTER TABLE `projects` ADD `category` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `priority` text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `progress_percent` integer DEFAULT 0 NOT NULL;