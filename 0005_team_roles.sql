CREATE TABLE IF NOT EXISTS `team_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`permissions` text DEFAULT '[]' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `team_roles_team_code_unique` ON `team_roles` (`team_id`,`code`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `team_roles_team_id_idx` ON `team_roles` (`team_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `team_roles` (`id`, `team_id`, `code`, `name`, `description`, `permissions`, `is_system`, `is_active`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `id`, 'owner', '团队母账号', '管理团队、成员、项目状态和全部项目。', '["project.view","project.create","project.edit","project.archive","team.manage"]', 1, 1, `created_at`, `updated_at`
FROM `teams`;
--> statement-breakpoint
INSERT OR IGNORE INTO `team_roles` (`id`, `team_id`, `code`, `name`, `description`, `permissions`, `is_system`, `is_active`, `created_at`, `updated_at`)
SELECT lower(hex(randomblob(16))), `id`, 'member', '团队成员', '查看、创建和编辑当前团队项目。', '["project.view","project.create","project.edit"]', 1, 1, `created_at`, `updated_at`
FROM `teams`;
