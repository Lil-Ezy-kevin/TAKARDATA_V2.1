import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { pool } from '../db.js';
import { auth } from '../middleware.js';

const router=express.Router();
const upload=multer({dest:path.resolve(process.env.UPLOAD_DIR||'uploads'),limits:{fileSize:8*1024*1024},fileFilter:(req,file,cb)=>{
  const ok=file.mimetype.startsWith('image/')||file.mimetype==='application/pdf';
  cb(ok?null:new Error('Format accepté : image ou PDF.'),ok);
}});
const secret=()=>process.env.JWT_SECRET||'dev-secret-change-me';
const tokenFor=u=>jwt.sign({id:u.id,role:u.role},secret(),{expiresIn:'7d'});

const loginAttempts=new Map();
const MAX_ATTEMPTS=5, WINDOW_MS=15*60*1000;
function tooManyAttempts(key){
  const e=loginAttempts.get(key);if(!e)return false;
  if(Date.now()-e.firstAttempt>WINDOW_MS){loginAttempts.delete(key);return false;}
  return e.count>=MAX_ATTEMPTS;
}
function registerFailedAttempt(key){
  const now=Date.now(),e=loginAttempts.get(key);
  if(!e||now-e.firstAttempt>WINDOW_MS)loginAttempts.set(key,{count:1,firstAttempt:now});
  else e.count++;
}
function clearAttempts(key){loginAttempts.delete(key);}

router.post('/register',upload.fields([{name:'cniFront',maxCount:1},{name:'cniBack',maxCount:1}]),async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const {firstName,lastName,phone,email,password}=req.body;
    const front=req.files?.cniFront?.[0], back=req.files?.cniBack?.[0];
    if(!firstName||!lastName||!phone||!email||!password||!front||!back) return res.status(400).json({message:'Tous les champs et les deux faces de la CNI sont obligatoires.'});
    if(password.length<8) return res.status(400).json({message:'Le mot de passe doit contenir au moins 8 caractères.'});
    const exists=await pool.query('SELECT id FROM users WHERE email=$1',[email.toLowerCase().trim()]);
    if(exists.rows[0]) return res.status(409).json({message:'Cette adresse email est déjà utilisée.'});
    await client.query('BEGIN');
    const hash=await bcrypt.hash(password,12);
    const u=await client.query(`INSERT INTO users(first_name,last_name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5,'citoyen') RETURNING id,first_name,last_name,email,phone,role`,[firstName.trim(),lastName.trim(),email.toLowerCase().trim(),phone.trim(),hash]);
    await client.query(`INSERT INTO citizen_profiles(user_id,cni_front,cni_back,cni_status) VALUES($1,$2,$3,'en_verification')`,[u.rows[0].id,front.filename,back.filename]);
    await client.query('COMMIT');
    res.status(201).json({message:'Inscription reçue. La CNI doit être vérifiée par TAKARDATA avant activation.'});
  }catch(err){await client.query('ROLLBACK');next(err);}finally{client.release();}
});

router.post('/login',async(req,res,next)=>{
  try{
    const email=(req.body.email||'').toLowerCase().trim(), password=req.body.password||'';
    const key=req.ip+':'+email;
    if(tooManyAttempts(key)) return res.status(429).json({message:'Trop de tentatives. Réessayez dans quelques minutes.'});
    const r=await pool.query(`SELECT u.*,cp.cni_status FROM users u LEFT JOIN citizen_profiles cp ON cp.user_id=u.id WHERE u.email=$1`,[email]);
    const u=r.rows[0];
    if(!u || !(await bcrypt.compare(password,u.password_hash))){
      registerFailedAttempt(key);
      return res.status(401).json({message:'Email ou mot de passe incorrect.'});
    }
    clearAttempts(key);
    if(u.role==='citoyen' && u.cni_status!=='verifie') return res.status(403).json({message:u.cni_status==='rejete'?'Votre vérification CNI a été rejetée.':'Votre compte citoyen attend la vérification de votre CNI.',code:'CNI_PENDING'});
    const publicUser={id:u.id,first_name:u.first_name,last_name:u.last_name,email:u.email,phone:u.phone,role:u.role,mairie_id:u.mairie_id,must_change_password:u.must_change_password,password_expires_at:u.password_expires_at};
    res.json({token:tokenFor(u),user:publicUser});
  }catch(err){next(err);}
});

router.get('/me',auth,async(req,res)=>res.json(req.user));

router.post('/change-password',auth,async(req,res,next)=>{
  try{
    const {currentPassword,newPassword}=req.body;
    if(!currentPassword||!newPassword||newPassword.length<8) return res.status(400).json({message:'Mot de passe actuel et nouveau mot de passe de 8 caractères minimum requis.'});
    const r=await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.user.id]);
    if(!(await bcrypt.compare(currentPassword,r.rows[0].password_hash))) return res.status(400).json({message:'Mot de passe actuel incorrect.'});
    const hash=await bcrypt.hash(newPassword,12);
    await pool.query(`UPDATE users SET password_hash=$1,must_change_password=FALSE,password_expires_at=NOW()+INTERVAL '90 days' WHERE id=$2`,[hash,req.user.id]);
    res.json({message:'Mot de passe mis à jour.'});
  }catch(err){next(err);}
});

export default router;
