# MEM Table Tennis: more believable characters

The characters are built from simple shapes. Each one is 50–100 separate pieces (a rounded torso,
cylinders for the limbs, balls at the knees and elbows). That gives the stick-figure look: limbs
are plain tubes with ball joints showing, hands are blobs that don't grip the bat, and the head
never turns. The aim is a believable, slightly stylised look, still generated in code (no model
files), with Blender available for heads if the procedural ones aren't good enough.

What must keep working: the animation (the arm reaching the bat handle, twist and lean, shuffle
steps, reactions, Bryony's wheelchair and push arm), the painted shirts in `fabric.ts` (their
texture layout), each character's look settings, the see-through doubles partner, first person,
headless tests, and the `Avatar` interface the rest of the game uses.

## Phase 0: groundwork ✅

No visible change. The refactor was checked against the old code: every mesh in the same place to
5 decimal places through a sequence of poses, and every gallery picture identical.

- **Avatar gallery** (`/avatars.html` in dev): every character in 16 fixed poses and views,
  stepped with a fixed clock, so the pictures repeat exactly. Drag a picture to turn round the
  character.
- **`npm run avatar:shots`**: screenshots the gallery and compares with a saved baseline, writing
  diff images (`--baseline` to save, `--check` to fail on any change).
- **Posing separated from drawing** (`src/render/avatar/`):
  - `looks.ts`: what each character looks like
  - `dimensions.ts`: body measurements shared by the rig and the body
  - `rig.ts`: the joints and all the animation
  - `body.ts`: the meshes hung on the joints
  - `head.ts`: the procedural head
- **A head joint** at the top of the neck carries everything on the head, ready for the head to
  follow the ball and for a Blender-made head to replace it ([docs/avatar-heads.md](docs/avatar-heads.md)).
- **Rest pose and `.glb` export**: a reference to import into Blender and model over.
- **Tests** (`tests/avatar.test.ts`): same clock gives the same pose, the hand reaches the handle
  (or stops at full reach), and everything on the head hangs from the head joint.

## Phase 1: quick wins on the current shapes

- The head and eyes follow the ball (the ball's position is already in replays).
- Shaped calves, thighs and shoulders, a sloped neck, flared shorts with a hem, proper trainers.
- Hands that grip: palm, thumb and curled fingers round the handle, turned with the paddle. The
  other hand in a loose curl.
- A soft sheen on skin, a fabric finish on cloth, a strand texture on hair.

## Phase 2: one continuous body

1. Turn the joints into a real skeleton (`THREE.Bone`s) and hang the current pieces on it. No
   visible change.
2. Build the body as one smooth mesh from shape tables, with the skin blending between bones at
   each joint: elbows and knees bend with no balls showing. A forearm twist bone stops the wrist
   pinching.
3. Clothes as a second layer on the same skeleton; the shirt keeps its texture layout, so the
   painted shirts carry over.
4. A sculpted head (brow, cheekbones, nose bridge, jaw, chin) with the face painted on and 3D
   eyes. This is the point to switch to Blender heads instead, if preferred.
5. Hair from layered strips with a strand texture.

Each character drops from 50–100 pieces to about 5–8.

## Phase 3: movement

Feet that plant and weight that shifts over the front foot; real footwork steps and crossovers;
strokes led by the hips and shoulders, then elbow, then wrist; a swinging ponytail, a moving shirt
hem, breathing between points.

## Phase 4: rendering

A rim light so players stand out from the venue, soft contact shadows, cloth weave detail, and
lower detail on the Low and Medium quality settings.
