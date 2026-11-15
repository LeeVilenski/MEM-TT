# MEM Table Tennis — Next Roadmap

Follow-on to [PLAN.md](PLAN.md) (milestones 1–8 are done). Work through the phases in order:
contact grading is the foundation that serves, drills, objectives and match grades read from.

## Decisions

| Question | Decision |
|---|---|
| Online difficulty | The room creator's realism applies to everyone in the room, contact grading included (it is derived from the realism settings, which the room already shares). |
| How often a sloppy swipe misses at Assisted (85%) | About 10–15%. Gentle, well-placed strokes stay near 0%. |
| Career | A **World Tour** mode: start at MEM, travel through the venues, win tournaments, with some round-robin stages. Add more venues, including at least one outdoors. |

## Phase 1 — Startup overlay (fix)

`setStyle()` flashed the character banner whenever the menu was hidden; restoring the saved player at
startup ran before the title menu opened. Restoring the saved player is now silent.

## Phase 2 — Contact grading

Every contact gets a grade from three signals:

- **Timing:** time from the flick's peak to contact, and whether the flick was still speeding up
  (rushed = LATE) or had faded (EARLY).
- **Sweet spot:** how far the ball was from where *you* put the bat (before the bat magnet).
- **Over-hit:** swipe speed above the realism slider's power cap.

Grades: PERFECT · GOOD · EARLY · LATE · EDGE · OVERHIT. The quality `q` (0–1) scales the angle
assist, adds face-angle error, and scales pace and spin. Window widths and how much quality matters come from
`realismSettings()`, so Arcade stays forgiving and online rooms share the host's setting.
Feedback: a grade pop-up, a dull mishit sound, and match-summary counts.

## Phase 3 — Serves

1. AI reads spin with error (`spinRead` per level). It plans against a *perceived* ball, while
   physics plays the true one, so no-spin and heavy-backspin disguise works.
2. AI adapts to repeated serve types (each repeat sharpens its read).
3. Serves are graded too: timing on the drop and contact height; poor grades reduce the landing assist.
4. Serve quality (net clearance, length, spin) shown after each serve; high serves invite attack.
5. The toss has a sweet zone; too short a hold is an illegal toss.

## Phase 4 — Menus and World Tour

```
Title
├─ Play        → Quick match · Exhibition (vs AI) · Online
├─ World Tour  → its own mode
├─ Training    → Tutorial · Drills · Ball machine
├─ Locker      → Player · Stats · Badges · Unlocks
└─ Settings / Controls
```

**World Tour:** a sequence of stops, starting at MEM HQ. Each stop has a venue and an event:
knockout, round-robin group (top two go through to a final), or a boss exhibition.
Win a stop to unlock the next and earn XP and unlocks. New venues include an outdoor park.

Other game-like additions: a match grade (S/A/B/C) from contact quality, and new badges tied to grades
and serves.

## Phase 5 — Drills

- Scored drills: points from contact grade, target accuracy and spin, plus a combo multiplier; stars from
  score.
- Feed modes: `sequence`, `random` (jittered placement), `reactive` (call-out before the feed),
  `continuous` (multi-ball).
- Drill categories: Fundamentals, Spin reading, Footwork, Placement, Consistency, Timing.
- New drills: Falkenberg footwork, backspin-or-float reading, call-your-shot placement,
  endurance rally, timing trainer.
- A coach report after each drill: early/late tendency, sweet-spot accuracy, one tip.
