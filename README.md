# CMBS Roguelike

A roguelike campaign layer for *Combat Mission: Black Sea*.

You raise a force once. The app generates a campaign of twelve battles on a branching battle path,
builds each battle for the game (the map, the enemy that holds it, weather, time of day, electronic
warfare, reinforcements), and after you play it reads the save the game wrote and works out exactly
who died. Nothing is typed in by hand. Between battles a quartermaster sells replacements and new
units for the credits the battle earned. The campaign ends after twelve battles, or when you lose
one battle too many.

Everything runs on your machine: a local Node.js server and a page in a window of its own. Nothing
is downloaded or installed, nothing leaves your computer, and the game's own files are never
overwritten.

## Download

**[Latest release](https://github.com/acssoftware/cmbs-roguelike/releases/latest)**: one zip. Extract it anywhere and run
`CMBS Roguelike.exe`.

You need Windows 10 or 11 and *Combat Mission: Black Sea* (Steam, GOG or Battlefront) updated to
patch 2.17. Nothing else: the package carries its own Node.js and opens in Microsoft Edge's app
mode, or in your default browser.

The first start may show Windows' SmartScreen screen ("Windows protected your PC"), because the
launcher is not signed with a paid certificate. Press **More info**, then **Run anyway**. The
launcher's source is [`app/launcher/Launcher.cs`](app/launcher/Launcher.cs);
`tools/lancador/compilar.mjs` rebuilds it with the C# compiler that ships with Windows.

The step by step, from the zip to the first battle: **[SETUP.md](SETUP.md)**.

## How a campaign goes

1. **Raise the force.** Pick an army (United States, Ukraine or Russia) and buy formations from the
   game's own library with a fixed budget. Special Forces teams can be kitted out man by man.
2. **Choose the next battle** on the battle path. Each battle leads to different battles ahead;
   operational points buy a look at a map, or at the enemy's whole order of battle, before you
   commit.
3. **Play it in the game.** The app writes the campaign file and hands you the save; you play the
   battle as you would any other.
4. **Debrief.** The app reads the save: casualties, destroyed vehicles, the outcome. Credits come
   in; the quartermaster repairs, replaces and sells.
5. Repeat. Twelve battles, or one defeat too many, end the campaign with a score, a rank and a
   place in the Hall of Fame.

## Running from the source

Node.js 20.11 or newer is the only requirement. There are no dependencies and no build step:

```
node app/server.mjs
```

or `app\Start Campaign.cmd`. The page is at <http://localhost:8765>. Settings and campaigns are kept
in `%LOCALAPPDATA%\CMBS Roguelike`; a checkout with `.git` keeps them beside the app instead, and
the environment variable `CMBS_DATA_DIR` overrides both. [app/README.md](app/README.md) says how the
app is put together.

The test suite (`app/test.mjs`) runs against the game installed on the author's machine and research
fixtures that are not shipped; it is not expected to pass from this repository alone.

## What is in this repository

| Folder | What |
|---|---|
| `app/` | the server (`server.mjs`), the page (`web/`), the campaign logic (`src/`) and the launcher's source (`launcher/`) |
| `tools/re/` | the byte-level library that reads and writes the game's `.cam`, `.bts` and `.btt` files |
| `tools/lancador/` | compiles the launcher and makes its icon |
| `assets/` | the formation library, the map pool and the campaign template the generator starts from |
| `research/` | the data tables the generator reads: unit types, costs, weapons, maps |

Each release is one commit here, made from the author's working repository by its packager, which
masks paths and names and scans every file before anything leaves. The Node.js runtime and the
compiled `.exe` are in the release zip, not in the repository.

Found a problem? Open an issue and attach the file the app's **Save diagnostics** button writes.

## License

The code and the data tables are under the [MIT License](LICENSE). The files under `assets/` are
derived from the game's own files (its quick-battle maps and formation library) and remain the
property of Battlefront.com; they are shared for use with a legally owned copy of the game. This
project is not affiliated with or endorsed by Battlefront.com or Slitherine.
