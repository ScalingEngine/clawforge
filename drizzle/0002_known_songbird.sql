CREATE TABLE `job_outcomes` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`status` text NOT NULL,
	`merge_result` text NOT NULL,
	`pr_url` text DEFAULT '' NOT NULL,
	`changed_files` text DEFAULT '[]' NOT NULL,
	`log_summary` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
