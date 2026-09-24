import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db.js';
import { auth, passwordGuard, roles } from '../middleware.js';

const router=express.Router();
router.use(auth,passwordGuard);

router.get('/dashboard',roles('admin','entreprise','mairie'),async(req,res,next)=>{try{
  const args=[];let where='';
  if(req.user.role==='mairie'){args.push(req.user.mairie_id);where='WHERE mairie_id=$1';}
  const [users,requests,validated,ready]=await Promise.all([
    pool.query(req.user.role==='mairie'?`SELECT COUNT(*)::int n FROM users WHERE role='citoyen' AND id IN (SELECT citizen_id FROM requests WHERE mairie_id=$1)`:`SELECT COUNT(*)::int n FROM users`,args),
    pool.query(`SELECT COUNT(*)::int n FROM requests ${where}`,args),
    pool.query(`SELECT COUNT(*)::int n FROM requests ${where?where+' AND':'WHERE'} status IN ('valide_takardata','pret_a_telecharger')`,args),
    pool.query(`SELECT COUNT(*)::int n FROM requests ${where?where+' AND':'WHERE'} status='pret_a_telecharger'`,args)
  ]);
  res.json({users:users.rows[0].n,requests:requests.rows[0].n,validated:validated.rows[0].n,ready:ready.rows[0].n});
}catch(e){next(e);}});

router.get('/mairies/public',async(req,res,next)=>{try{const r=await pool.query(`SELECT id,name,city,region FROM mairies WHERE active=TRUE ORDER BY name`);res.json(r.rows);}catch(e){next(e);}});
router.get('/mairies',roles('admin','entreprise'),async(req,res,next)=>{try{const r=await pool.query(`SELECT m.*,u.email FROM mairies m LEFT JOIN users u ON u.mairie_id=m.id AND u.role='mairie' ORDER BY m.region,m.city,m.name`);res.json(r.rows);}catch(e){next(e);}});

router.post('/mairies',roles('admin','entreprise'),async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const {name,city,region,email,firstName='Mairie',lastName=city||'Compte'}=req.body;
    if(!name||!city||!region||!email)return res.status(400).json({message:'Nom, ville, région et email sont obligatoires.'});
    const exists=await client.query('SELECT id FROM users WHERE email=$1',[email.toLowerCase().trim()]);if(exists.rows[0])return res.status(409).json({message:'Cet email est déjà utilisé.'});
    const temp='TKD-'+crypto.randomBytes(4).toString('hex')+'!';
    await client.query('BEGIN');
    await client.query(`INSERT INTO regions(name) VALUES($1) ON CONFLICT(name) DO NOTHING`,[region]);
    const rr=await client.query('SELECT id FROM regions WHERE name=$1',[region]);
    await client.query(`INSERT INTO communes(name,region_id) VALUES($1,$2) ON CONFLICT(name,region_id) DO NOTHING`,[city,rr.rows[0].id]);
    const cc=await client.query('SELECT id FROM communes WHERE name=$1 AND region_id=$2',[city,rr.rows[0].id]);
    const mr=await client.query(`INSERT INTO mairies(name,city,region,commune_id) VALUES($1,$2,$3,$4) RETURNING id`,[name,city,region,cc.rows[0].id]);
    const hash=await bcrypt.hash(temp,12);
    await client.query(`INSERT INTO users(first_name,last_name,email,password_hash,role,mairie_id,must_change_password,password_expires_at) VALUES($1,$2,$3,$4,'mairie',$5,TRUE,NOW())`,[firstName,lastName,email.toLowerCase().trim(),hash,mr.rows[0].id]);
    await client.query('COMMIT');res.status(201).json({message:'Mairie créée.',temporaryPassword:temp,mairieId:mr.rows[0].id});
  }catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}
});

router.delete('/mairies/:id',roles('admin','entreprise'),async(req,res,next)=>{try{const r=await pool.query(`UPDATE mairies SET active=FALSE WHERE id=$1 RETURNING id`,[req.params.id]);if(!r.rows[0])return res.status(404).json({message:'Mairie introuvable.'});await pool.query(`UPDATE users SET must_change_password=FALSE WHERE mairie_id=$1`,[req.params.id]);res.json({message:'Mairie désactivée.'});}catch(e){next(e);}});

router.get('/cni/pending',roles('admin','entreprise'),async(req,res,next)=>{try{const r=await pool.query(`SELECT u.id,u.first_name,u.last_name,u.email,u.phone,cp.cni_status,cp.cni_front,cp.cni_back,cp.cni_verified_at FROM users u JOIN citizen_profiles cp ON cp.user_id=u.id WHERE cp.cni_status='en_verification' ORDER BY cp.created_at`);res.json(r.rows);}catch(e){next(e);}});
router.patch('/cni/:userId',roles('admin','entreprise'),async(req,res,next)=>{try{const status=req.body.status;if(!['verifie','rejete'].includes(status))return res.status(400).json({message:'Statut CNI invalide.'});const verifiedAt=status==='verifie'?new Date():null;const r=await pool.query(`UPDATE citizen_profiles SET cni_status=$1,cni_verified_at=$2,cni_verified_by=$3 WHERE user_id=$4 RETURNING user_id,cni_status`,[status,verifiedAt,req.user.id,req.params.userId]);if(!r.rows[0])return res.status(404).json({message:'Profil citoyen introuvable.'});res.json({message:status==='verifie'?'CNI vérifiée.':'CNI rejetée.',profile:r.rows[0]});}catch(e){next(e);}});

router.get('/notifications',auth,async(req,res,next)=>{try{const r=await pool.query(`SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,[req.user.id]);res.json(r.rows);}catch(e){next(e);}});

export default router;
