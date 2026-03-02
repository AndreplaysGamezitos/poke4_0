/**
 * @module game/battle-logic
 * @description Server-driven battle simulation.
 * The server runs the combat loop with 1-second delays between turns.
 */

const { battleHp, battleDamage, effectiveSpeed, determineTurnOrder } = require('./formulas');
const { getTypeMultiplier } = require('./type-chart');
const { broadcast } = require('../websocket/broadcaster');
const { getConnection, query } = require('../db');
const { transitionTo } = require('./state-machine');
const config = require('../config');

/**
 * Prepare battle_pokemon snapshots for both sides of a match.
 *
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {number} battleId
 * @param {number} player1Id  - player ID (or null for NPC)
 * @param {number|null} player2Id
 * @param {Object[]|null} npcTeam - Array of pokemon_dex rows for NPC
 */
async function prepareBattlePokemon(conn, battleId, player1Id, player2Id, npcTeam) {
  // Player 1 team
  const [p1Team] = await conn.execute(
    `SELECT pp.*, pd.base_hp, pd.base_attack, pd.base_speed,
            pd.type_attack, pd.type_defense, pd.name, pd.sprite_url
     FROM player_pokemon pp
     JOIN pokemon_dex pd ON pd.id = pp.pokemon_id
     WHERE pp.player_id = ?
     ORDER BY pp.team_position`,
    [player1Id]
  );

  for (let i = 0; i < p1Team.length; i++) {
    const p = p1Team[i];
    const hp = battleHp(p.base_hp, p.bonus_hp);
    await conn.execute(
      `INSERT INTO battle_pokemon
       (battle_id, player_side, team_index, pokemon_id, max_hp, current_hp,
        attack, speed, type_attack, type_defense, name, sprite_url)
       VALUES (?, 'player1', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [battleId, i, p.pokemon_id, hp, hp,
       p.base_attack + p.bonus_attack,
       p.base_speed + p.bonus_speed,
       p.type_attack, p.type_defense, p.name, p.sprite_url]
    );
  }

  // Player 2 team (PvP or NPC)
  if (player2Id) {
    const [p2Team] = await conn.execute(
      `SELECT pp.*, pd.base_hp, pd.base_attack, pd.base_speed,
              pd.type_attack, pd.type_defense, pd.name, pd.sprite_url
       FROM player_pokemon pp
       JOIN pokemon_dex pd ON pd.id = pp.pokemon_id
       WHERE pp.player_id = ?
       ORDER BY pp.team_position`,
      [player2Id]
    );

    for (let i = 0; i < p2Team.length; i++) {
      const p = p2Team[i];
      const hp = battleHp(p.base_hp, p.bonus_hp);
      await conn.execute(
        `INSERT INTO battle_pokemon
         (battle_id, player_side, team_index, pokemon_id, max_hp, current_hp,
          attack, speed, type_attack, type_defense, name, sprite_url)
         VALUES (?, 'player2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, i, p.pokemon_id, hp, hp,
         p.base_attack + p.bonus_attack,
         p.base_speed + p.bonus_speed,
         p.type_attack, p.type_defense, p.name, p.sprite_url]
      );
    }
  } else if (npcTeam) {
    for (let i = 0; i < npcTeam.length; i++) {
      const p = npcTeam[i];
      const hp = battleHp(p.base_hp, 0);
      await conn.execute(
        `INSERT INTO battle_pokemon
         (battle_id, player_side, team_index, pokemon_id, max_hp, current_hp,
          attack, speed, type_attack, type_defense, name, sprite_url)
         VALUES (?, 'player2', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [battleId, i, p.id, hp, hp,
         p.base_attack, p.base_speed,
         p.type_attack, p.type_defense, p.name, p.sprite_url]
      );
    }
  }
}

/**
 * Start the server-driven combat loop for a battle.
 * This runs asynchronously with setTimeout for turn delays.
 *
 * @param {number} battleId
 * @param {string} roomCode
 * @param {number} matchId
 */
async function runCombatLoop(battleId, roomCode, matchId) {
  try {
    // Load initial state
    const [battleRows] = await query('SELECT * FROM battle_state WHERE id = ?', [battleId]);
    if (battleRows.length === 0) return;
    const battle = battleRows[0];

    // Get active Pokémon for each side
    const [p1Pokemon] = await query(
      `SELECT * FROM battle_pokemon
       WHERE battle_id = ? AND player_side = 'player1' AND team_index = ?`,
      [battleId, battle.player1_active_index]
    );
    const [p2Pokemon] = await query(
      `SELECT * FROM battle_pokemon
       WHERE battle_id = ? AND player_side = 'player2' AND team_index = ?`,
      [battleId, battle.player2_active_index]
    );

    if (p1Pokemon.length === 0 || p2Pokemon.length === 0) return;

    const p1Active = p1Pokemon[0];
    const p2Active = p2Pokemon[0];

    // Determine first turn by speed
    const firstTurn = determineTurnOrder(p1Active.speed, p2Active.speed);

    await query(
      'UPDATE battle_state SET current_turn = ?, phase = ? WHERE id = ?',
      [firstTurn, 'combat', battleId]
    );

    broadcast(roomCode, 'battle_started_combat', {
      first_turn: firstTurn,
      player1_pokemon: sanitizeBattlePokemon(p1Active),
      player2_pokemon: sanitizeBattlePokemon(p2Active),
    });

    // Start combat turns after delay
    setTimeout(() => executeTurn(battleId, roomCode, matchId, firstTurn), config.BATTLE_TURN_DELAY_MS);
  } catch (err) {
    console.error('Combat loop init error:', err);
  }
}

/**
 * Execute a single combat turn, then schedule the next.
 * @param {number} battleId
 * @param {string} roomCode
 * @param {number} matchId
 * @param {'player1'|'player2'} attackerSide
 */
async function executeTurn(battleId, roomCode, matchId, attackerSide) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Lock battle state
    const [battleRows] = await conn.execute(
      'SELECT * FROM battle_state WHERE id = ? FOR UPDATE',
      [battleId]
    );
    if (battleRows.length === 0 || battleRows[0].phase === 'finished') {
      await conn.rollback();
      return;
    }
    const battle = battleRows[0];

    const defenderSide = attackerSide === 'player1' ? 'player2' : 'player1';
    const attackerIndex = attackerSide === 'player1' ? battle.player1_active_index : battle.player2_active_index;
    const defenderIndex = defenderSide === 'player1' ? battle.player1_active_index : battle.player2_active_index;

    // Load attacker and defender Pokémon
    const [attackerRows] = await conn.execute(
      'SELECT * FROM battle_pokemon WHERE battle_id = ? AND player_side = ? AND team_index = ?',
      [battleId, attackerSide, attackerIndex]
    );
    const [defenderRows] = await conn.execute(
      'SELECT * FROM battle_pokemon WHERE battle_id = ? AND player_side = ? AND team_index = ?',
      [battleId, defenderSide, defenderIndex]
    );

    if (attackerRows.length === 0 || defenderRows.length === 0) {
      await conn.rollback();
      return;
    }

    const attacker = attackerRows[0];
    const defender = defenderRows[0];

    // Calculate damage
    const { damage, multiplier } = battleDamage(
      attacker.attack, 0,
      attacker.type_attack, defender.type_defense
    );

    const newHp = Math.max(0, defender.current_hp - damage);
    const fainted = newHp <= 0;

    // Update defender HP
    await conn.execute(
      'UPDATE battle_pokemon SET current_hp = ?, is_fainted = ? WHERE id = ?',
      [newHp, fainted, defender.id]
    );

    // Increment turn
    await conn.execute(
      'UPDATE battle_state SET turn_number = turn_number + 1 WHERE id = ?',
      [battleId]
    );

    await conn.commit();

    // Broadcast attack event
    broadcast(roomCode, 'battle_attack', {
      attacker_side: attackerSide,
      attacker_pokemon: attacker.name,
      defender_pokemon: defender.name,
      damage,
      type_multiplier: multiplier,
      defender_hp: newHp,
      defender_max_hp: defender.max_hp,
      is_fainted: fainted,
    });

    if (fainted) {
      broadcast(roomCode, 'battle_pokemon_fainted', {
        pokemon_name: defender.name,
        side: defenderSide,
      });

      // Check if defender has remaining Pokémon
      const [remaining] = await query(
        'SELECT * FROM battle_pokemon WHERE battle_id = ? AND player_side = ? AND is_fainted = FALSE',
        [battleId, defenderSide]
      );

      if (remaining.length === 0) {
        // Battle over — attacker side wins
        await finishBattle(battleId, matchId, roomCode, attackerSide);
        return;
      }

      // Need replacement selection
      // For NPC (player2 in NPC battles), auto-select first available
      const [matchRows] = await query(
        'SELECT * FROM tournament_matches WHERE id = ?',
        [matchId]
      );
      const match = matchRows[0];
      const isNpcSide = match.is_npc_battle && defenderSide === 'player2';

      if (isNpcSide) {
        // Auto-select for NPC
        const nextPokemon = remaining[Math.floor(Math.random() * remaining.length)];
        await selectReplacementPokemon(battleId, roomCode, matchId, defenderSide, nextPokemon.team_index);
      } else {
        // Wait for player to select replacement
        broadcast(roomCode, 'battle_needs_replacement', {
          side: defenderSide,
          remaining: remaining.map(sanitizeBattlePokemon),
        });

        // Set a timeout for auto-select in ranked
        const [roomRows] = await query('SELECT * FROM rooms WHERE id = ?', [battle.room_id]);
        if (roomRows.length > 0 && roomRows[0].game_mode === 'ranked') {
          setTimeout(async () => {
            try {
              const [bs] = await query('SELECT * FROM battle_state WHERE id = ?', [battleId]);
              if (bs.length > 0 && bs[0].phase !== 'finished') {
                const activeIdx = defenderSide === 'player1' ? bs[0].player1_active_index : bs[0].player2_active_index;
                const [curActive] = await query(
                  'SELECT * FROM battle_pokemon WHERE battle_id = ? AND player_side = ? AND team_index = ?',
                  [battleId, defenderSide, activeIdx]
                );
                if (curActive.length > 0 && curActive[0].is_fainted) {
                  const [rem] = await query(
                    'SELECT * FROM battle_pokemon WHERE battle_id = ? AND player_side = ? AND is_fainted = FALSE',
                    [battleId, defenderSide]
                  );
                  if (rem.length > 0) {
                    await selectReplacementPokemon(battleId, roomCode, matchId, defenderSide, rem[0].team_index);
                  }
                }
              }
            } catch (e) {
              console.error('Auto-replacement error:', e);
            }
          }, config.REPLACEMENT_TIMER * 1000);
        }
        return; // Wait for player input
      }
      return; // NPC auto-select will schedule next turn
    }

    // No faint — swap turn and continue
    const nextTurn = defenderSide;
    await query('UPDATE battle_state SET current_turn = ? WHERE id = ?', [nextTurn, battleId]);

    setTimeout(() => executeTurn(battleId, roomCode, matchId, nextTurn), config.BATTLE_TURN_DELAY_MS);
  } catch (err) {
    await conn.rollback();
    console.error('Execute turn error:', err);
  } finally {
    conn.release();
  }
}

/**
 * Handle a player selecting a replacement Pokémon after a faint.
 * @param {number} battleId
 * @param {string} roomCode
 * @param {number} matchId
 * @param {'player1'|'player2'} side
 * @param {number} teamIndex
 */
async function selectReplacementPokemon(battleId, roomCode, matchId, side, teamIndex) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Verify the Pokémon is not fainted
    const [pokemonRows] = await conn.execute(
      'SELECT * FROM battle_pokemon WHERE battle_id = ? AND player_side = ? AND team_index = ?',
      [battleId, side, teamIndex]
    );
    if (pokemonRows.length === 0 || pokemonRows[0].is_fainted) {
      await conn.rollback();
      return;
    }

    // Update active index
    const col = side === 'player1' ? 'player1_active_index' : 'player2_active_index';
    await conn.execute(
      `UPDATE battle_state SET ${col} = ? WHERE id = ?`,
      [teamIndex, battleId]
    );

    await conn.commit();

    const pokemon = pokemonRows[0];
    broadcast(roomCode, 'battle_pokemon_sent', {
      side,
      pokemon_name: pokemon.name,
      pokemon: sanitizeBattlePokemon(pokemon),
    });

    // Determine speed for turn order with new active Pokémon
    const [bsRows] = await query('SELECT * FROM battle_state WHERE id = ?', [battleId]);
    if (bsRows.length === 0) return;
    const bs = bsRows[0];

    const otherSide = side === 'player1' ? 'player2' : 'player1';
    const otherIndex = otherSide === 'player1' ? bs.player1_active_index : bs.player2_active_index;

    const [otherPokemon] = await query(
      'SELECT * FROM battle_pokemon WHERE battle_id = ? AND player_side = ? AND team_index = ?',
      [battleId, otherSide, otherIndex]
    );

    if (otherPokemon.length === 0) return;

    // The side that just sent out a Pokémon doesn't get priority — attacker continues
    const nextTurn = otherSide;
    await query('UPDATE battle_state SET current_turn = ? WHERE id = ?', [nextTurn, battleId]);

    setTimeout(() => executeTurn(battleId, roomCode, matchId, nextTurn), config.BATTLE_TURN_DELAY_MS);
  } catch (err) {
    await conn.rollback();
    console.error('Select replacement error:', err);
  } finally {
    conn.release();
  }
}

/**
 * Finish a battle — update match winner, grant rewards.
 * @param {number} battleId
 * @param {number} matchId
 * @param {string} roomCode
 * @param {'player1'|'player2'} winnerSide
 */
async function finishBattle(battleId, matchId, roomCode, winnerSide) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();

    // Mark battle as finished
    await conn.execute(
      "UPDATE battle_state SET phase = 'finished' WHERE id = ?",
      [battleId]
    );

    // Get match info
    const [matchRows] = await conn.execute(
      'SELECT * FROM tournament_matches WHERE id = ? FOR UPDATE',
      [matchId]
    );
    if (matchRows.length === 0) {
      await conn.rollback();
      return;
    }
    const match = matchRows[0];

    let winnerId = null;
    let winnerIsNpc = false;
    let loserName = '';
    let winnerName = '';

    if (winnerSide === 'player1') {
      winnerId = match.player1_id;
    } else {
      winnerId = match.is_npc_battle ? null : match.player2_id;
      winnerIsNpc = match.is_npc_battle;
    }

    // Get player names
    if (match.player1_id) {
      const [p1] = await conn.execute('SELECT player_name FROM players WHERE id = ?', [match.player1_id]);
      if (winnerSide === 'player1' && p1.length > 0) winnerName = p1[0].player_name;
      if (winnerSide === 'player2' && p1.length > 0) loserName = p1[0].player_name;
    }
    if (match.player2_id) {
      const [p2] = await conn.execute('SELECT player_name FROM players WHERE id = ?', [match.player2_id]);
      if (winnerSide === 'player2' && p2.length > 0) winnerName = p2[0].player_name;
      if (winnerSide === 'player1' && p2.length > 0) loserName = p2[0].player_name;
    }
    if (match.is_npc_battle) {
      const gymLeaders = require('../data/gym-leaders.json');
      const leader = gymLeaders.find((l) => l.route === match.npc_route) || gymLeaders[gymLeaders.length - 1];
      if (winnerSide === 'player2') {
        winnerName = leader.name;
        winnerIsNpc = true;
      } else {
        loserName = leader.name;
      }
    }

    // Update tournament match
    await conn.execute(
      'UPDATE tournament_matches SET winner_id = ?, winner_is_npc = ?, status = ? WHERE id = ?',
      [winnerId, winnerIsNpc, 'completed', matchId]
    );

    // Grant badge + gold to winner (if human)
    if (winnerId) {
      await conn.execute(
        'UPDATE players SET badges = badges + 1, money = money + ? WHERE id = ?',
        [config.PVP_WIN_GOLD, winnerId]
      );
    }

    await conn.commit();

    broadcast(roomCode, 'battle_ended', {
      winner_side: winnerSide,
      winner_id: winnerId,
      winner_name: winnerName,
      loser_name: loserName,
      winner_is_npc: winnerIsNpc,
      match_index: match.match_index,
    });

    broadcast(roomCode, 'match_completed', {
      match_index: match.match_index,
      winner_id: winnerId,
      winner_name: winnerName,
    });

    // Transition room back to tournament via the state machine
    await transitionTo(match.room_id, 'tournament', async () => {
      return {};
    });
  } catch (err) {
    await conn.rollback();
    console.error('Finish battle error:', err);
  } finally {
    conn.release();
  }
}

/**
 * Sanitize a battle_pokemon row for client consumption.
 * @param {Object} bp
 * @returns {Object}
 */
function sanitizeBattlePokemon(bp) {
  return {
    team_index: bp.team_index,
    name: bp.name,
    sprite_url: bp.sprite_url,
    current_hp: bp.current_hp,
    max_hp: bp.max_hp,
    type_attack: bp.type_attack,
    type_defense: bp.type_defense,
    is_fainted: !!bp.is_fainted,
  };
}

module.exports = {
  prepareBattlePokemon,
  runCombatLoop,
  executeTurn,
  selectReplacementPokemon,
  finishBattle,
  sanitizeBattlePokemon,
};
