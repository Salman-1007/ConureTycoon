# Stage 1 Codebase Audit & Preservation Report — Green Cheek Conure Tycoon (GCCT)

## 1. Source Reference Inventory (`mainfiles.zip` — Kabootar Baaz Pigeon Tycoon)

### Frontend Routes & Views Audited
- `app/_layout.tsx`: Root `ThemeProvider` + `GameProvider` context wrapper and navigation stack -> **Preserved & Adapted** as React Web SPA shell (`client/src/App.tsx` + `GameContext.tsx`).
- `app/(tabs)/_layout.tsx`: 5-tab navigation shell (`index`, `market`, `loft`, `competition`, `records`) -> **Refactored** to Web Top/Bottom Responsive Nav Shell (`Hub`, `Marketplace`, `Aviary`, `Breeding`, `Trading Post`, `Showroom`, `Compendium & Records`).
- `app/(tabs)/index.tsx`: Player/Loft setup onboarding (`name`, `loftName`, starting `money`) & Hub dashboard (XP bar, quick stats, nav cards) -> **Preserved & Adapted** (`AuthSetupPage.tsx` + `HubDashboard.tsx`) with real user authentication and session persistence.
- `app/(tabs)/market.tsx`: Market countdown, gender/rarity filters, bird cards, buy & haggle actions -> **Refactored** (`MarketPage.tsx`) to server-authoritative `:00 UTC` hourly 10-bird marketplace with ±20% market variance and transactional purchase locking.
- `app/(tabs)/loft.tsx`: Loft bird grid, filters (`All`, `Males`, `Females`, `Ready`, `Breeding`, `Juvenile`), active pairing corner with live timers, detail bottom-sheet (rename, sell, pair) -> **Refactored** (`AviaryPage.tsx`) to **Aviary** with Closed Leg Bands (`GCC-YYYY-XXXX`), breeding cages, Fog-of-War split badges, 3-generation Pedigree Explorer, and P2P listing actions.
- `app/(tabs)/competition.tsx`: Pigeon high-flyer flight competition, weather modifiers, flight hours, home-return risk/loss -> **PURGED** (all homing flight, weather, distance/speed, and loss mechanics removed). Replaced by **Aviary Exhibition Showroom** (`ShowroomPage.tsx`).
- `app/(tabs)/records.tsx`: Career metrics, top birds, breed counts, achievements -> **Preserved & Expanded** (`CompendiumPage.tsx`) to include the 12-mutation **Gene Discovery Compendium**, chromosomal genetics reference, seasonal trophies, and breeder badges.
- `components/game-ui.tsx`: Reusable `Page`, `Header`, `WoodCard`, `BrassButton`, `Badge`, `BreedMedallion`, `StatBar`, `PigeonCard`, `PigeonDetailSheet` -> **Preserved Conceptually & Rebuilt for Web** (`client/src/components/ui.tsx`, `ConureCard.tsx`, `BirdInspectionModal.tsx`).

### State & Domain Logic Audited (`game/`)
- `game/types.ts`: `Gender`, `PlayerState`, `MarketState`, `GameState`, `LeaderboardRow` -> **Preserved & Adapted** (`shared/api-types.ts`, `shared/genetics/types.ts`); `Pigeon` -> adapted via `shared/compatibility_shim.ts` to `ConureRecord`.
- `game/data.ts`: Palette, level progression (`PLAYER_LEVELS`), `SAVE_KEY` -> **Preserved** (`shared/genetics/catalog.ts`); `WEATHERS` & `BREEDS` (Teddy, Sialkoti, etc.) -> **Purged / Replaced** by the 12 Green Cheek Conure chromosomal mutations (`WT`, `CIN`, `OP`, `PINE`, `TQ`, `DIL`, `SUNCHK`, `MINT`, `TQ_CIN`, `TQ_YS`, `TQ_PINE`, `MOONCHK`).
- `game/engine.ts`: `recoverTimers`, `money`, `getLevel`, `nextLevel`, `assignPrizes` -> **Preserved Concepts** moved to authoritative server services; `calcFlightHours`, `simulateCompetition`, `randomWeather`, `generateStat` -> **PURGED**.
- `game/GameContext.tsx`: Actions (`startNewGame`, `buyPigeon`, `sellPigeon`, `renamePigeon`, `pairPigeons`, `recoverTimers`) -> **Preserved & Migrated to Server APIs**.

---

## 2. Preserved & Migrated API Endpoints (`preserved_endpoints.md`)

| Legacy Context Action / Flow | Preserved / Adapted Server API Endpoint | Auth & Transaction Policy | Notes |
|---|---|---|---|
| `hydrate` / Save Load | `GET /api/auth/me` & `GET /api/aviary` | Session cookie/Bearer token required | Restores persistent player profile, wallet balance, XP, discovered genes, and aviary birds. |
| `startNewGame` (Setup) | `POST /api/auth/register` & `POST /api/auth/login` | Public; creates persistent user + 3 starter conures + `NORMAL_GREEN` discovery | Preserves name, aviary (formerly loft) name, wallet creation, and session persistence. |
| `refreshMarket` / Market View | `GET /api/market/system` & `GET /api/time` | Authenticated; UTC server-authoritative `:00` clock | Returns active 10 hourly system listings and exact server UTC timestamp for drift-free countdowns. |
| `buyPigeon` (Market Buy) | `POST /api/market/system/:listingId/buy` | Atomic DB transaction (`BEGIN IMMEDIATE` / `FOR UPDATE`) | Prevents race-condition double purchases; deducts coins and transfers ownership atomically. |
| `sellPigeon` (Quick Sell / Release) | `POST /api/birds/:birdId/sell` | Owner check + not listed/breeding check | Sells bird to avian sanctuary/wholesaler at appraisal value; preserves pedigree lineage history. |
| `renamePigeon` | `PATCH /api/birds/:birdId/name` | Owner check | Updates bird call name while keeping immutable `leg_band` (`GCC-YYYY-XXXX`). |
| `pairPigeons` | `POST /api/breeding/pair` | Owner check + ZZ/ZW sex check + maturity + cooldown + COI warning check | Assigns pair to breeding cage; rolls 3–5 clutch server-side; enforces `BREEDING_CONFIG` timers. |
| `recoverTimers` (Breeding Tick) | `POST /api/breeding/collect/:cageId` & `GET /api/aviary` | Server UTC evaluation | Evaluates incubation -> hatch (triggers Fog-of-War discovery unmasking!) -> maturation -> post-fledge cooldown. |
| `records` / Profile & Compendium | `GET /api/compendium` & `GET /api/profile/records` | Authenticated; Fog-of-War filtered | Returns career stats, unlocked badges, achievements, and `user_discovered_genes`. |
| **PURGED**: `runCompetition` (Flight) | **REMOVED** (`POST /api/showroom/enter` replaces it) | Deterministic exhibition judging | All homing flight hours, weather modifiers, and lost-in-sky logic completely deleted. |
| **NEW**: Pedigree Explorer | `GET /api/birds/:birdId/pedigree` | Fog-of-War filtered per viewer | Returns 3-generation ancestor tree with cycle protection & inferred split analysis. |
| **NEW**: P2P Trading Post | `GET /api/market/p2p`, `POST /api/market/p2p`, `POST /api/market/p2p/:listingId/buy`, `DELETE /api/market/p2p/:listingId` | Transactional lock + buyer-scoped Fog-of-War | Player-to-player marketplace; buyer sees full pedigree, but splits follow buyer's personal discovery state. |
| **NEW**: Exhibition Showroom | `GET /api/showroom`, `POST /api/showroom/enter` | Server deterministic scoring | Computes `(Plumage Symmetry * 0.3) + (Mutation Rarity * 0.4) + (Lineage Purity * 0.3)` and awards seasonal badges/coins. |
