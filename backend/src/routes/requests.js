import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { pool } from '../db.js';
import { auth, passwordGuard, roles } from '../middleware.js';

const router=express.Router();
const uploadDir=path.resolve(process.env.UPLOAD_DIR||'uploads');
fs.mkdirSync(uploadDir,{recursive:true});
const storage=multer.diskStorage({destination:(_,__,cb)=>cb(null,uploadDir),filename:(_,file,cb)=>cb(null,crypto.randomBytes(10).toString('hex')+path.extname(file.originalname))});
const upload=multer({storage,limits:{fileSize:12*1024*1024,fileCount:12},fileFilter:(_,file,cb)=>cb(null,file.mimetype.startsWith('image/')||file.mimetype==='application/pdf')});
const publicFile=(stored)=>`/uploads/${stored}`;
const statuses=['soumis','en_verification','incomplet','valide_takardata','transmis_mairie','en_traitement_mairie','complement_demande','document_produit','recu_takardata','verification_finale','pret_a_telecharger','rejete_takardata','rejete_mairie'];
const allowedTransitions={
  soumis:['en_verification','incomplet','rejete_takardata'],
  en_verification:['incomplet','valide_takardata','rejete_takardata'],
  incomplet:['en_verification'],
  valide_takardata:['transmis_mairie'],
  transmis_mairie:['en_traitement_mairie','rejete_mairie'],
  en_traitement_mairie:['complement_demande','document_produit','rejete_mairie'],
  complement_demande:['en_traitement_mairie'],
  document_produit:['recu_takardata'],
  recu_takardata:['verification_finale'],
  verification_finale:['pret_a_telecharger','rejete_takardata']
};

async function notify(client,userId,requestId,message){await client.query('INSERT INTO notifications(user_id,request_id,message) VALUES($1,$2,$3)',[userId,requestId,message]);}

router.use(auth);
router.use(passwordGuard);

router.get('/types',async(req,res,next)=>{try{const r=await pool.query(`SELECT id,code,name,price FROM document_types WHERE active=TRUE ORDER BY id`);res.json(r.rows);}catch(e){next(e);}});
router.get('/types/:id/requirements',async(req,res,next)=>{try{const r=await pool.query(`SELECT id,label,required,accepted_formats FROM required_documents WHERE document_type_id=$1 ORDER BY id`,[req.params.id]);res.json(r.rows);}catch(e){next(e);}});
router.get('/mine',roles('citoyen'),async(req,res,next)=>{try{const r=await pool.query(`SELECT r.*,d.name document_name,m.name mairie_name,od.stored_name official_stored FROM requests r JOIN document_types d ON d.id=r.document_type_id LEFT JOIN mairies m ON m.id=r.mairie_id LEFT JOIN official_documents od ON od.request_id=r.id WHERE r.citizen_id=$1 ORDER BY r.created_at DESC`,[req.user.id]);res.json(r.rows);}catch(e){next(e);}});
router.get('/all',roles('admin','entreprise','mairie'),async(req,res,next)=>{try{const params=[];let where='';if(req.user.role==='mairie'){params.push(req.user.mairie_id);where='WHERE r.mairie_id=$1';}const r=await pool.query(`SELECT r.*,d.name document_name,m.name mairie_name,u.first_name,u.last_name,u.email,od.stored_name official_stored FROM requests r JOIN document_types d ON d.id=r.document_type_id LEFT JOIN mairies m ON m.id=r.mairie_id JOIN users u ON u.id=r.citizen_id LEFT JOIN official_documents od ON od.request_id=r.id ${where} ORDER BY r.created_at DESC`,params);res.json(r.rows);}catch(e){next(e);}});

router.post('/',roles('citoyen'),upload.array('files',12),async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const {documentTypeId,mairieId,beneficiaryFirstName,phone,birthDate,address,paymentMethod,birthMode}=req.body;
    if(!documentTypeId) return res.status(400).json({message:'Choisissez un document.'});
    const type=await client.query('SELECT id,code,name,price FROM document_types WHERE id=$1 AND active=TRUE',[documentTypeId]);
    if(!type.rows[0]) return res.status(400).json({message:'Document invalide.'});
    if(mairieId){const m=await client.query('SELECT id FROM mairies WHERE id=$1 AND active=TRUE',[mairieId]);if(!m.rows[0])return res.status(400).json({message:'Mairie invalide.'});}
    const ref='TKD-'+new Date().getFullYear()+'-'+crypto.randomBytes(4).toString('hex').toUpperCase();
    const formData={...req.body,birthMode:birthMode||null};
    delete formData.documentTypeId;delete formData.mairieId;delete formData.files;
    await client.query('BEGIN');
    const r=await client.query(`INSERT INTO requests(reference,citizen_id,document_type_id,mairie_id,beneficiary_first_name,phone,birth_date,address,payment_method,payment_status,status,form_data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','soumis',$10) RETURNING *`,[ref,req.user.id,documentTypeId,mairieId||null,beneficiaryFirstName||null,phone||req.user.phone||null,birthDate||null,address||null,paymentMethod||null,JSON.stringify(formData)]);
    for(const f of (req.files||[])) await client.query(`INSERT INTO documents(request_id,kind,original_name,stored_name,mime_type) VALUES($1,$2,$3,$4,$5)`,[r.rows[0].id,f.fieldname||'justificatif',f.originalname,f.filename,f.mimetype]);
    await client.query(`INSERT INTO audit_logs(user_id,request_id,action,details) VALUES($1,$2,'demande_soumise',$3)`,[req.user.id,r.rows[0].id,`Référence ${ref}`]);
    await notify(client,req.user.id,r.rows[0].id,`Votre demande ${ref} a été enregistrée.`);
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  }catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}
});

router.patch('/:id/status',roles('admin','entreprise','mairie'),async(req,res,next)=>{
  const client=await pool.connect();
  try{
    const {status,rejectionReason}=req.body;
    if(!statuses.includes(status)) return res.status(400).json({message:'Statut invalide.'});
    const r=await client.query('SELECT * FROM requests WHERE id=$1',[req.params.id]);
    const request=r.rows[0];if(!request)return res.status(404).json({message:'Demande introuvable.'});
    if(req.user.role==='mairie' && request.mairie_id!==req.user.mairie_id)return res.status(403).json({message:'Cette demande n’est pas affectée à votre mairie.'});
    if(req.user.role==='mairie' && !['en_traitement_mairie','complement_demande','document_produit','rejete_mairie'].includes(status))return res.status(403).json({message:'Action non autorisée pour la mairie.'});
    const allowed=allowedTransitions[request.status]||[];if(!allowed.includes(status))return res.status(400).json({message:`Transition impossible : ${request.status} → ${status}.`});
    await client.query('BEGIN');
    const updated=await client.query(`UPDATE requests SET status=$1,rejection_reason=$2,updated_at=NOW() WHERE id=$3 RETURNING *`,[status,rejectionReason||null,request.id]);
    await client.query(`INSERT INTO audit_logs(user_id,request_id,action,details) VALUES($1,$2,'statut_modifie',$3)`,[req.user.id,request.id,status]);
    await notify(client,request.citizen_id,request.id,`Votre demande ${request.reference} est maintenant : ${status.replaceAll('_',' ')}.`);
    await client.query('COMMIT');res.json(updated.rows[0]);
  }catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}
});

router.post('/:id/documents',roles('citoyen'),upload.array('files',12),async(req,res,next)=>{try{const own=await pool.query('SELECT id FROM requests WHERE id=$1 AND citizen_id=$2',[req.params.id,req.user.id]);if(!own.rows[0])return res.status(404).json({message:'Demande introuvable.'});for(const f of(req.files||[]))await pool.query(`INSERT INTO documents(request_id,kind,original_name,stored_name,mime_type) VALUES($1,'complement',$2,$3,$4)`,[req.params.id,f.originalname,f.filename,f.mimetype]);res.json({message:'Documents ajoutés.'});}catch(e){next(e);}});

router.post('/:id/official-document',roles('mairie'),upload.single('officialDocument'),async(req,res,next)=>{const client=await pool.connect();try{if(!req.file)return res.status(400).json({message:'Le document officiel est obligatoire.'});const r=await client.query('SELECT * FROM requests WHERE id=$1 AND mairie_id=$2',[req.params.id,req.user.mairie_id]);if(!r.rows[0])return res.status(404).json({message:'Demande introuvable.'});await client.query('BEGIN');await client.query(`INSERT INTO official_documents(request_id,original_name,stored_name,mime_type) VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO UPDATE SET original_name=EXCLUDED.original_name,stored_name=EXCLUDED.stored_name,mime_type=EXCLUDED.mime_type,created_at=NOW()`,[req.params.id,req.file.originalname,req.file.filename,req.file.mimetype]);await client.query(`UPDATE requests SET status='document_produit',updated_at=NOW() WHERE id=$1`,[req.params.id]);await client.query(`INSERT INTO audit_logs(user_id,request_id,action,details) VALUES($1,$2,'document_officiel_depose','Document officiel déposé par la mairie')`,[req.user.id,req.params.id]);await notify(client,r.rows[0].citizen_id,req.params.id,`Le document officiel de votre demande ${r.rows[0].reference} a été produit par la mairie.`);await client.query('COMMIT');res.json({message:'Document officiel enregistré.'});}catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}});

router.post('/:id/validate-official',roles('admin','entreprise'),async(req,res,next)=>{const client=await pool.connect();try{const r=await client.query('SELECT * FROM requests WHERE id=$1',[req.params.id]);if(!r.rows[0])return res.status(404).json({message:'Demande introuvable.'});const od=await client.query('SELECT id FROM official_documents WHERE request_id=$1',[req.params.id]);if(!od.rows[0])return res.status(400).json({message:'Aucun document officiel à contrôler.'});if(!['document_produit','recu_takardata'].includes(r.rows[0].status))return res.status(400).json({message:'Le document n’est pas encore prêt pour le contrôle.'});await client.query('BEGIN');await client.query(`UPDATE requests SET status='pret_a_telecharger',updated_at=NOW() WHERE id=$1`,[req.params.id]);await client.query(`INSERT INTO audit_logs(user_id,request_id,action,details) VALUES($1,$2,'controle_final',$3)`,[req.user.id,req.params.id,'Document officiel validé par TAKARDATA']);await notify(client,r.rows[0].citizen_id,req.params.id,`Votre demande ${r.rows[0].reference} est prête à être téléchargée.`);await client.query('COMMIT');res.json({message:'Document validé.'});}catch(e){await client.query('ROLLBACK');next(e);}finally{client.release();}});

router.get('/:id',async(req,res,next)=>{try{const params=[req.params.id];let where='r.id=$1';if(req.user.role==='citoyen'){params.push(req.user.id);where+=' AND r.citizen_id=$2';}if(req.user.role==='mairie'){params.push(req.user.mairie_id);where+=' AND r.mairie_id=$2';}const r=await pool.query(`SELECT r.*,d.name document_name,m.name mairie_name FROM requests r JOIN document_types d ON d.id=r.document_type_id LEFT JOIN mairies m ON m.id=r.mairie_id WHERE ${where}`,[...params]);if(!r.rows[0])return res.status(404).json({message:'Demande introuvable.'});const docs=await pool.query('SELECT * FROM documents WHERE request_id=$1 ORDER BY id',[r.rows[0].id]);const official=await pool.query('SELECT * FROM official_documents WHERE request_id=$1',[r.rows[0].id]);res.json({...r.rows[0],documents:docs.rows,official_document:official.rows[0]||null});}catch(e){next(e);}});

export default router;
