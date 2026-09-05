---
name: data-model
description: Design a relational data model - entities, relationships, keys, constraints, indexes, and the migration path to get there - for MySQL on cPanel. Use before writing schema-touching code, and when an existing model is fighting the features it needs to support.
---

# Design the data model

The data model outlives the code by years. Code gets rewritten; the data it wrote persists, and a bad shape becomes a migration you dread. Spend the thinking here.

## Get the shape right first

- **One fact, one place.** If the same value is stored in two rows, they will disagree. Normalise until each fact has a single home — then denormalise deliberately, with a written reason, only where a measured read cost demands it. Premature denormalisation is how data goes inconsistent.
- **Model the relationships honestly.** One-to-many is a foreign key; many-to-many is a join table; one-to-one usually means it should have been one table. Draw it before you type it — a wrong relationship is the expensive mistake.
- **Every table has a primary key**, and prefer a surrogate key (an auto-increment or UUID) over a natural one — natural keys (email, slug) change, and a changing primary key cascades pain through every referencing row.

## Make the database enforce what must be true

The application will have bugs; the database is the last line that keeps the data sane:

- `NOT NULL` on everything that must have a value. Nullable-by-default is how empty strings and nulls end up meaning the same thing three different ways.
- `FOREIGN KEY` constraints with deliberate `ON DELETE` behaviour — `CASCADE`, `SET NULL` or `RESTRICT` is a real decision about what happens to the children, not a default to accept blindly.
- `UNIQUE` on anything that must be unique (email, slug), because the application's "check then insert" has a race and the constraint does not.
- `CHECK` constraints for value rules where the MySQL/MariaDB version supports them.
- Pick the tightest type: `INT` not `BIGINT` unless you need the range, `DECIMAL` for money **never** float, `DATETIME`/`TIMESTAMP` with an explicit timezone story, `VARCHAR` sized to the real content.

## Index for the queries you will actually run

- Index foreign keys and the columns you filter and sort on. An index on a column nothing queries is pure write-cost.
- The order of columns in a composite index matters — it serves queries that filter left-to-right.
- On shared hosting you cannot lean on a big buffer pool or read replicas. A missing index that "works fine" on your empty dev database is a table scan that times out at 100k rows on the host. Check with `EXPLAIN`, not by feel.
- Do not index everything "to be safe" — every index slows writes and eats the disk and inode quota you are already short on.

## The migration path is part of the design

A model is not done until you know how to *get to it* from what exists:

- Forward-only, numbered, committed migrations. Each idempotent enough to survive being half-applied.
- Adding a `NOT NULL` column to a populated table needs a default or a backfill — a bare `ADD COLUMN NOT NULL` fails on existing rows.
- **Expand / migrate / contract** for anything with data in it: add the new shape, move the data, switch the code, drop the old shape in a *later* release. A single migration that renames a column in use is an outage.
- Big `ALTER TABLE` locks the table on shared MySQL and may blow the host's query timeout. Check the row count first; over a few hundred thousand rows, chunk it or schedule it off-peak.

Hand the migrations and the dump-before-you-touch discipline to `db-steward` — it owns execution and recovery. This skill decides the shape; `db-steward` makes the change safely.

## cPanel specifics

- Database and user names carry the account prefix and a length cap (`demousr_app`, not `app`) — create them via `cpanel_uapi module=Mysql` so the prefix is applied and use the name the API returns.
- Test migrations on the staging database first (`db-sync` seeds it from a scrubbed production copy), never straight onto production.

## What you produce

An entity-relationship sketch (a mermaid `erDiagram` reads well and lives in the repo), the `CREATE TABLE` statements or the ORM models to match, and the numbered migrations to get from the current schema to the new one. State explicitly any place you denormalised and why, so the next person does not "fix" it back.
