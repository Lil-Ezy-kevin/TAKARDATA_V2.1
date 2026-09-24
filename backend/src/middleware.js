import jwt from 'jsonwebtoken';
import { pool } from './db.js';

export async function auth(req,res,next){
  try {
    const header=req.headers.authorization||'';
    const token=header.startsWith('Bearer ')?header.slice(7):null;
    if(!token) return res.status(401).json({message:'Connexion requise.'});
    const payload=jwt.verify(token,process.env.JWT_SECRET||'dev-secret');
    const result=await pool.query(`SELECT id,first_name,last_name,email,phone,role,mairie_id,must_change_password,password_expires_at FROM users WHERE id=$1`,[payload.id]);
    if(!result.rows[0]) return res.status(401).json({message:'Session invalide.'});
    req.user=result.rows[0];
    next();
  }catch(err){return res.status(401).json({message:'Session invalide ou expirée.'});}
}

export function roles(...allowed){return (req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({message:'Accès non autorisé.'});}

export function passwordGuard(req,res,next){
  if(req.user.must_change_password && req.path!=='/change-password') return res.status(403).json({message:'Vous devez changer votre mot de passe avant de continuer.',code:'PASSWORD_CHANGE_REQUIRED'});
  if(req.user.password_expires_at && new Date(req.user.password_expires_at) <= new Date() && req.path!=='/change-password') return res.status(403).json({message:'Votre mot de passe a expiré. Veuillez le changer.',code:'PASSWORD_EXPIRED'});
  next();
}
