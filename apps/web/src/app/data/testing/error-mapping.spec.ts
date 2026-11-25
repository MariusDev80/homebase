import Database from 'better-sqlite3';
import { DataError } from '../data-error';
import { toDataError } from './error-mapping';

function realError(setup: string, failing: string): unknown {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(setup);
    db.exec(failing);
  } catch (e) {
    return e;
  } finally {
    db.close();
  }
  throw new Error('statement was expected to fail');
}

describe('toDataError', () => {
  it('maps a duplicate primary key to conflict', () => {
    const e = realError(
      'CREATE TABLE t (id TEXT PRIMARY KEY); INSERT INTO t VALUES (1);',
      'INSERT INTO t VALUES (1)',
    );
    expect(toDataError(e).kind).toBe('conflict');
  });

  it('maps a UNIQUE violation to conflict', () => {
    const e = realError(
      'CREATE TABLE t (a TEXT UNIQUE); INSERT INTO t VALUES (1);',
      'INSERT INTO t VALUES (1)',
    );
    expect(toDataError(e).kind).toBe('conflict');
  });

  it('maps a missing foreign key to constraint', () => {
    const e = realError(
      'CREATE TABLE p (id TEXT PRIMARY KEY); CREATE TABLE c (p TEXT REFERENCES p(id));',
      "INSERT INTO c VALUES ('x')",
    );
    expect(toDataError(e).kind).toBe('constraint');
  });

  it('maps a CHECK failure to constraint', () => {
    const e = realError('CREATE TABLE t (a INTEGER CHECK (a > 0));', 'INSERT INTO t VALUES (0)');
    expect(toDataError(e).kind).toBe('constraint');
  });

  it('maps a NOT NULL failure to constraint', () => {
    const e = realError('CREATE TABLE t (a TEXT NOT NULL);', 'INSERT INTO t VALUES (NULL)');
    expect(toDataError(e).kind).toBe('constraint');
  });

  it('maps a STRICT type failure to constraint', () => {
    const e = realError('CREATE TABLE t (a INTEGER) STRICT;', "INSERT INTO t VALUES ('abc')");
    expect(toDataError(e).kind).toBe('constraint');
  });

  it('maps busy and not-loaded messages', () => {
    expect(toDataError(new Error('database is locked')).kind).toBe('busy');
    expect(toDataError('database is busy').kind).toBe('busy');
    expect(toDataError('database sqlite:homebase.db not loaded').kind).toBe('unavailable');
  });

  it('falls back to unknown for raw strings and unknown objects', () => {
    expect(toDataError('something odd').kind).toBe('unknown');
    expect(toDataError({ weird: true }).kind).toBe('unknown');
  });

  it('returns an existing DataError unchanged and keeps the cause', () => {
    const original = new DataError('forbidden', 'nope');
    expect(toDataError(original)).toBe(original);
    const cause = new Error('UNIQUE constraint failed: t.a');
    expect(toDataError(cause).cause).toBe(cause);
  });
});
