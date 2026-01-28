/**
 * Base Repository
 * Abstract repository pattern for data access
 */

import type { Database } from "bun:sqlite";
import { getDatabase } from "../infra/storage/database.ts";
import { NotFoundError } from "../errors/index.ts";

/**
 * Base entity interface - all entities must have an id
 */
export interface BaseEntity {
  id: string;
}

/**
 * Query options for listing
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: "ASC" | "DESC";
}

/**
 * Abstract base repository
 */
export abstract class BaseRepository<T extends BaseEntity> {
  protected db: Database;
  protected tableName: string;
  protected entityName: string;

  constructor(tableName: string, entityName: string, db?: Database) {
    this.db = db || getDatabase();
    this.tableName = tableName;
    this.entityName = entityName;
  }

  /**
   * Convert database row to entity
   * Override in subclass for custom mapping
   */
  protected abstract rowToEntity(row: Record<string, unknown>): T;

  /**
   * Convert entity to database row
   * Override in subclass for custom mapping
   */
  protected abstract entityToRow(entity: T): Record<string, unknown>;

  /**
   * Find entity by ID
   */
  findById(id: string): T | null {
    const stmt = this.db.prepare(`SELECT * FROM ${this.tableName} WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | null;

    if (!row) {
      return null;
    }

    return this.rowToEntity(row);
  }

  /**
   * Find entity by ID or throw
   */
  findByIdOrThrow(id: string): T {
    const entity = this.findById(id);
    if (!entity) {
      throw new NotFoundError(this.entityName, id);
    }
    return entity;
  }

  /**
   * Find all entities
   */
  findAll(options: QueryOptions = {}): T[] {
    const { limit, offset, orderBy, orderDir = "DESC" } = options;

    let query = `SELECT * FROM ${this.tableName}`;

    if (orderBy) {
      query += ` ORDER BY ${orderBy} ${orderDir}`;
    }

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    if (offset) {
      query += ` OFFSET ${offset}`;
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Find entities matching criteria
   */
  findWhere(
    criteria: Partial<Record<keyof T, unknown>>,
    options: QueryOptions = {}
  ): T[] {
    const keys = Object.keys(criteria).filter((k) => criteria[k as keyof T] !== undefined);

    if (keys.length === 0) {
      return this.findAll(options);
    }

    const conditions = keys.map((k) => `${k} = ?`).join(" AND ");
    const values = keys.map((k) => criteria[k as keyof T]) as (string | number | boolean | null)[];

    let query = `SELECT * FROM ${this.tableName} WHERE ${conditions}`;

    const { limit, offset, orderBy, orderDir = "DESC" } = options;

    if (orderBy) {
      query += ` ORDER BY ${orderBy} ${orderDir}`;
    }

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    if (offset) {
      query += ` OFFSET ${offset}`;
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...values) as Record<string, unknown>[];

    return rows.map((row) => this.rowToEntity(row));
  }

  /**
   * Create a new entity
   */
  create(entity: T): T {
    const row = this.entityToRow(entity);
    const keys = Object.keys(row);
    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((k) => row[k]) as (string | number | boolean | null)[];

    const query = `INSERT INTO ${this.tableName} (${keys.join(", ")}) VALUES (${placeholders})`;
    const stmt = this.db.prepare(query);
    stmt.run(...values);

    return entity;
  }

  /**
   * Update an existing entity
   */
  update(id: string, updates: Partial<T>): T {
    const existing = this.findByIdOrThrow(id);
    const updated = { ...existing, ...updates };
    const row = this.entityToRow(updated);

    const keys = Object.keys(row).filter((k) => k !== "id");
    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    const values = [...keys.map((k) => row[k]), id] as (string | number | boolean | null)[];

    const query = `UPDATE ${this.tableName} SET ${setClause} WHERE id = ?`;
    const stmt = this.db.prepare(query);
    stmt.run(...values);

    return updated;
  }

  /**
   * Delete an entity
   */
  delete(id: string): boolean {
    const stmt = this.db.prepare(`DELETE FROM ${this.tableName} WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Check if entity exists
   */
  exists(id: string): boolean {
    const stmt = this.db.prepare(`SELECT 1 FROM ${this.tableName} WHERE id = ? LIMIT 1`);
    const row = stmt.get(id);
    return row !== null;
  }

  /**
   * Count entities
   */
  count(criteria?: Partial<Record<keyof T, unknown>>): number {
    if (!criteria || Object.keys(criteria).length === 0) {
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName}`);
      const row = stmt.get() as { count: number };
      return row.count;
    }

    const keys = Object.keys(criteria).filter((k) => criteria[k as keyof T] !== undefined);
    const conditions = keys.map((k) => `${k} = ?`).join(" AND ");
    const values = keys.map((k) => criteria[k as keyof T]) as (string | number | boolean | null)[];

    const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${conditions}`);
    const row = stmt.get(...values) as { count: number };
    return row.count;
  }
}
