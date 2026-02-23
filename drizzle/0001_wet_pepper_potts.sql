CREATE TABLE `job_origins` (
	`job_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`platform` text NOT NULL,
	`created_at` integer NOT NULL
);
