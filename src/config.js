/**
 * @module config
 * @description Game constants and balance values for PokeFodase v3.0.
 * All tuneable game parameters live here — never use magic numbers elsewhere.
 */

module.exports = {
  // ── Player limits ──────────────────────────────────────────
  MAX_PLAYERS: 8,
  MIN_PLAYERS: 2,
  RANKED_PLAYERS: 4,
  MAX_TEAM_SIZE: 6,

  // ── Routes & win condition ─────────────────────────────────
  TOTAL_ROUTES: 5,
  RANKED_TOTAL_ROUTES: 4,
  BADGES_TO_WIN: 5,
  RANKED_BADGES_TO_WIN: 4,
  EXP_TO_EVOLVE: 6,

  // ── Catching ───────────────────────────────────────────────
  TURNS_PER_PLAYER: 8,
  FULL_TEAM_CATCH_REWARD: 2,

  // ── Town ───────────────────────────────────────────────────
  TOWN_INCOME: 3,

  // ── Shop prices ────────────────────────────────────────────
  PRICE_EVO_SODA: 1,
  PRICE_ULTRA_BALL: 3,
  PRICE_MEGA_STONE: 5,
  PRICE_HP_BOOST: 2,
  PRICE_ATTACK_BOOST: 2,
  PRICE_SPEED_BOOST: 2,
  SELL_BASE_PRICE: 2,

  // ── Stat boosts ────────────────────────────────────────────
  HP_BOOST_VALUE: 10,
  ATTACK_BOOST_VALUE: 10,
  SPEED_BOOST_VALUE: 10,

  // ── PvP ────────────────────────────────────────────────────
  PVP_WIN_GOLD: 2,

  // ── Timers (seconds unless noted) ──────────────────────────
  INITIAL_TIMER: 10,             // 10s per player for starter selection (all modes)
  TURN_TIMER_RANKED: 5,
  TURN_TIMER_CASUAL: 10,        // 10s per catch/attack in casual too
  TOWN_TIMER_RANKED: 60,
  TOWN_TIMER_CASUAL: 90,        // 90s town phase for casual
  REPLACEMENT_TIMER: 5,
  BATTLE_TURN_DELAY_MS: 1000,
  ROOM_CLEANUP_MS: 10 * 60 * 1000, // 10 minutes

  // ── ELO ────────────────────────────────────────────────────
  ELO_STARTING: 0,
  ELO_K_FACTOR: 32,
  ELO_PLACEMENT_CHANGES: { 1: 25, 2: 10, 3: -10, 4: -25 },
  GOLD_PLACEMENT_REWARDS: { 1: 10, 2: 4, 3: 0, 4: 0 },

  // ── Valid game states ──────────────────────────────────────
  GAME_STATES: ['lobby', 'initial', 'catching', 'town', 'tournament', 'battle', 'finished'],
};
