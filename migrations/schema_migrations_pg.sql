-- Green Cheek Conure Tycoon (GCCT) — PostgreSQL Schema (Neon Serverless Postgres)
-- Safe idempotent table creation matching migrations/schema_migrations.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  aviary_name TEXT NOT NULL,
  coins BIGINT NOT NULL DEFAULT 15000 CHECK (coins >= 0),
  xp BIGINT NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  total_shows INTEGER NOT NULL DEFAULT 0,
  total_show_wins INTEGER NOT NULL DEFAULT 0,
  best_show_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  total_coins_earned BIGINT NOT NULL DEFAULT 0,
  market_spent BIGINT NOT NULL DEFAULT 0,
  is_npc INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS birds (
  id TEXT PRIMARY KEY,
  leg_band TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('MALE', 'FEMALE')),
  visual_phenotype TEXT NOT NULL,
  chromosome_payload TEXT NOT NULL,
  actual_splits TEXT NOT NULL DEFAULT '[]',
  displayed_splits TEXT NOT NULL DEFAULT '[]',
  plumage_symmetry DOUBLE PRECISION NOT NULL DEFAULT 80,
  father_id TEXT REFERENCES birds(id),
  mother_id TEXT REFERENCES birds(id),
  original_breeder_id TEXT NOT NULL REFERENCES users(id),
  original_breeder_name TEXT NOT NULL,
  current_owner_id TEXT REFERENCES users(id),
  hatch_timestamp BIGINT NOT NULL,
  genetics_reveal_at BIGINT NOT NULL DEFAULT 0,
  genetics_processed INTEGER NOT NULL DEFAULT 1,
  maturation_timestamp BIGINT NOT NULL,
  cooldown_until BIGINT NOT NULL DEFAULT 0,
  generation_depth INTEGER NOT NULL DEFAULT 1 CHECK (generation_depth >= 1),
  breed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'BREEDING', 'INCUBATING', 'JUVENILE', 'MARKET_SYSTEM', 'MARKET_P2P', 'SANCTUARY')),
  CHECK (father_id IS NULL OR father_id <> id),
  CHECK (mother_id IS NULL OR mother_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_birds_owner ON birds(current_owner_id);
CREATE INDEX IF NOT EXISTS idx_birds_lineage ON birds(father_id, mother_id);

CREATE TABLE IF NOT EXISTS user_discovered_genes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gene_key TEXT NOT NULL,
  unlocked_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, gene_key)
);

CREATE TABLE IF NOT EXISTS market_batches (
  hour_bucket_utc BIGINT PRIMARY KEY,
  generated_at BIGINT NOT NULL,
  next_refresh_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_listings (
  id TEXT PRIMARY KEY,
  hour_bucket_utc BIGINT NOT NULL REFERENCES market_batches(hour_bucket_utc),
  bird_id TEXT NOT NULL REFERENCES birds(id),
  price BIGINT NOT NULL CHECK (price > 0),
  is_split_carrier INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'EXPIRED')),
  buyer_id TEXT REFERENCES users(id),
  created_at BIGINT NOT NULL,
  sold_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_market_listings_active ON market_listings(status, hour_bucket_utc);

CREATE TABLE IF NOT EXISTS breeding_cages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  male_id TEXT NOT NULL REFERENCES birds(id),
  female_id TEXT NOT NULL REFERENCES birds(id),
  inbreeding_coi DOUBLE PRECISION NOT NULL DEFAULT 0,
  coi_warning INTEGER NOT NULL DEFAULT 0,
  clutch_payload TEXT NOT NULL,
  started_at BIGINT NOT NULL,
  laid_at BIGINT NOT NULL DEFAULT 0,
  hatch_ready_at BIGINT NOT NULL,
  fostered_count INTEGER NOT NULL DEFAULT 0,
  hatched INTEGER NOT NULL DEFAULT 0,
  hatched_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_breeding_cages_owner ON breeding_cages(owner_id, hatched);

CREATE TABLE IF NOT EXISTS p2p_listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id),
  bird_id TEXT NOT NULL REFERENCES birds(id),
  asking_price BIGINT NOT NULL CHECK (asking_price > 0),
  seller_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'CANCELLED')),
  buyer_id TEXT REFERENCES users(id),
  created_at BIGINT NOT NULL,
  sold_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_p2p_active ON p2p_listings(status, created_at);

CREATE TABLE IF NOT EXISTS showroom_entries (
  id TEXT PRIMARY KEY,
  season_key TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('NOVICE', 'COLOR_MUTATION', 'MASTER_PEDIGREE')),
  user_id TEXT NOT NULL REFERENCES users(id),
  bird_id TEXT NOT NULL REFERENCES birds(id),
  symmetry_score DOUBLE PRECISION NOT NULL,
  rarity_score DOUBLE PRECISION NOT NULL,
  purity_bonus DOUBLE PRECISION NOT NULL,
  total_score DOUBLE PRECISION NOT NULL,
  rank_position INTEGER NOT NULL,
  prize_coins BIGINT NOT NULL DEFAULT 0,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  entered_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_showroom_season ON showroom_entries(season_key, category, total_score DESC);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  badge_title TEXT NOT NULL,
  awarded_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, badge_key)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_flag INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mutation_configs (
  mutation_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chromosome_label TEXT NOT NULL,
  inheritance_mode TEXT NOT NULL,
  visual_description TEXT NOT NULL,
  image_url TEXT,
  base_price BIGINT NOT NULL,
  rarity TEXT NOT NULL,
  rarity_score INTEGER NOT NULL,
  accent_hex TEXT NOT NULL,
  base_phenotype TEXT NOT NULL DEFAULT 'WT',
  is_custom INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS special_birds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mutation_key TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('MALE', 'FEMALE')),
  plumage_symmetry DOUBLE PRECISION NOT NULL DEFAULT 90,
  splits_json TEXT NOT NULL DEFAULT '[]',
  price_pkr BIGINT NOT NULL CHECK (price_pkr >= 0),
  image_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_live INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL DEFAULT 'CHOICE_BIRD' CHECK (request_type IN ('CHOICE_BIRD', 'SPECIAL_BIRD', 'SUPPORT')),
  special_bird_id TEXT REFERENCES special_birds(id) ON DELETE SET NULL,
  requested_mutation TEXT,
  requested_gender TEXT CHECK (requested_gender IN ('MALE', 'FEMALE') OR requested_gender IS NULL),
  desired_bird_name TEXT NOT NULL DEFAULT '',
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  payment_method TEXT NOT NULL DEFAULT 'NayaPay',
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL DEFAULT '',
  reference_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at BIGINT NOT NULL,
  reviewed_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_user ON payment_requests(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  aviary_name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_pair ON chat_messages(user_id, recipient_id, created_at);
