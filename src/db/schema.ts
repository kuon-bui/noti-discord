import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const targets = sqliteTable('targets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  url: text('url').notNull(),
  method: text('method').notNull().default('GET'),
  expectedStatus: text('expected_status').notNull().default('200-299'),
  latencyThresholdMs: integer('latency_threshold_ms'),
  intervalSeconds: integer('interval_seconds').notNull(),
  timeoutMs: integer('timeout_ms').notNull(),
  pausedUntil: text('paused_until'),
  currentStatus: text('current_status').notNull().default('UNKNOWN'),
  lastCheckedAt: text('last_checked_at'),
  createdAt: text('created_at').notNull(),
  createdBy: text('created_by').notNull(),
})

export const destinations = sqliteTable(
  'destinations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    targetId: integer('target_id').references(() => targets.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    address: text('address').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_destinations_target').on(t.targetId, t.provider),
    // Chỉ chặn được trùng khi target_id NOT NULL — SQLite coi các NULL là khác nhau.
    // Row toàn cục được chống trùng ở tầng repo.
    uniqueIndex('idx_destinations_unique').on(t.targetId, t.provider, t.address),
  ],
)

export const checks = sqliteTable(
  'checks',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    targetId: integer('target_id')
      .notNull()
      .references(() => targets.id, { onDelete: 'cascade' }),
    checkedAt: text('checked_at').notNull(),
    status: text('status').notNull(),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms'),
    error: text('error'),
  },
  (t) => [index('idx_checks_target_time').on(t.targetId, t.checkedAt)],
)

export const incidents = sqliteTable(
  'incidents',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    targetId: integer('target_id')
      .notNull()
      .references(() => targets.id, { onDelete: 'cascade' }),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),
    reason: text('reason'),
  },
  (t) => [index('idx_incidents_target_time').on(t.targetId, t.startedAt)],
)

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})
