import bcrypt from 'bcryptjs';
import { pool } from './db.js';

const accounts = [
  ['Admin', 'TAKARDATA', 'admin@takardata.com', '+22700000000', 'Admin123!', 'admin'],
  ['Opérateur', 'TAKARDATA', 'entreprise@takardata.com', '+22700000001', 'Entreprise123!', 'entreprise']
];

try {
  for (const [firstName,lastName,email,phone,password,role] of accounts) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(`
      INSERT INTO users(first_name,last_name,email,phone,password_hash,role)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(email) DO UPDATE SET first_name=EXCLUDED.first_name,last_name=EXCLUDED.last_name,phone=EXCLUDED.phone,role=EXCLUDED.role
    `,[firstName,lastName,email,phone,hash,role]);
  }

  const mairie = await pool.query(`SELECT id FROM mairies WHERE name='Mairie d’Agadez' LIMIT 1`);
  const mairieId = mairie.rows[0]?.id;
  if (mairieId) {
    const hash = await bcrypt.hash('Mairie123!', 12);
    await pool.query(`
      INSERT INTO users(first_name,last_name,email,phone,password_hash,role,mairie_id,must_change_password,password_expires_at)
      VALUES('Mairie','Agadez','mairie@agadez.ne','+22700000002',$1,'mairie',$2,TRUE,NOW())
      ON CONFLICT(email) DO UPDATE SET mairie_id=EXCLUDED.mairie_id,role='mairie'
    `,[hash,mairieId]);
  }
  console.log('Seed terminé.');
} catch (err) {
  console.error('Erreur seed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
