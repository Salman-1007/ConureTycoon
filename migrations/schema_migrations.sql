-- Green Cheek Conure Tycoon (GCCT) — Schema Migrations
-- Compatible with SQLite (Node 24 node:sqlite) and documented for PostgreSQL deployment.
-- Incremental additive migrations designed to preserve historical player profiles & wallets.

PRAGMA foreign_keys = ON;

-- 1. Core Users & Wallets (Preserved from Reference Game PlayerState)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  aviary_name TEXT NOT NULL,
  coins INTEGER NOT NULL DEFAULT 15000 CHECK (coins >= 0),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  total_shows INTEGER NOT NULL DEFAULT 0,
  total_show_wins INTEGER NOT NULL DEFAULT 0,
  best_show_score REAL NOT NULL DEFAULT 0,
  total_coins_earned INTEGER NOT NULL DEFAULT 0,
  market_spent INTEGER NOT NULL DEFAULT 0,
  is_npc INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 2. Persistent Sessions
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 3. Immutable Birds / Pedigree Ledger (Part VI)
CREATE TABLE IF NOT EXISTS birds (
  id TEXT PRIMARY KEY,
  leg_band TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('MALE', 'FEMALE')),
  visual_phenotype TEXT NOT NULL,
  chromosome_payload TEXT NOT NULL, -- JSON: { sex, zChromosomes, autosomalLoci } (SERVER-PRIVATE)
  actual_splits TEXT NOT NULL DEFAULT '[]', -- JSON array of gene keys (SERVER-PRIVATE)
  displayed_splits TEXT NOT NULL DEFAULT '[]', -- JSON array of gene keys unlocked/confirmed for current owner
  plumage_symmetry REAL NOT NULL DEFAULT 80, -- Intrinsic exhibition trait (65..100)
  father_id TEXT REFERENCES birds(id),
  mother_id TEXT REFERENCES birds(id),
  original_breeder_id TEXT NOT NULL REFERENCES users(id),
  original_breeder_name TEXT NOT NULL,
  current_owner_id TEXT REFERENCES users(id), -- NULL while held in system market
  hatch_timestamp INTEGER NOT NULL,
  maturation_timestamp INTEGER NOT NULL,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  generation_depth INTEGER NOT NULL DEFAULT 1 CHECK (generation_depth >= 1),
  breed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'READY' CHECK (status IN ('READY', 'BREEDING', 'INCUBATING', 'JUVENILE', 'MARKET_SYSTEM', 'MARKET_P2P', 'SANCTUARY')),
  CHECK (father_id IS NULL OR father_id <> id),
  CHECK (mother_id IS NULL OR mother_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_birds_owner ON birds(current_owner_id);
CREATE INDEX IF NOT EXISTS idx_birds_lineage ON birds(father_id, mother_id);

-- 4. Fog-of-War Discovery Compendium Ledger (Part III)
CREATE TABLE IF NOT EXISTS user_discovered_genes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gene_key TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, gene_key)
);

-- 5. Server-Authoritative Hourly System Marketplace (Part IV)
CREATE TABLE IF NOT EXISTS market_batches (
  hour_bucket_utc INTEGER PRIMARY KEY, -- Epoch ms truncated to :00 UTC
  generated_at INTEGER NOT NULL,
  next_refresh_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_listings (
  id TEXT PRIMARY KEY,
  hour_bucket_utc INTEGER NOT NULL REFERENCES market_batches(hour_bucket_utc),
  bird_id TEXT NOT NULL REFERENCES birds(id),
  price INTEGER NOT NULL CHECK (price > 0),
  is_split_carrier INTEGER NOT NULL DEFAULT 0, -- Server-private analytics flag
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'EXPIRED')),
  buyer_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  sold_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_market_listings_active ON market_listings(status, hour_bucket_utc);

-- 6. Breeding Cages & Active Clutches (Part V)
CREATE TABLE IF NOT EXISTS breeding_cages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  male_id TEXT NOT NULL REFERENCES birds(id),
  female_id TEXT NOT NULL REFERENCES birds(id),
  inbreeding_coi REAL NOT NULL DEFAULT 0,
  coi_warning INTEGER NOT NULL DEFAULT 0,
  clutch_payload TEXT NOT NULL, -- JSON array of pre-conceived zygote genotypes
  started_at INTEGER NOT NULL,
  hatch_ready_at INTEGER NOT NULL,
  hatched INTEGER NOT NULL DEFAULT 0,
  hatched_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_breeding_cages_owner ON breeding_cages(owner_id, hatched);

-- 7. Player-to-Player Trading Post (Part VII.1)
CREATE TABLE IF NOT EXISTS p2p_listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id),
  bird_id TEXT NOT NULL REFERENCES birds(id),
  asking_price INTEGER NOT NULL CHECK (asking_price > 0),
  seller_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'CANCELLED')),
  buyer_id TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  sold_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_p2p_active ON p2p_listings(status, created_at);

-- 8. Aviary Exhibition Showroom & Seasonal Badges (Part VII.2)
CREATE TABLE IF NOT EXISTS showroom_entries (
  id TEXT PRIMARY KEY,
  season_key TEXT NOT NULL, -- e.g. '2026-Q4' or '2026'
  category TEXT NOT NULL CHECK (category IN ('NOVICE', 'COLOR_MUTATION', 'MASTER_PEDIGREE')),
  user_id TEXT NOT NULL REFERENCES users(id),
  bird_id TEXT NOT NULL REFERENCES birds(id),
  symmetry_score REAL NOT NULL,
  rarity_score REAL NOT NULL,
  purity_bonus REAL NOT NULL,
  total_score REAL NOT NULL,
  rank_position INTEGER NOT NULL,
  prize_coins INTEGER NOT NULL DEFAULT 0,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  entered_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_showroom_season ON showroom_entries(season_key, category, total_score DESC);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_key TEXT NOT NULL,
  badge_title TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_key)
);

-- 9. Notifications / Breakthrough Feed & Server Test Clock Metadata
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- 'GENOMIC_BREAKTHROUGH', 'SHOWROOM_TROPHY', 'P2P_SALE', 'SYSTEM'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_flag INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS system_meta (
  meta_key TEXT PRIMARY KEY,
  meta_value TEXT NOT NULL
);

-- 10. Admin Mutation Config Overrides & Custom Strains
CREATE TABLE IF NOT EXISTS mutation_configs (
  mutation_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chromosome_label TEXT NOT NULL,
  inheritance_mode TEXT NOT NULL,
  visual_description TEXT NOT NULL,
  image_url TEXT,
  base_price INTEGER NOT NULL,
  rarity TEXT NOT NULL,
  rarity_score INTEGER NOT NULL,
  accent_hex TEXT NOT NULL,
  base_phenotype TEXT NOT NULL DEFAULT 'WT',
  is_custom INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- 11. Admin Premium / Special Birds (Real-money NayaPay & International Support)
CREATE TABLE IF NOT EXISTS special_birds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mutation_key TEXT NOT NULL,
  sex TEXT NOT NULL CHECK (sex IN ('MALE', 'FEMALE')),
  plumage_symmetry REAL NOT NULL DEFAULT 90,
  splits_json TEXT NOT NULL DEFAULT '[]',
  price_pkr INTEGER NOT NULL CHECK (price_pkr >= 0),
  image_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_live INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- 12. Payment Requests (Choice Bird Coffee Orders, Special Birds & Creator Support)
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL DEFAULT 'CHOICE_BIRD' CHECK (request_type IN ('CHOICE_BIRD', 'SPECIAL_BIRD', 'SUPPORT')),
  special_bird_id TEXT REFERENCES special_birds(id) ON DELETE SET NULL,
  requested_mutation TEXT,
  requested_gender TEXT CHECK (requested_gender IN ('MALE', 'FEMALE') OR requested_gender IS NULL),
  desired_bird_name TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  payment_method TEXT NOT NULL DEFAULT 'NayaPay',
  sender_name TEXT NOT NULL,
  sender_phone TEXT NOT NULL DEFAULT '',
  reference_note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_user ON payment_requests(user_id, created_at DESC);

-- 13. Chat Messages Ledger (for Chat Audit & Direct Messaging)
CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  aviary_name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_pair ON chat_messages(user_id, recipient_id, created_at);
