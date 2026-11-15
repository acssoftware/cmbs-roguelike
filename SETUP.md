# CMBS Roguelike — setup, step by step

A roguelike campaign layer for *Combat Mission: Black Sea*. You buy a force once and the app
generates every battle, the enemy that holds it, and the campaign file the game plays. After each
battle it reads the save the game writes by itself and works out exactly who died — you never type
a result in by hand.

This page is everything you need to go from a downloaded folder to a battle you can play.

---

## Before you start

| You need | Why |
|---|---|
| **Windows 10 or 11** | the game, the launcher and the way the app finds the game are Windows only |
| **Combat Mission: Black Sea** (Steam, GOG or Battlefront), installed, run at least once, **updated to patch 2.17** | the app writes its campaign into the game's own folders and reads the game's saves; it was tested on 2.17, and an older patch is warned about |

**Nothing to install.** The package carries its own Node.js (`app\node\node.exe`, the official
build, checked against nodejs.org's published hash when the package was made), and the app opens in
a window of its own through Microsoft Edge, which every Windows 10/11 has (or in your default
browser). If you run the app from the source code instead, you need **Node.js 20.11 or newer**
(<https://nodejs.org>, the LTS installer).

Nothing is downloaded at runtime. There are no other dependencies, no build step, no account, and
nothing leaves your machine — the server listens on `127.0.0.1` and talks to nobody.

---

## Step 1 — Extract the whole zip

Anywhere you like: Desktop, another drive, a path with spaces or accents. You get one folder,
named with the version (`CMBS-Roguelike-1.0.0`):

```
CMBS-Roguelike-1.0.0\
    CMBS Roguelike.exe   starts the app
    SETUP.md             this page
    app\                 the server, the page and the portable Node.js
    tools\               the library that reads and writes the game files
    assets\              the formations, the maps and the campaign template
    research\            the generator data tables
```

**Extract all of it.** The app stops on startup and says what is missing if only part of the folder
was copied.

**Your campaigns do not live in this folder.** The app keeps your settings and every campaign in

```
%LOCALAPPDATA%\CMBS Roguelike\
```

(paste that into the Explorer address bar, or press **Setup > Open folder**). So you can move or
rename the app's folder, or replace it with a new version, without losing a campaign.

## Step 2 — Start it

Double-click **`CMBS Roguelike.exe`**.

**The first time, Windows may warn you** with a blue "Windows protected your PC" screen
(SmartScreen). The program is not signed with a paid certificate, which is what that screen is
about. Press **More info**, then **Run anyway**. It asks once. The program's source code is in
`app\launcher\Launcher.cs` and `tools\lancador\compilar.mjs` rebuilds it, if you want to check it.

No console window opens. The app starts in the background and opens its window; a **CMBS Roguelike
icon appears in the system tray**, next to the clock (it may be under the **^** arrow). That icon
is the app:

- **Closing the window does not stop the app.** Double-click the icon, or right-click > **Open**,
  to bring the window back. Starting `CMBS Roguelike.exe` again does the same.
- Right-click > **Quit** (or **Quit** on the start menu of the app) stops it. While a battle is
  being built the app refuses to quit and says so; wait for it to finish.
- Right-click > **Open in default browser** opens the app in your usual browser instead of the
  Edge window. Right-click > **Show log** shows what the server printed.

**The alternative launcher** is `app\Start Campaign.cmd`: the same app with a console window that
stays open beside it (closing the console stops the app). Use it if the `.exe` does not start.

If the app says Node.js was not found, the package was not extracted whole (`app\node\` is
missing): extract the zip again.

## Step 3 — Let it find the game

On the first run the app goes looking for Combat Mission on its own. It asks Steam where its
libraries are (the registry, then `libraryfolders.vdf`, so a game on a second drive is found), asks
GOG Galaxy where it installed its games, tries the folders the Battlefront, Matrix and GOG installers
use, and then the same handful of paths on every drive you have. Each candidate is scored by what is actually inside it, so a folder
with the right name and nothing in it does not win.

**The first time**, the page opens on **System check**: one line per thing the app needs, each with
✓ (fine), ⚠ (a warning; the app goes on) or ✗ (must be fixed; **Continue** stays off until it is),
and what to do about it:

| Line | ✗ / ⚠ means | What to do |
|---|---|---|
| Windows | not Windows | the app runs on Windows only |
| Node.js | older than 20.11 | extract the package again, or install the Node.js LTS |
| Campaign folder | the app cannot write to `%LOCALAPPDATA%\CMBS Roguelike` | give your user write permission on it |
| Game folder | no `Scenarios` in the folder found | **Open Setup** and give it the `Game Files` folder (below) |
| Game subfolders | ⚠ `Campaigns` or `Saved Games` was missing and the app created it | nothing; the game uses the same folders |
| Write access | the app cannot write into the game folder | give your user write permission on `Game Files` (Properties > Security) |
| Game version | ⚠ older than 2.17, or not readable | update the game; battles may not load on an older patch |
| App files | something of the package is missing or damaged | extract the whole zip again into a new folder |

**Continue** takes you to the menu. After that the check only opens by itself again while its last
run found a problem. **Setup > Run the system check** runs it again whenever you like, and changing
the game folder in Setup runs it on its own.

**If it finds the game**, that is all: you are done with setup.

**If it does not**, the app opens on **Setup** and asks. Give it the folder called `Game Files` —
the one that contains `Scenarios` and `Campaigns`. On a default Steam install that is:

```
C:\Program Files (x86)\Steam\steamapps\common\Combat Mission Black Sea\Game Files
```

Press **Save**, then **restart the app** (tray icon > **Quit**, then start `CMBS Roguelike.exe` again).
The byte-level library reads the game folder once, when the process starts, so a new folder only
takes effect on a restart. There is also a **Search for it** button that runs the search again and
tells you how many places it looked.

## Step 4 — Read the Setup screen once

Setup shows a table of everything the app needs, each line green or red:

Above the table, **Your campaigns** shows the folder that holds your settings and campaigns, with
an **Open folder** button. Back that folder up and you have backed up every campaign.

| Line | What it is |
|---|---|
| App data | your settings and campaigns (`%LOCALAPPDATA%\CMBS Roguelike`); must be writable |
| Game Files, Scenarios, Campaigns, Saved Games | your install. Scenarios and Campaigns must be writable |
| Formation library | the formations you can buy — ships with the app |
| Quick battle maps | the map pool — ships with the app |
| Campaign template, Unit type table, Map census | data the generator needs — all ship with the app |

Everything except the first five comes in the box, so if the game folder is right, the whole table
should be green. **When something later goes wrong, this table is the first place to look.**

One switch on that screen makes the app read the formation library beside the game folder instead
of the copy that ships with it. Leave it off. It exists for editing the library; a campaign built
against your own copy cannot be reproduced on anyone else's machine.

---

## Step 5 — Raise a force

**Campaigns → New campaign.**

1. **Name it, and pick a difficulty.** Very Easy to Very Hard set every parameter below in one go
   (Medium is the default); change any of them and the campaign becomes Custom.
2. **Your library and the enemy**: the armies you buy from, and the side that defends. You always
   attack; the enemy is generated fresh for every battle.
3. **Force ratio** (Very Easy 1.6 : 1 down to Very Hard 0.9 : 1), rescued soldiers, operational points
   and defeats (0 is Ironman: the first defeat ends the campaign). All chosen once, for the whole
   campaign. You always start with 2,500 credits and every difficulty pays the same; the force ratio
   sizes the enemy of an ordinary battle (a Meeting Engagement is 1 : 1 at every level), and a force
   that loses nothing stays at that ratio to it.
4. **Create campaign.** The campaign is born without a force: first the **Battle Path**, where you
   choose battle 1, then **Start the campaign with battle 1**, which opens the Quartermaster.
5. **Buy a force with the starting credits** in the Quartermaster. The library lists one entry per formation.
   Click one and it opens on the right, where you choose what you actually take.
   - **Chart** draws the order of battle as blocks you can pan and zoom; **List** is the same
     thing as a tree. Blocks and boxes do the same work — use whichever you read faster.
   - Taking a sub-formation on its own is fine. You do not have to tick the battalion above it:
     the headings it needs come along by themselves and show up dashed, marked *heading only*.
   - Every unit is priced for what it is. A Javelin team is not an Abrams.
   - The only fortification on offer is the Target Reference Point, which collapses the call time
     of supporting fire and is priced accordingly.
6. **Raise the force.** The app builds your force and opens **Intel**. There, **Prepare battle 1**
   builds the first battle, the enemy holding it and the `.cam` file, and writes them into the game.
   To change the force before battle 1, undo back to the battle path.

## Step 6 — Play the loop

The campaign screen tells you what to do, in order:

1. **Start Combat Mission: Black Sea.**
2. **Campaign → pick `CMBSDC <your campaign>` → Fight.** It already knows which side is yours.
3. **Play the battle to the AAR screen.** Click "End" and save the game.
4. **Back in the page, press "Look for the save".** The app finds it, reads the after-action
   report of both sides and the state of every one of your soldiers, and shows you the debrief:
   the result, your losses unit by unit, and the enemy order of battle you were actually up
   against — it built that force, so it knows it exactly, down to what the defense cost in
   credits and what experience each of its units fought at.
5. **Go to the quartermaster** and spend what the battle paid — three lines, all on the debrief:
   the **command allotment** (how much your ladder climbs to the next battle, whatever happened), the **replacement cover** (the bill for what you lost, up to a cap,
   times the battle score) and the **unused-cover bonus** (a share of the cap you did not need).
   - **Replacements** put a man who is down back on his feet, 5 credits each. A unit that lost
     its crew comes back with them — that is how a vehicle you lost returns. Units short of men
     are marked with a red cross on the chart and can be brought back to full strength in one
     click.
   - **Your force and the library**, in one selector: your own formations are already in it, with
     the units in the field ticked and free, and the dormant ones carrying their price. Below
     them is the whole library — a formation bought there joins the campaign for good.
6. **Apply.** The app builds the next battle, writes it *into the very save the game just made*,
   and hands you a new save file to load. Back to step 2, except you load that save instead of
   starting the campaign.

The campaign is twelve battles long and ends early when you lose one battle more than the defeats
you allowed at creation.

---

## If something goes wrong

- **"The app is missing part of itself."** Only part of the zip was extracted. The message names
  what is missing. See step 1.
- **The `.exe` does nothing, or says the app is already running.** Look for the tray icon next to
  the clock: the app may still be running from before. Right-click it > **Open**. If there is no
  icon, use `app\Start Campaign.cmd`: its console window shows why the server stops.
- **"Port 8765 is already in use."** Another copy of the app is running (tray icon > **Quit**), or
  another program took that port: change `"port"` in `%LOCALAPPDATA%\CMBS Roguelike\settings.json`
  to 8766 and start the app again.
- **"The server is running an older build than this page."** Reloading will not fix it: quit the
  app from the tray icon and start it again.
- **A red line on Setup.** That is the thing to fix. The line says where it looked and what it
  found.
- **The game crashes on load, or a battle looks wrong.** Open the **Log** drawer (top right) and
  press **Save diagnostics**. That writes one file with the campaign state, every file the app
  produced with its hash, and the log of every byte-level step. Send that file — it is designed to
  make a failure explainable without asking you a single question.
- **Nothing in the game folder is ever overwritten or deleted.** Every file the app produces also
  lands in `%LOCALAPPDATA%\CMBS Roguelike\campaigns\<campaign>\`, so a bad campaign is one folder
  you can delete.

## Updating to a new version

1. Quit the app (tray icon > **Quit**).
2. Extract the new zip anywhere: it is a new folder with the new version in its name.
3. Start `CMBS Roguelike.exe` from the new folder. Your settings and campaigns are found where they
   were, in `%LOCALAPPDATA%\CMBS Roguelike`. If the old version is still running, the new one quits
   it and starts itself. The start menu shows the version in use.
4. Delete the old folder.

Finish a campaign on the version that started it when you can: a new version may build battles
differently.

## Removing the app

Delete the app's folder and `%LOCALAPPDATA%\CMBS Roguelike`. In the game folder, the campaigns the
app made are the files named `CMBSDC <campaign>.cam` in `Campaigns`, and the battles it handed you
are the saves in `Saved Games`; delete them from there if you like. Nothing else was installed: no
registry entries, no shortcuts.

## What ships with the app, and what does not

In the box: the formation library (`assets\lib`), the map pool (`assets\qb_attack` and
`assets\qb_meet`), the campaign template and the generator's data tables. That is deliberate — two
people on the same version get the same campaign from the same seed.

Not in the box, and never touched beyond what is said above: your Combat Mission install.
