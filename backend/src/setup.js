import fs from 'fs';
import { pool } from './db.js';

try {
  const sql = fs.readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Base TAKARDATA initialisée / mise à jour.');
} catch (err) {
  console.error('Erreur setup:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
