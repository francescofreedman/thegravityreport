# Daily Dive (working name)

A daily basketball trivia dive inspired by [Krillion](https://krillion.io/): 7 prompts, 25 seconds each, one typed answer per round.
Rarer answers score more; each point sinks you 10 m. Static page, no server: `/dive/` loads `days/index.json`, then the
newest day file dated on or before the player's local date. `?d=YYYY-MM-DD` previews any listed day without saving.

## Day files

`days/<date>.json` is the question engine's day export, plus a few optional fields the game reads:

```
{date, pushedAt, secondsPerPrompt: 25,
 prompts: [{slot, id, text, rule, tiers: [{name, points}],
            answers: [{name, match, points, tier, aliases?, note?, players?}],
            traps?: {"wrong name": "why it's wrong"}}]}
```

- Points are fixed when the day is pushed and never change afterward. `players` (pick counts) is display-only.
- Tiers: Layup 10, Too Cute 15, Rotation 30, Deep Bench 60, Two-Way 85, Buzzer Beater 100.
- Each prompt has one or two Buzzer Beaters, picked for a good story, each with a `note` shown on the reveal.
  Every other rare answer is Two-Way.
- Add the date to `days/index.json`. `npm test` checks every listed day (tests/dive.test.mjs).

## Matching

`match.js`: accents, punctuation and suffixes are ignored; a last name alone counts when only one answer has it, and a
unique first name counts when the last name is shared. Near misses ask "did you mean ... ?" and need a second submit.
A wrong name shows "not on the board" and the clock keeps running.

## Credits

Team-season data behind the engine's keys: FiveThirtyEight NBA RAPTOR (CC BY 4.0). Player list: nba_api (MIT).
