# CMBS Roguelike — the app

A roguelike campaign for *Combat Mission: Black Sea*, driven from a page in your browser. You buy
a force once; the app generates every battle, the enemy that holds it, and the campaign file the
game plays. After each battle it reads the save the game writes by itself and tells you exactly
who died — no number is ever typed in by hand.

The app is a local Node server with **no dependencies** and no build step. It never overwrites a
file in the game folder and never deletes one.

## Getting it running

The full step by step, for someone who has never run it: **[SETUP.md](../SETUP.md)**. The short version:

**What you need**: Combat Mission: Black Sea installed. The release package carries its own Node.js
(`app\node`); from the source code you need Node.js 20.11 or newer. Nothing else — the app has no
dependencies, nothing to install, no build step.

1. Put this folder anywhere you like. Every path inside it is worked out from where the file
   itself sits, so the Desktop, another drive, a folder with spaces or accents in its name all
   work the same.
2. In the release package, double-click **`CMBS Roguelike.exe`**: it starts the server with no
   console window, opens the app in its own window (Edge in app mode, or the default browser) and
   keeps an icon in the system tray (Open / Quit). The alternative, and the way from the source, is
   **`app\Start Campaign.cmd`**, or `node app/server.mjs` from a terminal.
3. The page is at <http://localhost:8765>.

Nothing is ever downloaded or installed.

**Where your data lives.** Settings (`settings.json`) and every campaign are kept in the data
folder, `%LOCALAPPDATA%\CMBS Roguelike`, so a new version extracted into a new folder finds them.
Two exceptions keep them beside the app, in `app\`: a source checkout (it has `.git`), and an app
folder that already holds `app\campaigns` or `app\settings.json`. The environment variable
`CMBS_DATA_DIR` overrides both. Setup shows the folder in use, with an **Open folder** button.

On the first run the app looks for the game on its own: it asks Steam where its libraries are
(the registry and `libraryfolders.vdf`) and GOG Galaxy where it installed its games (the
registry), then tries the paths the Battlefront, Matrix and GOG installers use, then the same
handful of paths on every drive. It scores each candidate by what is
actually inside it and keeps the fullest one, so a folder that merely has the right name does not
win. If it finds nothing, the app opens on **Setup** and asks for the folder — the one called
`Game Files`, the one that holds `Scenarios` and `Campaigns`. Press Save and restart the app.

The folder it found, and how it found it, are on the Setup screen with everything else the app
needs, each line green or red. That table is the first place to look when something does not work.

### What comes with it, and what does not

Everything the app builds a campaign from is in this repository, so two people with the same
version get the same campaign from the same seed:

- `assets/lib` — the formation library, one `.btt` per buyable formation. **This was built by
  hand in the game's editor; it is not part of any install**, which is why it ships here. Without
  it the app would open with nothing to buy.
- `assets/qb_attack` and `assets/qb_meet` — the maps, with a manifest of hashes.
- `assets/campaign_template_red.cam` — the header cloned into every generated campaign.
- `research/*.json` — the unit type table, the map census and the costs.

From the game folder the app only ever reads the saves and writes its own campaign file. It never
overwrites anything, and everything it produces also lands in `<data folder>\campaigns\<slug>\`.

One switch on Setup reads the formation library beside the game folder instead of this one. Leave it
off unless you are editing the library: a campaign built against your own copy is not reproducible
on anyone else's machine.

### Moving it later

The app's own folder can move, or be replaced by a new version, at any time: nothing in a campaign
points into it. The data folder holds the campaigns; if it is moved by hand, the app re-anchors each
campaign's force file to the new place when it opens it. The game folder is the one that must stay
where it is while a campaign is in progress, because the campaign records the paths of the saves.

## The loop

1. **New campaign — the parameters.** Everything decided once, on a screen of its own, because
   none of it can change halfway without making the battles behind and the battles ahead two
   different games:
   - **Your library** — any combination of the three armies: United States, Ukraine, Russia. Your
     force can mix them; the battle file declares one nationality and the app writes whichever
     army most of the force belongs to (FORMATO 108).
   - **The enemy** — one of the two sides, *United States and Ukraine* or *Russia*. Where the side
     has two armies the defending one is drawn fresh each battle, so a campaign against the
     American side really does put Ukrainians across the line some of the time. Nothing stops you
     putting the enemy's army in your own library and fighting your own — the game has two sides,
     not three allegiances — and the screen says so when you do.
   - **The force ratio** — 1.6, 1.45, 1.3, 1.1 or 0.9 to one, the difficulty (30/10, the ladder;
     01/11 on the enemy's side). You always start with 2,500 credits and climb your own ladder, the
     same at every difficulty: every debrief pays how much it climbs, plus a cover for what the battle
     cost you. The enemy of an ordinary battle is your rung divided by the ratio; a Meeting Engagement
     is 1 : 1 at every level. A force that loses nothing stays at the ratio for the
     whole campaign (`rules.json reward`, `tools/economia/simular.mjs`).
   - **Rescued soldiers** — 0, 25, 50, 75 or 100%. A man who is wounded rather than killed was
     carried off the field, and this is his chance of rejoining his squad free by the next battle.
     The roll is seeded, so reading the same result twice gives the same men back.
2. **Battle Path.** *Create campaign* raises the campaign without a force (18/10/2026): the path of
   battles is drawn first, and you choose battle 1 on it, scouting with operational points.
3. **Quartermaster — the force.** Once battle 1 is chosen, the Quartermaster opens the formation
   library with the campaign's credits: pick a formation, keep the sub-formations you want, watch
   the price, and *Raise the force*. **View** on any row draws its whole order of battle without
   buying it. You attack in every battle; the enemy is generated fresh each time and only your force
   carries its dead forward. To change the force before battle 1, undo back to the battle path.
4. **Intel**, then *Prepare battle 1*: the app builds the battle and writes
   `Campaigns\CMBSDC <slug>.cam` into the game.
5. **Play** — Campaign → `CMBSDC <slug>` → Fight, and play the battle to the end. At the
   transition the game saves by itself.
6. **Read** — back in the page, *Look for the save*. The app reads the after-action report of both
   sides and the state of every one of your soldiers out of that save, and shows you the order of
   battle you were up against — it built that force, so it knows it exactly. The enemy has no
   roster of its own, so its losses are only the totals in the report, never unit by unit.

   Only the transition save of *this* battle gets a button, and the rest are listed with the reason
   they cannot be read. This matters because the wrong file is the app's most expensive mistake:
   applying a result rewrites the roster and builds the next battle on top of it, and there is no
   way back. Three files in `Saved Games` used to pass every check and still be wrong — a save made
   *during* the battle (deployment, a turn, the end-of-battle screen), the file the app itself
   prepared, and a save from an earlier battle of the same campaign. All three carry a roster with
   nobody hurt and the *previous* battle's report, which would have read as "you won and lost
   nobody". They are told apart by three facts in the file: the size of the running-game block (a
   few hundred bytes between missions, one to four megabytes with a battle inside), the hash of
   everything the app has written into the game folder, and the hash of the embedded battle — which
   survives being played byte for byte, so it says which battle a save is from.
7. **Spend** — the debrief ends at the quartermaster, and the result pays credits in three lines:
   the command allotment, the replacement cover and the unused-cover bonus. A bar at the top
   of the screen follows you down it with what is left after everything ticked so far, and a
   **Reset** puts the screen back to how it was when the result landed — the ticked boxes, the
   vehicle marks and the units taken out of the force, and nothing from an earlier battle. Three
   things to spend credits on:
   - **Replacements**: a man who is down goes back on his feet.
   - **Your force and the library**: one selector, the same one the campaign was raised with,
     list or chart. Your own formations are already in it: units in the field are ticked, locked
     and cost nothing, and the dormant ones carry their price — ticking one switches it on for the
     next battle at full strength, and nothing is inserted. Below them, the whole library. A
     formation picked from there joins the campaign for good: the force file is rebuilt with it at
     the end, which leaves every existing core id where it was, and the save's campaign roster
     grows a line for each new unit. Which armies the library offers was settled when the campaign
     was raised and is not asked again. That last part took a byte-level experiment to earn — see
     FORMATO 112.8 and the E14 tests. Selling is the same lever in reverse: the game has no delete,
     only an "absent" bit, which is what switching a unit off already writes.
8. **Apply** — the app builds the next battle, writes it *into that same save*, and hands you a new
   save file to load. Back to 4.

The campaign ends after twelve battles or the third defeat.

## Where everything is written

| what | where |
|---|---|
| campaign file the game plays | `Game Files\Campaigns\CMBSDC <slug>.cam` |
| the save with the next battle in it | next to the original, named `<save> [B02].bts` |
| everything else | `<data folder>\campaigns\<slug>\` (`%LOCALAPPDATA%\CMBS Roguelike\campaigns\<slug>\`, or `app\campaigns\<slug>\` in a source checkout) |

Inside `<data folder>\campaigns\<slug>\`:

```
state.json          the campaign: credits, lives, history, what is waiting to happen
log.jsonl           one JSON object per line, in order — see below
core-force.btt      your army, tagged with the core ids the game tracks between battles
campaign.cam        a copy of what was written into the game folder
battles\NN\
  spec.json         the map, the duration, the defense plan and the exact generator spec
  battle.btt        the battle as it was delivered
  result.json       what the save said afterwards
work\               scratch files kept on purpose (see below)
```

Nothing the app needs to explain itself lives only in the game folder.

## Debugging

**Every step leaves a footprint.** The rule is that nothing important happens without a line in
`log.jsonl`. Each line carries a run id (one per server start), the campaign, the battle, and:

| event | what it records |
|---|---|
| `file.read` / `file.write` | path, size, mtime and sha-256 of every game file read or written |
| `step.start` / `step.ok` / `step.fail` | each call into the byte-level library, its duration, and everything that library printed while it ran |
| `map.picked` · `defense.planned` | the map, the tier, the pool it came from; the enemy backbone, what was kept, what did not fit the budget |
| `core.ready` · `campaign.ready` | how many core units were minted, their id range, which unit types had no roster template |
| `battle.checked` | the structural check on the generated battle |
| `save.scan` · `save.rejected` · `transition.read` | which saves were considered, why one was refused, and the raw after-action numbers behind the verdict |
| `result.applied` · `battle.ready` | credits, lives, and the file you are meant to load next |
| `error` | message, stack and the request id the page showed you |

When the page shows `error 3f2a`, that string is in the log next to the failure.

**The Log button** (top right) shows the tail of the file; **Save diagnostics** writes one JSON with
the state, the rules that were in force, an inventory of every file with its hash, and the last few
hundred events. That file is the whole bug report.

**Scratch files are kept, not cleaned.** `work\core-scratch.btt` and `work\core-side.btt` are the
intermediate steps of minting the core force, and `work\replaced-B*.bts` is the save after
replacement and before the new battle was written into it. They cost disk and they answer "at
which step did it go wrong".

## What is proven and what is new

Everything below the app — writing a battle, tagging a force as core, building the `.cam`, reading
the roster out of a save, writing the next battle into it — comes from `tools/re`, and each of
those routines was proven by loading the result in the game (`research/FORMATO.md`, section 111).
A whole generated campaign was played end to end before this app existed.

The full loop has now been played: a campaign the app minted from library sources loaded, was
fought, and its transition save was read, replaced and handed back with the next battle inside
it. Getting there cost four crashes, and each one left a rule behind (FORMATO 112.1 to 112.3):

- the campaign roster must carry a line for **every** core unit, present or not — pruning switches
  a unit off, it does not remove it;
- position is written by anchoring on the record's shape, never by scanning for a marker byte;
- a formation carries the same type list as a unit, and the core tail must not land on top of it.

All three are now guarded: the app refuses a formation whose units have no roster template, and
`core_teste.mjs` marks all 196 library sources and requires each to grow by exactly 5 bytes per
record.

One thing is still derived rather than read: **the victory level**. The game does not store it in a
generated campaign (FORMATO 111.27), so the app computes it from the after-action points of both
sides. The raw numbers sit next to the verdict on the result screen and in the log, so the reading
can always be checked against the game's own report.

## Checking it

```
node app/test.mjs             the parts that fail quietly: roles, prices, clock, map pool, defense
node tools/re/core_teste.mjs  the byte-level gabarito
```

`test.mjs` exists because these failures are silent — a unit priced as the wrong thing, a battle
longer than its tier allows, a map pool too thin to finish a campaign, an enemy with no infantry.
None of them throw; they just make a worse game.

## Tuning

`data/rules.json` holds every number: the starting credits, the force ratios (they size the enemy), prices, the defense budget per tier, battle lengths, the
replacement cover and its bonus (`reward.replacement`), the price of a replacement, and the thresholds that turn points into a victory
level. The code reads that file and hard-codes nothing. Change a number, restart the server, and
the next campaign uses it.

## Not there yet

**Written up and waiting** (`spec/planos_2026-09-06.md`):

All three are now in (E64/E65). What the quartermaster sells between battles, besides men,
machines and formations:

- **A soldier's weapon — OFF, by the author's call (20/09):** "não precisa da funcionalidade de comprar
  arma para soldados individuais ainda na ferramenta". The code is whole and tested and the screen
  gets it back by setting `gear.enabled` to `true` in `rules.json`. What it does when it is on: the
  menu is what that army carries in your force, so the ammunition for it is known and the delivery
  loads it; two bytes are written in place; the old calibre stays in his pouches, because nothing
  can be taken out of a soldier's record. Priced by class — a rifle is free, a machine gun 40, a
  missile 120. A weapon bought this way is remembered per unit and slot and survives the refit's
  weapon reset (E78), so turning it on later does not fight the "everything back to default" rule.
- **Operational abilities**, for the next battle only: +15 or +30 minutes on the clock, "push on"
  (+30 minutes but your men neither rearm nor rest, which is why it is the cheapest), intelligence
  (the enemy order of battle before you go in) and interdiction (the defense gets a fifth less to
  spend). The clock lands on a length the game offers and the screen says what you actually got.
- **Training**: one step of experience for a unit in the field, up to Veteran. Above that it is
  earned in battle. The price follows what the unit is worth.

And one thing the quartermaster does not sell, because it comes free: **grenades**. They are not in
the ammunition vector at all — each grenade is a 3-byte entry elsewhere in the soldier's record — so
until 17/09 nothing replaced them, and four units in the test campaign had reached zero and would
have stayed there. They now come back with the refit, up to what that slot carries, which is also
why "push on" does not bring them back.

**Still not there:**

- **Naming the last weapons.** 10 pairs have no name yet, and the id space is per army
  (FORMATO 118.1), so a name read in one army says nothing about the same pair in another. Seven of
  the ten only ever appear on the AI's side, which needs a purpose-built Russian force.
- **The rest of a soldier's inventory** — charges, smoke, the odd disposable tube. The grenade path
  (FORMATO 113.7) is the same mechanism, so this is now a short step rather than a mystery.

**Known, small, not written up:**

- **Selling a unit back.** The lever is proven and already used in reverse (a unit switched off is
  a unit the game does not have); what is missing is the button and what it refunds.
- **More than one backbone formation in a defense**: the engine buys whole sub-formations out of a
  single library source, so the enemy is always one battalion's worth of troops.
- **A title on the generated scenario** — every battle shows up in the game under the campaign's
  name, not its own.
- **The victory level is derived, not read.** A generated campaign does not store the level
  (FORMATO 111.27), so the app works it out from the points of both sides. It has matched every
  battle so far, but it is a reading, not the game's own word.
- **The 28 maps whose big setup zone belongs to the red side.** The player would have to fight as
  blue to attack on them, and their AI plans are written for the other side (FORMATO 112.6).
- **The chart** does not collapse identical siblings (three identical platoons are three blocks),
  and gets wide with many branches open.
