-- Enable core extensions required by the SynChat AI project

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
COMMENT ON EXTENSION "uuid-ossp" IS 'UUID generation functions';

CREATE EXTENSION IF NOT EXISTS "vector";
COMMENT ON EXTENSION "vector" IS 'pgvector extension for vector similarity search';

-- Add any other universally required extensions discovered during analysis here.
-- For example, if pgcrypto or others were used:
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- COMMENT ON EXTENSION "pgcrypto" IS 'Cryptographic functions';
