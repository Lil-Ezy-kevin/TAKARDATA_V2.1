import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import requestRoutes from './routes/requests.js';
import adminRoutes from './routes/admin.js';

dotenv.config();
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const app=express();
app.set('trust proxy',1);
const port=process.env.PORT||4000;
const uploadDir=path.resolve(process.env.UPLOAD_DIR||path.join(__dirname,'..','uploads'));
fs.mkdirSync(uploadDir,{recursive:true});

app.disable('x-powered-by');
app.use(cors({origin:process.env.NODE_ENV==='production'?true:(process.env.FRONTEND_URL||'http://localhost:5173')}));
app.use(express.json({limit:'2mb'}));
app.use('/uploads',express.static(uploadDir));

app.get('/api/health',(_,res)=>res.json({ok:true,service:'TAKARDATA API',version:'2.1.1'}));
app.use('/api/auth',authRoutes);
app.use('/api/requests',requestRoutes);
app.use('/api/admin',adminRoutes);

const frontendDist=path.resolve(__dirname,'../../frontend/dist');
if(fs.existsSync(frontendDist)){
  app.use(express.static(frontendDist));
  app.get('*',(req,res,next)=>req.path.startsWith('/api/')?next():res.sendFile(path.join(frontendDist,'index.html')));
}

app.use((err,req,res,next)=>{
  console.error(err);
  const message=err.code==='LIMIT_FILE_SIZE'?'Fichier trop volumineux (12 Mo maximum).':err.message||'Erreur serveur';
  res.status(err.status||500).json({message});
});

app.listen(port,()=>console.log(`TAKARDATA API: http://localhost:${port}`));
