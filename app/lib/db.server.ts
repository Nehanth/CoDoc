import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/** Local SQL for login accounts. Doctors are seeded; patients register on
 *  first login (any patient that exists in Medplum can sign in by name). */
let db: DatabaseSync | null = null;

export type Account = {
  id: number;
  username: string;
  role: "pcp" | "specialist" | "patient";
  display_name: string;
  patient_name: string | null;
};

function getDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(path.join(process.cwd(), "codoc.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('pcp','specialist','patient')),
      display_name TEXT NOT NULL,
      patient_name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT OR IGNORE INTO accounts (username, password, role, display_name) VALUES (?, ?, ?, ?)`,
  ).run("pcp", "pcp", "pcp", "PCP");
  db.prepare(
    `INSERT OR IGNORE INTO accounts (username, password, role, display_name) VALUES (?, ?, ?, ?)`,
  ).run("specialist", "specialist", "specialist", "Specialist");
  return db;
}

export function findAccount(username: string, password: string): Account | null {
  const row = getDb()
    .prepare(`SELECT id, username, role, display_name, patient_name FROM accounts WHERE username = ? AND password = ?`)
    .get(username, password) as Account | undefined;
  return row ?? null;
}

export function usernameTaken(username: string): boolean {
  return Boolean(
    getDb().prepare(`SELECT 1 FROM accounts WHERE username = ?`).get(username),
  );
}

export function registerPatient(
  username: string,
  password: string,
  patientName: string,
): Account {
  const d = getDb();
  d.prepare(
    `INSERT INTO accounts (username, password, role, display_name, patient_name) VALUES (?, ?, 'patient', ?, ?)`,
  ).run(username, password, patientName, patientName);
  return d
    .prepare(`SELECT id, username, role, display_name, patient_name FROM accounts WHERE username = ?`)
    .get(username) as Account;
}
