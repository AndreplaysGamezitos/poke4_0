# PokeFodase - Game Design Document

## 1. Game Overview

**Game Title:** PokeFodase  
**Genre:** Turn-based Strategy / Party Game  
**Platform:** PC (Unity)  
**Target Audience:** Pokémon fans, party game enthusiasts  
**Game Mode:** Local Multiplayer (2-8 players)

### High Concept
PokeFodase is a competitive, turn-based Pokémon board game where players catch Pokémon, build teams, purchase items, and battle each other in tournaments. The first player to earn 6 badges wins the game.

---

## 2. Core Game Loop

The game follows a cyclical structure:
1. **Catching Phase** → Players take turns catching wild Pokémon from routes
2. **Town Phase** → Players purchase items and upgrades
3. **Tournament Phase** → Players battle each other in bracket-style tournaments
4. **Repeat** → Progress to next route and repeat the cycle

---

## 3. Game Phases

### 3.1 Initial Setup Phase
**Objective:** Create players and select starting Pokémon

- Players create their characters by:
  - Entering a player name
  - Selecting an avatar picture
  - Maximum of 8 players can join
- Each player selects one starter Pokémon from available options
- Player order is determined randomly after initial selection

### 3.2 Catching Phase
**Objective:** Catch Pokémon to build and strengthen your team

**Mechanics:**
- Each player gets 2 encounters per route (total encounters = n_players × 2)
- Players take turns in rotating order
- Wild Pokémon appear randomly from the current route's encounter pool
- Each Pokémon cannot appear twice in the same catching phase

**Player Actions:**
- **Catch (C key):** 
  - Standard catch: Roll dice (0-5), success on 4+
  - Ultra Ball catch: Guaranteed success (if owned)
  - Successful catch adds Pokémon to team (max 6)
  - If team is full, receive R$2 instead
  
- **Attack (A key):**
  - Deal damage to wild Pokémon based on active Pokémon's attack
  - Damage formula: `(player_pokemon_attack / 10) × type_multiplier`
  - Type effectiveness affects damage (0.1x to 2x multiplier)
  - Successfully defeating a Pokémon grants 1 EXP to attacking Pokémon
  - Grants 1 EXP regardless of kill or damage dealt

**Catching Phase HP System:**
- Wild Pokémon HP = `(pokemon_base_hp / 10) × 3`
- Reduces HP when attacked
- Pokémon escapes if killed (doesn't count as captured)

### 3.3 Town Phase
**Objective:** Manage resources and strengthen your team

**Rewards:**
- All players receive R$3 upon entering town

**Available Actions (once per player per town visit):**

1. **Sell Pokémon (R$2 + evolution_level)**
   - Cost: Free
   - Cannot sell if only 1 Pokémon remains
   - Selling price = R$2 + evo_number
   - Removes Pokémon from team

2. **Buy Evo Soda (R$1)**
   - Grants 1 EXP to active Pokémon
   - Can trigger evolution if conditions are met

3. **Buy Ultra Ball (R$3)**
   - Guarantees next catch attempt
   - Consumed on use

4. **Buy Mega Stone (R$5)**
   - Can only be purchased ONCE per player per entire game
   - Purchasing the Mega Stone allows you to Mega Evolve one Pokémon
   - To Mega Evolve: Click on a Pokémon that has a Mega Evolution available
   - Mega Evolution is permanent for the rest of the game
   - Only fully evolved Pokémon with Mega forms can be Mega Evolved
   - Pokémon that can Mega Evolve:
     - **Kanto:** Venusaur, Charizard, Blastoise, Beedrill, Pidgeot, Alakazam, Slowbro, Gengar, Kangaskhan, Pinsir, Gyarados, Aerodactyl, Mewtwo
     - **Johto:** Ampharos, Steelix, Scizor, Heracross, Houndoom, Tyranitar
   - Mega Evolved Pokémon receive significant stat boosts

**Turn Order:**
- Each player takes one action before proceeding
- All players must finish their town actions before tournament starts

### 3.4 Tournament Phase
**Objective:** Battle other players to earn badges and money

**Structure:**
- Bracket-style tournament
- Number of brackets = `ceil(n_players / 2)`
- Matchups are randomized
- Higher badge count gets priority bracket position
- Odd player count: one player gets bye (fights previous match winner)

**Battle System:**
- Turn-based combat between two players
- Each player selects Pokémon from their team one at a time
- Speed stat determines turn order
- Battle continues until one player loses all Pokémon

**Battle HP System:**
- Battle HP = `(pokemon_base_hp / 10) × 3`
- Separate from catching phase HP (fresh HP each battle)

**Battle Mechanics:**
- Damage formula: `ceil(attacker_attack × 0.1 × type_multiplier)`
- Type effectiveness multipliers range from 0.1x to 2x
- When a Pokémon reaches 0 HP, it faints
- Player must select next Pokémon
- Battle ends when one player has no Pokémon remaining

**Victory Rewards:**
- Winner receives R$2
- Winner receives 1 badge
- Tournament continues until all brackets are completed

**Progression:**
- After all tournament matches complete, advance to next route
- New catching phase begins with new Pokémon pool

---

## 4. Pokémon System

### 4.1 Pokémon Stats
Each Pokémon has the following attributes:
- **Name:** Unique identifier
- **Type:** Defensive type (normal, fire, water, grass, electric, etc.)
- **Attack Type:** Type of damage dealt in battle
- **HP:** Base health points
- **Attack:** Base attack power
- **Speed:** Determines turn order in battle
- **Evolution:** Reference to next evolution form (if applicable)
- **Evolution Number:** Tracks how many times evolved
- **Has Mega:** Boolean indicating mega evolution availability

### 4.2 Evolution System

**Standard Evolution:**
- Requires 4 EXP points (configurable via `exp_to_evolve`)
- EXP gained from:
  - Attacking wild Pokémon (1 EXP)
  - Defeating wild Pokémon (1 EXP)
  - Purchasing Evo Soda (1 EXP)
- EXP indicator shows progress (visual feedback)
- Automatic evolution when threshold reached
- Resets EXP to 0 after evolution

**Mega Evolution:**
- Requires Pokémon with `has_mega` flag
- Must reach EXP threshold first
- Requires purchasing Mega Evolution Stone (R$3)
- One-time permanent transformation
- Different from standard evolution chain

### 4.3 Type System
**14 Pokémon Types:**
- Normal
- Fight (Fighting)
- Fly (Flying)
- Poison
- Ground
- Rock
- Bug
- Ghost
- Fire
- Water
- Grass
- Elec (Electric)
- Psyc (Psychic)
- Dragon

**Type Effectiveness:**
The game implements a comprehensive type chart with multipliers:
- **Super Effective:** 2x damage
- **Normal:** 1x damage
- **Not Very Effective:** 0.5x damage
- **Immune:** 0.1x damage (essentially no damage)

---

## 5. Economy System

### 5.1 Currency
- Currency: R$ (Brazilian Real reference)
- Starting money: R$0
- All players start on equal footing

### 5.2 Income Sources
1. **Town Phase Entry:** +R$3 (automatic)
2. **Tournament Victory:** +R$2 per win
3. **Full Team Catch:** +R$2 (when catching with 6 Pokémon)
4. **Selling Pokémon:** R$2 + evolution level

### 5.3 Shop Items
| Item | Cost | Effect |
|------|------|--------|
| Evo Soda | R$1 | +1 EXP to active Pokémon |
| Ultra Ball | R$3 | Guaranteed catch (single use) |
| Mega Stone | R$3 | Enable mega evolution |

---

## 6. Player System

### 6.1 Player Attributes
- **Player Number:** Unique identifier (0-4)
- **Player Name:** Custom name
- **Player Picture:** Selectable avatar
- **Team:** List of owned Pokémon (max 6)
- **Active Pokémon:** Currently selected Pokémon for actions
- **Money:** Current R$ balance
- **Ultra Balls:** Owned ultra ball count
- **Badges:** Victory count (0-6)

### 6.2 Team Management
- Maximum 6 Pokémon per team
- Minimum 1 Pokémon (cannot sell last one)
- Active Pokémon indicated by visual outline
- Players can switch active Pokémon during town phase
- Team composition affects battle strategy

---

## 7. Route System

### 7.1 Route Structure
- Multiple routes with progressive difficulty
- Each route has:
  - Unique background graphics
  - Specific Pokémon encounter pool
  - Different encounter distributions

### 7.2 Route Progression
- Players advance to next route after tournament completion
- Route counter displays: "Current Route / Total Routes"
- Each route represents a game stage
- Later routes presumed to have stronger Pokémon

---

## 8. Win Condition

**Victory:** First player to earn 6 badges wins the game

**Endgame:**
- Victory screen displays winner's name
- Humorous victory message displayed
- Game ends, no further actions possible

---

## 9. Game States

The game uses a state machine architecture:

### Base States
- `"initial"` - Game startup and player creation
- `"catching"` - Pokémon catching phase
- `"town"` - Town shopping phase
- `"tournment"` - Tournament bracket selection
- `"battle"` - Active combat
- `"cooldown"` - Transition/message display

### Temporary States
- `"select_poke"` - Selecting Pokémon for battle
- `"battle_end"` - Battle conclusion processing

---

## 10. User Interface

### 10.1 Player Creation Screen
- Name input field
- Avatar selection carousel
- Player list display
- "Start Game" button (requires minimum 2 players)
- Maximum 8 players notification

### 10.2 Catching Phase UI
- Route counter (X/Total)
- Wild Pokémon display (enlarged, centered)
- Current Pokémon HP display
- Player turn indicator (outline on active player)
- Action message display
- Player panels showing:
  - Player name and avatar
  - Current team (up to 6 Pokémon)
  - Money balance
  - Ultra ball count
  - Badge count

### 10.3 Pokémon View Cards
Each Pokémon displays:
- Pokémon sprite
- Name
- Type icon (defensive)
- Attack type icon
- HP value
- Attack value
- Speed value
- EXP progress indicator (if can evolve)
- Mega evolution indicator (if applicable)

### 10.4 Town Phase UI
- Four action buttons:
  1. Sell Pokémon
  2. Buy Evo Soda
  3. Buy Ultra Ball
  4. Mega Evolution Stone
- Continue button (to next player)
- Buttons become non-interactable after use
- Price and effect clearly labeled

### 10.5 Tournament UI
- Bracket display showing matchups
- Player names in VS format
- Player avatars (if available)
- "Start Fight" button for each bracket
- Battle arena view when fighting

### 10.6 Battle UI
- Two Pokémon display zones (left and right)
- Active Pokémon for each player
- HP bars with color indicators (white = full, red = damaged)
- Battle log messages
- Player icons showing who's battling

---

## 11. Controls

### Keyboard Inputs
- **C Key:** Attempt to catch Pokémon (catching phase)
- **A Key:** Attack wild Pokémon (catching phase)
- **Mouse Click:** All UI interactions (buttons, Pokémon selection)

### Mouse Interactions
- Click Pokémon card to set as active
- Click town buttons to purchase items
- Click "Continue" to advance turn
- Click bracket to start battle
- Click Pokémon to send to battle

---

## 12. Game Balance

### 12.1 Economic Balance
- Town income (R$3) covers:
  - 3 Evo Sodas OR
  - 1 Ultra Ball OR
  - 1 Mega Stone + potential savings
- Forces strategic decisions
- Selling Pokémon provides emergency funds

### 12.2 Combat Balance
- Speed stat determines turn advantage
- Type effectiveness creates strategic depth
- Team size affects battle duration
- Evolution increases power level

### 12.3 Progression Balance
- 2 encounters per player maintains pace
- Tournament after each route provides rhythm
- 6 badges for victory requires ~6 tournament wins
- Minimum 6 routes to complete game

---

## 13. Special Features

### 13.1 Turn-Based Multiplayer
- Local hotseat gameplay
- Visual turn indicators
- Cooldown system for message readability
- Fair turn rotation

### 13.2 Dynamic Encounter System
- Random Pokémon from route pool
- Each Pokémon only appears once per catching phase
- Prevents duplicate encounters
- Encourages strategic catching vs attacking

### 13.3 Experience System
- Visual EXP tracking
- Multiple ways to gain EXP
- Automatic evolution trigger
- Mega evolution as alternative progression

### 13.4 Bracket Tournament System
- Randomized matchups
- Badge-based seeding
- Handles odd player counts
- Multi-round elimination

---

## 14. Technical Architecture

### 14.1 Singleton Pattern
- `Game_Manager` - Central game controller
- `PlayerCreation` - Player setup manager
- Ensures single source of truth

### 14.2 ScriptableObjects
- `Pokemon` - Pokémon data assets
- `Route` - Route configuration assets
- Enables designer-friendly data management

### 14.3 Component System
- `Player` - Player data and UI management
- `PokemonView` - Individual Pokémon card logic
- `TournmentBracket` - Battle matchup handler
- `SelectInitialButton` - Starter selection

### 14.4 Game Speed Control
- Configurable `game_speed` variable
- Affects cooldown timer speed
- Allows pacing adjustments for different playstyles

---

## 15. Future Expansion Possibilities

### Potential Features
1. **Online Multiplayer** - Mirror networking integration partially implemented
2. **More Routes** - Additional stages with unique Pokémon
3. **Special Abilities** - Pokémon-specific moves
4. **Status Effects** - Poison, burn, paralysis, etc.
5. **Item Variety** - Potions, revives, held items
6. **AI Players** - Computer-controlled opponents
7. **Save System** - Resume games in progress
8. **Achievement System** - Track player accomplishments
9. **Legendary Pokémon** - Rare, powerful encounters
10. **Custom Tournaments** - Different bracket structures

---

## 16. Design Philosophy

### Core Pillars

1. **Accessibility**
   - Simple controls (2 keys + mouse)
   - Clear visual feedback
   - Understandable mechanics

2. **Strategic Depth**
   - Type effectiveness system
   - Resource management
   - Team composition choices
   - Risk/reward in catching vs attacking

3. **Social Experience**
   - Local multiplayer focus
   - Quick turns
   - Visible player progression
   - Competitive tournament structure

4. **Pokémon Inspiration**
   - Familiar type system
   - Evolution mechanics
   - Catching and battling core loop
   - Recognizable structure with unique twist

---

## 17. Known Mechanics & Edge Cases

### Catching Phase
- If ultra_balls > 0, automatically used on catch attempt
- Killing Pokémon still grants EXP even if capture failed
- Full team catch converts to R$2 automatically

### Battle Phase
- Pokémon HP resets between battles
- Speed determines initial turn order
- After first attack, turn alternates
- Cannot change Pokémon voluntarily (only when fainted)

### Town Phase
- Actions locked after use until next town visit
- Cannot sell last Pokémon
- Mega stone only purchasable if conditions met

### Evolution
- Standard evolution is automatic at 4 EXP
- Mega evolution requires manual purchase
- EXP resets after evolution
- Cannot mega evolve without sufficient EXP

---

## 18. Portuguese Language Elements

The game includes Portuguese text elements:
- Currency: R$ (Brazilian Real)
- Messages and UI text in Portuguese
- Culturally localized humor in victory messages

**Example Messages:**
- "capturou" (captured)
- "matou" (killed)
- "causou X de dano" (dealt X damage)
- "vendeu" (sold)
- "Sem grana" (No money)
- "Você é oficialmente UM MERDA" (victory message - humorous)

---

## 19. Victory Screen

**Endgame Sequence:**
1. Player reaches 6 badges
2. Tournament panel closes
3. Victory screen activates
4. Display winner name with message
5. Game becomes unresponsive (end state)

---

## 20. Summary

PokeFodase is a competitive local multiplayer game that distills Pokémon's catching, training, and battling into a streamlined party game experience. Players race to earn 6 badges through strategic catching, smart resource management, and tactical battles. The turn-based structure ensures all players stay engaged, while the type effectiveness system and evolution mechanics provide depth. The game successfully balances accessibility with strategic decision-making, making it enjoyable for both casual Pokémon fans and competitive players.

**Core Success Factors:**
- Simple yet deep gameplay loop
- Social multiplayer experience
- Strategic resource management
- Familiar Pokémon mechanics with unique twist
- Clear progression and win condition

---

## Document Information
- **Version:** 1.0
- **Created:** January 2026
- **Game Version:** Current Build
- **Status:** Design Documentation Complete
