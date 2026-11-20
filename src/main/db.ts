import { DatabaseSync } from 'node:sqlite'

/**
 * SQLite dùng module có sẵn `node:sqlite` của Node/Electron → không cần biên dịch module
 * native trên Windows. Mỗi phần tử trong MIGRATIONS là một phiên bản schema; phiên bản
 * hiện tại lưu ở `PRAGMA user_version`. Chỉ được THÊM migration mới, không sửa cái cũ.
 */
const MIGRATIONS: string[] = [
  // 1: nền tảng
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE games (
    id              INTEGER PRIMARY KEY,
    source          TEXT NOT NULL CHECK (source IN ('pgn','chesscom','lichess')),
    source_id       TEXT,
    white           TEXT NOT NULL,
    black           TEXT NOT NULL,
    white_elo       INTEGER,
    black_elo       INTEGER,
    result          TEXT NOT NULL,
    termination     TEXT,
    played_at       INTEGER,
    time_control    TEXT,
    speed           TEXT,
    eco             TEXT,
    opening_name    TEXT,
    user_color      TEXT CHECK (user_color IN ('w','b')),
    user_result     TEXT CHECK (user_result IN ('win','draw','loss')),
    pgn             TEXT NOT NULL,
    analysis_status TEXT NOT NULL DEFAULT 'none',
    white_accuracy  REAL,
    black_accuracy  REAL,
    created_at      INTEGER NOT NULL,
    UNIQUE (source, source_id)
  );
  CREATE INDEX idx_games_played_at ON games(played_at DESC);
  CREATE INDEX idx_games_user      ON games(user_color, user_result);
  CREATE INDEX idx_games_opening   ON games(eco, opening_name);
  CREATE INDEX idx_games_white     ON games(white COLLATE NOCASE);
  CREATE INDEX idx_games_black     ON games(black COLLATE NOCASE);

  CREATE TABLE moves (
    game_id        INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    ply            INTEGER NOT NULL,
    san            TEXT NOT NULL,
    uci            TEXT NOT NULL,
    fen_before     TEXT NOT NULL,
    color          TEXT NOT NULL,
    win_before     REAL,
    win_after      REAL,
    accuracy       REAL,
    classification TEXT,
    best_uci       TEXT,
    best_san       TEXT,
    phase          TEXT,
    clock_ms       INTEGER,
    tactics        TEXT,
    depth          INTEGER,
    PRIMARY KEY (game_id, ply)
  ) WITHOUT ROWID;
  CREATE INDEX idx_moves_class ON moves(classification);

  -- Mỗi vị trí chỉ giữ một kết quả: kết quả sâu nhất (xem EvalCache).
  CREATE TABLE position_cache (
    fen        TEXT PRIMARY KEY,
    multipv    INTEGER NOT NULL,
    depth      INTEGER NOT NULL,
    lines      TEXT NOT NULL,
    best_move  TEXT,
    updated_at INTEGER NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE explanations_cache (
    key            TEXT PRIMARY KEY,
    kind           TEXT NOT NULL,
    model          TEXT NOT NULL,
    prompt_version INTEGER NOT NULL,
    response       TEXT NOT NULL,
    warnings       TEXT,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE tablebase_cache (
    fen        TEXT PRIMARY KEY,
    response   TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE puzzles (
    id            INTEGER PRIMARY KEY,
    game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    ply           INTEGER NOT NULL,
    fen           TEXT NOT NULL,
    solution      TEXT NOT NULL,
    motifs        TEXT NOT NULL,
    source_class  TEXT NOT NULL,
    ease          REAL NOT NULL DEFAULT 2.5,
    interval_days REAL NOT NULL DEFAULT 0,
    repetitions   INTEGER NOT NULL DEFAULT 0,
    due_at        INTEGER NOT NULL,
    last_result   TEXT,
    UNIQUE (game_id, ply)
  );
  CREATE INDEX idx_puzzles_due ON puzzles(due_at);

  CREATE TABLE repertoire_nodes (
    id        INTEGER PRIMARY KEY,
    color     TEXT NOT NULL CHECK (color IN ('w','b')),
    parent_id INTEGER REFERENCES repertoire_nodes(id) ON DELETE CASCADE,
    fen       TEXT NOT NULL,
    uci       TEXT,
    san       TEXT,
    comment   TEXT,
    UNIQUE (color, parent_id, uci)
  );
  CREATE INDEX idx_rep_fen ON repertoire_nodes(color, fen);
  `,
  // 2: repertoire tra theo vị trí TRƯỚC nước đi (để khớp transposition khi kiểm tra lệch)
  `
  ALTER TABLE repertoire_nodes ADD COLUMN parent_fen TEXT NOT NULL DEFAULT '';
  CREATE INDEX idx_rep_parent ON repertoire_nodes(color, parent_fen);
  CREATE INDEX idx_moves_game_color ON moves(game_id, color);
  `
]

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
  migrate(db)
  return db
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

/** Chạy fn trong một transaction (ghi gộp nhiều dòng nhanh hơn nhiều so với từng dòng). */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const r = fn()
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
