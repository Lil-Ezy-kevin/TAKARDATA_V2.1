CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(40),
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL CHECK(role IN ('citoyen','entreprise','mairie','admin')),
  mairie_id INTEGER,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  password_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS regions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS communes (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  region_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
  UNIQUE(name, region_id)
);

CREATE TABLE IF NOT EXISTS mairies (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  city VARCHAR(120),
  region VARCHAR(120),
  commune_id INTEGER REFERENCES communes(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS citizen_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cni_front TEXT NOT NULL,
  cni_back TEXT NOT NULL,
  cni_status VARCHAR(30) NOT NULL DEFAULT 'en_verification',
  cni_verified_at TIMESTAMP,
  cni_verified_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_types (
  id SERIAL PRIMARY KEY,
  code VARCHAR(60) UNIQUE,
  name VARCHAR(150) NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS required_documents (
  id SERIAL PRIMARY KEY,
  document_type_id INTEGER NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  label VARCHAR(255) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  accepted_formats VARCHAR(255) DEFAULT 'image/*,application/pdf'
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  reference VARCHAR(40) UNIQUE NOT NULL,
  citizen_id INTEGER NOT NULL REFERENCES users(id),
  document_type_id INTEGER NOT NULL REFERENCES document_types(id),
  mairie_id INTEGER REFERENCES mairies(id),
  beneficiary_first_name VARCHAR(100),
  phone VARCHAR(40),
  birth_date DATE,
  address TEXT,
  payment_method VARCHAR(50),
  payment_status VARCHAR(30) DEFAULT 'pending',
  status VARCHAR(50) NOT NULL DEFAULT 'soumis',
  form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  kind VARCHAR(80) NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS official_documents (
  id SERIAL PRIMARY KEY,
  request_id INTEGER UNIQUE NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  request_id INTEGER REFERENCES requests(id),
  action VARCHAR(100) NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS mairie_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_expires_at TIMESTAMP;
ALTER TABLE citizen_profiles ADD COLUMN IF NOT EXISTS cni_verified_by INTEGER REFERENCES users(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS form_data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS code VARCHAR(60);
ALTER TABLE document_types ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS document_types_code_unique ON document_types(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS requests_citizen_idx ON requests(citizen_id);
CREATE INDEX IF NOT EXISTS requests_mairie_idx ON requests(mairie_id);
CREATE INDEX IF NOT EXISTS requests_status_idx ON requests(status);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id);

INSERT INTO regions(name) VALUES ('Agadez') ON CONFLICT(name) DO NOTHING;
INSERT INTO communes(name, region_id)
SELECT 'Agadez Centre', id FROM regions WHERE name='Agadez'
ON CONFLICT(name, region_id) DO NOTHING;
INSERT INTO mairies(name, city, region, commune_id)
SELECT 'Mairie d’Agadez', 'Agadez', 'Agadez', c.id
FROM communes c JOIN regions r ON r.id=c.region_id
WHERE c.name='Agadez Centre' AND r.name='Agadez'
AND NOT EXISTS (SELECT 1 FROM mairies WHERE name='Mairie d’Agadez');

INSERT INTO document_types(code,name,price) VALUES
('naissance','Acte de naissance',5000),
('mariage','Acte de mariage',8000),
('residence','Certificat de résidence',3000),
('passeport','Passeport',15000),
('cni','Carte nationale d’identité',10000),
('casier','Casier judiciaire',4000),
('nationalite','Certificat de nationalité',6000)
ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name, price=EXCLUDED.price;

INSERT INTO required_documents(document_type_id,label,required)
SELECT id,'CNI du demandeur',TRUE FROM document_types WHERE code='mariage'
AND NOT EXISTS (SELECT 1 FROM required_documents WHERE document_type_id=document_types.id AND label='CNI du demandeur');
INSERT INTO required_documents(document_type_id,label,required)
SELECT id,'Justificatif de domicile',TRUE FROM document_types WHERE code='residence'
AND NOT EXISTS (SELECT 1 FROM required_documents WHERE document_type_id=document_types.id AND label='Justificatif de domicile');
INSERT INTO required_documents(document_type_id,label,required)
SELECT id,'Pièces justificatives du dossier',TRUE FROM document_types WHERE code IN ('passeport','cni','casier','nationalite')
AND NOT EXISTS (SELECT 1 FROM required_documents WHERE document_type_id=document_types.id AND label='Pièces justificatives du dossier');
INSERT INTO required_documents(document_type_id,label,required)
SELECT id,'CNI des deux témoins',TRUE FROM document_types WHERE code='naissance'
AND NOT EXISTS (SELECT 1 FROM required_documents WHERE document_type_id=document_types.id AND label='CNI des deux témoins');
