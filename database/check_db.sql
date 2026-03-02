-- =====================================================
-- PokeFodase v3.0 — Database Compatibility Check
-- Run on VPS: mysql -u root -p < /var/www/pokefodase/database/check_db.sql
-- =====================================================

USE pokefodase;

SELECT '=== POKEFODASE v3.0 DATABASE CHECK ===' AS '';
SELECT '' AS '';

-- =====================================================
-- 1. CHECK WHICH TABLES EXIST
-- =====================================================
SELECT '--- 1. TABLE EXISTENCE ---' AS '';

SELECT 'accounts' AS `table`, IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING') AS status
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'accounts'
UNION ALL
SELECT 'rooms', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'rooms'
UNION ALL
SELECT 'players', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'players'
UNION ALL
SELECT 'pokemon_dex', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'pokemon_dex'
UNION ALL
SELECT 'player_pokemon', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'player_pokemon'
UNION ALL
SELECT 'wild_pokemon', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'wild_pokemon'
UNION ALL
SELECT 'routes', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'routes'
UNION ALL
SELECT 'route_pokemon', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'route_pokemon'
UNION ALL
SELECT 'starter_pokemon', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'starter_pokemon'
UNION ALL
SELECT 'tournament_matches', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'tournament_matches'
UNION ALL
SELECT 'battle_state', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'battle_state'
UNION ALL
SELECT 'battle_pokemon', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'battle_pokemon'
UNION ALL
SELECT 'elo_history', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'elo_history'
UNION ALL
SELECT 'game_placements', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'game_placements'
UNION ALL
SELECT 'encountered_pokemon', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'encountered_pokemon';

-- Also check for OLD tables that shouldn't exist (or are fine to ignore)
SELECT '' AS '';
SELECT '--- OLD/LEGACY TABLES (ok if present, not used by v3.0) ---' AS '';
SELECT 'game_events (legacy)', IF(COUNT(*) > 0, '⚠️  EXISTS (unused by v3.0)', '✅ NOT PRESENT')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'game_events'
UNION ALL
SELECT 'town_actions (legacy)', IF(COUNT(*) > 0, '⚠️  EXISTS (unused by v3.0)', '✅ NOT PRESENT')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'town_actions'
UNION ALL
SELECT 'ranked_queue (legacy)', IF(COUNT(*) > 0, '⚠️  EXISTS (unused by v3.0)', '✅ NOT PRESENT')
FROM information_schema.tables WHERE table_schema = 'pokefodase' AND table_name = 'ranked_queue';

-- =====================================================
-- 2. CHECK CRITICAL COLUMNS ON accounts
-- =====================================================
SELECT '' AS '';
SELECT '--- 2. accounts TABLE COLUMNS ---' AS '';

SELECT 'accounts.auth_token' AS `column`, IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING — v3.0 needs this for JWT auth') AS status
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'accounts' AND column_name = 'auth_token'
UNION ALL
SELECT 'accounts.avatar_id', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'accounts' AND column_name = 'avatar_id'
UNION ALL
SELECT 'accounts.nickname', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'accounts' AND column_name = 'nickname'
UNION ALL
SELECT 'accounts.account_code', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'accounts' AND column_name = 'account_code'
UNION ALL
SELECT 'accounts.elo', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'accounts' AND column_name = 'elo'
UNION ALL
SELECT 'accounts.gold', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'accounts' AND column_name = 'gold';

-- =====================================================
-- 3. CHECK CRITICAL COLUMNS ON rooms
-- =====================================================
SELECT '' AS '';
SELECT '--- 3. rooms TABLE COLUMNS ---' AS '';

SELECT 'rooms.game_mode' AS `column`, IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING') AS status
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'game_mode'
UNION ALL
SELECT 'rooms.current_match_index', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'current_match_index'
UNION ALL
SELECT 'rooms.winner_player_id', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'winner_player_id'
UNION ALL
SELECT 'rooms.turn_timer', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'turn_timer'
UNION ALL
SELECT 'rooms.town_timer', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'town_timer'
UNION ALL
SELECT 'rooms.updated_at', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'updated_at';

-- Check for OLD columns that v3.0 does NOT use
SELECT '' AS '';
SELECT '--- rooms OLD COLUMNS (should not cause issues) ---' AS '';
SELECT 'rooms.game_data (legacy)', IF(COUNT(*) > 0, '⚠️  EXISTS (ignored by v3.0)', '✅ CLEAN')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'game_data'
UNION ALL
SELECT 'rooms.wild_pokemon_id (legacy)', IF(COUNT(*) > 0, '⚠️  EXISTS (ignored by v3.0)', '✅ CLEAN')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'rooms' AND column_name = 'wild_pokemon_id';

-- =====================================================
-- 4. CHECK CRITICAL COLUMNS ON players
-- =====================================================
SELECT '' AS '';
SELECT '--- 4. players TABLE COLUMNS ---' AS '';

SELECT 'players.account_id' AS `column`, IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING — v3.0 links players to accounts') AS status
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'players' AND column_name = 'account_id'
UNION ALL
SELECT 'players.has_used_mega_stone', IF(COUNT(*) > 0, '✅ EXISTS (v3.0 name)', '⚠️  MISSING — check if has_mega_stone exists instead')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'players' AND column_name = 'has_used_mega_stone'
UNION ALL
SELECT 'players.has_mega_stone (old)', IF(COUNT(*) > 0, '⚠️  OLD NAME — v3.0 expects has_used_mega_stone', '✅ NOT PRESENT (good)')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'players' AND column_name = 'has_mega_stone'
UNION ALL
SELECT 'players.session_id (legacy)', IF(COUNT(*) > 0, '⚠️  EXISTS (not used by v3.0, harmless)', '✅ CLEAN')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'players' AND column_name = 'session_id';

-- =====================================================
-- 5. CHECK CRITICAL COLUMNS ON player_pokemon
-- =====================================================
SELECT '' AS '';
SELECT '--- 5. player_pokemon TABLE COLUMNS ---' AS '';

SELECT 'player_pokemon.bonus_hp' AS `column`, IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING — stat items won''t work') AS status
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'player_pokemon' AND column_name = 'bonus_hp'
UNION ALL
SELECT 'player_pokemon.bonus_attack', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'player_pokemon' AND column_name = 'bonus_attack'
UNION ALL
SELECT 'player_pokemon.bonus_speed', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'player_pokemon' AND column_name = 'bonus_speed'
UNION ALL
SELECT 'player_pokemon.is_mega', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'player_pokemon' AND column_name = 'is_mega';

-- =====================================================
-- 6. CHECK CRITICAL COLUMNS ON pokemon_dex
-- =====================================================
SELECT '' AS '';
SELECT '--- 6. pokemon_dex TABLE COLUMNS ---' AS '';

SELECT 'pokemon_dex.catch_rate' AS `column`, IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING — catching phase won''t work') AS status
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'pokemon_dex' AND column_name = 'catch_rate'
UNION ALL
SELECT 'pokemon_dex.has_mega', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'pokemon_dex' AND column_name = 'has_mega'
UNION ALL
SELECT 'pokemon_dex.mega_evolution_id', IF(COUNT(*) > 0, '✅ EXISTS', '❌ MISSING')
FROM information_schema.columns WHERE table_schema = 'pokefodase' AND table_name = 'pokemon_dex' AND column_name = 'mega_evolution_id';

-- =====================================================
-- 7. CHECK SEED DATA COUNTS
-- =====================================================
SELECT '' AS '';
SELECT '--- 7. SEED DATA COUNTS ---' AS '';

SELECT 'pokemon_dex' AS `table`,
       COUNT(*) AS `rows`,
       CASE
         WHEN COUNT(*) >= 291 THEN '✅ OK (expected 291)'
         WHEN COUNT(*) >= 250 THEN '⚠️  LOW — may be missing megas/gen2'
         WHEN COUNT(*) > 0 THEN '❌ TOO FEW — incomplete seed data'
         ELSE '❌ EMPTY — run seed.sql'
       END AS status
FROM pokemon_dex;

SELECT 'routes' AS `table`,
       COUNT(*) AS `rows`,
       CASE
         WHEN COUNT(*) = 5 THEN '✅ OK (5 merged routes)'
         WHEN COUNT(*) = 8 THEN '⚠️  OLD (8 routes — migration_v2 not applied?)'
         WHEN COUNT(*) > 0 THEN CONCAT('⚠️  UNEXPECTED: ', COUNT(*), ' routes')
         ELSE '❌ EMPTY — run seed.sql'
       END AS status
FROM routes;

SELECT 'route_pokemon' AS `table`,
       COUNT(*) AS `rows`,
       CASE
         WHEN COUNT(*) >= 95 THEN '✅ OK'
         WHEN COUNT(*) > 0 THEN CONCAT('⚠️  LOW: ', COUNT(*), ' assignments')
         ELSE '❌ EMPTY — routes have no pokemon assigned'
       END AS status
FROM route_pokemon;

SELECT 'starter_pokemon' AS `table`,
       COUNT(*) AS `rows`,
       CASE
         WHEN COUNT(*) = 9 THEN '✅ OK (9 starters)'
         WHEN COUNT(*) > 0 THEN CONCAT('⚠️  UNEXPECTED: ', COUNT(*), ' starters')
         ELSE '❌ EMPTY — no starters defined'
       END AS status
FROM starter_pokemon;

-- =====================================================
-- 8. VERIFY KEY POKEMON DATA
-- =====================================================
SELECT '' AS '';
SELECT '--- 8. KEY POKEMON SPOT CHECKS ---' AS '';

SELECT 'Bulbasaur (id=1)' AS `check`,
  CASE WHEN name = 'Bulbasaur' AND type_defense = 'grass' AND type_attack = 'grass'
       AND base_hp = 65 AND evolution_id = 2
       THEN '✅ CORRECT'
       ELSE CONCAT('❌ WRONG — name=', IFNULL(name,'NULL'), ' type_def=', IFNULL(type_defense,'NULL'))
  END AS status
FROM pokemon_dex WHERE id = 1
UNION ALL
SELECT 'Charizard (id=6)',
  CASE WHEN name = 'Charizard' AND type_defense = 'fire' AND type_attack = 'flying'
       AND has_mega = 1 AND mega_evolution_id = 274
       THEN '✅ CORRECT'
       ELSE CONCAT('❌ WRONG — name=', IFNULL(name,'NULL'))
  END
FROM pokemon_dex WHERE id = 6
UNION ALL
SELECT 'Pikachu (id=25)',
  CASE WHEN name = 'Pikachu' AND type_defense = 'electric' AND type_attack = 'electric'
       AND evolution_id = 26
       THEN '✅ CORRECT'
       ELSE CONCAT('❌ WRONG — name=', IFNULL(name,'NULL'))
  END
FROM pokemon_dex WHERE id = 25
UNION ALL
SELECT 'Mewtwo (id=150)',
  CASE WHEN name = 'Mewtwo' AND type_defense = 'psychic'
       AND has_mega = 1
       THEN '✅ CORRECT'
       ELSE CONCAT('❌ WRONG or MISSING — name=', IFNULL(name,'NULL'))
  END
FROM pokemon_dex WHERE id = 150;

-- Check fairy types exist
SELECT '' AS '';
SELECT '--- FAIRY TYPE CHECK ---' AS '';
SELECT CONCAT(COUNT(*), ' pokemon with fairy type_defense') AS fairy_defense,
       CASE WHEN COUNT(*) >= 5 THEN '✅ OK' ELSE '⚠️  LOW' END AS status
FROM pokemon_dex WHERE type_defense = 'fairy';

SELECT CONCAT(COUNT(*), ' pokemon with fairy type_attack') AS fairy_attack,
       CASE WHEN COUNT(*) >= 3 THEN '✅ OK' ELSE '⚠️  LOW' END AS status
FROM pokemon_dex WHERE type_attack = 'fairy';

-- =====================================================
-- 9. CHECK ROUTE POKEMON DISTRIBUTION
-- =====================================================
SELECT '' AS '';
SELECT '--- 9. ROUTE POKEMON DISTRIBUTION ---' AS '';

SELECT r.route_number, r.route_name, COUNT(rp.id) AS pokemon_count,
  CASE
    WHEN COUNT(rp.id) >= 15 THEN '✅ OK'
    WHEN COUNT(rp.id) > 0 THEN '⚠️  LOW'
    ELSE '❌ EMPTY'
  END AS status
FROM routes r
LEFT JOIN route_pokemon rp ON r.id = rp.route_id
GROUP BY r.id
ORDER BY r.route_number;

-- =====================================================
-- 10. CHECK STARTERS
-- =====================================================
SELECT '' AS '';
SELECT '--- 10. STARTER POKEMON ---' AS '';

SELECT pd.name, pd.type_defense, pd.type_attack,
  CASE WHEN pd.evolution_id IS NOT NULL THEN '✅ Can evolve' ELSE '⚠️  No evolution' END AS evolves
FROM starter_pokemon sp
JOIN pokemon_dex pd ON pd.id = sp.pokemon_id
ORDER BY sp.priority;

-- =====================================================
-- 11. CHECK CATCH RATES
-- =====================================================
SELECT '' AS '';
SELECT '--- 11. CATCH RATE DISTRIBUTION ---' AS '';

SELECT catch_rate, COUNT(*) AS pokemon_count
FROM pokemon_dex
WHERE evolution_number = 0 AND pokedex_number > 0
GROUP BY catch_rate
ORDER BY catch_rate DESC;

SELECT CONCAT(COUNT(*), ' pokemon with catch_rate = 0 (megas/not-catchable)') AS info
FROM pokemon_dex WHERE catch_rate = 0;

SELECT CONCAT(COUNT(*), ' pokemon with catch_rate = 30 (default, possibly unset)') AS info
FROM pokemon_dex WHERE catch_rate = 30 AND evolution_number > 0;

-- =====================================================
-- 12. FINAL VERDICT
-- =====================================================
SELECT '' AS '';
SELECT '=== SUMMARY ===' AS '';
SELECT 'If you see ❌ MISSING for accounts.auth_token:' AS '';
SELECT '  → Your DB is the OLD v2.0 schema. You need to run the v3.0 migration.' AS '';
SELECT '' AS '';
SELECT 'If you see ❌ for tournament_matches, battle_state, battle_pokemon, encountered_pokemon:' AS '';
SELECT '  → These are NEW v3.0 tables. You need to run database/schema.sql (or a migration).' AS '';
SELECT '' AS '';
SELECT 'If pokemon_dex has 291 rows, routes has 5, starters has 9 — your seed data is GOOD.' AS '';
SELECT 'If accounts/rooms/players exist with old columns — we can migrate, not rebuild.' AS '';
SELECT '=== END CHECK ===' AS '';
