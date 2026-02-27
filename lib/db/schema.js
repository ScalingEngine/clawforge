import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').notNull().default('admin'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull().default('New Chat'),
  starred: integer('starred').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  chatId: text('chat_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  notification: text('notification').notNull(),
  payload: text('payload').notNull(),
  read: integer('read').notNull().default(0),
  createdAt: integer('created_at').notNull(),
});

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  platform: text('platform').notNull(),
  channelId: text('channel_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const jobOrigins = sqliteTable('job_origins', {
  jobId: text('job_id').primaryKey(),
  threadId: text('thread_id').notNull(),
  platform: text('platform').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const jobOutcomes = sqliteTable('job_outcomes', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  threadId: text('thread_id').notNull(),
  status: text('status').notNull(),
  mergeResult: text('merge_result').notNull(),
  prUrl: text('pr_url').notNull().default(''),
  targetRepo: text('target_repo'),  // nullable — no .notNull(), no .default() — null for same-repo jobs
  changedFiles: text('changed_files').notNull().default('[]'),
  logSummary: text('log_summary').notNull().default(''),
  createdAt: integer('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  createdBy: text('created_by'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});
