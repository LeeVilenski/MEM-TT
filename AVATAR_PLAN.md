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

## Phase 1: quick wins on the current shapes ✅

- **Gaze:** the head turns to the ball on a spring, within what a neck can turn; the eyes get
  there first, each aimed on its own so they converge on a near ball. With no ball shown they
  look ahead; celebrations lift the chin, a slump drops it. Works in play, replays and online;
  the character-select turntable looks at you.
- **Hands** (`hand.ts`): palm, four three-jointed fingers and a thumb, merged into one mesh. The
  racket hand holds the handle in a shakehand grip (three fingers wrapped round it, their curls
  solved to fit; index along the back of the blade; thumb on the forehand rubber) and turns with
  the bat. The arm reaches for the wrist. On a backhand the bat is held turned half round, so
  the back of the hand faces the ball. The free hand hangs relaxed, or holds Ed's bottle.
- **Shapes** (`shapes.ts`): thighs, knees, calves and ankles; flared shorts with a hem; trousers
  to a hem over the shoe; upper arms and forearms; a neck flaring into the shoulders; trainers
  with a heel collar, tongue and toe spring. The skull and jaw are one smooth mesh.
- **Materials:** a warm sheen on skin, a soft sheen on cloth, fine strands on hair.
- About 16k triangles per character (from 9k), slightly fewer meshes.

## Phase 2: one continuous body

1. ✅ The joints are a real skeleton (`THREE.Bone`s), with helper bones on each arm: two that
   stretch along the arm for a ball out of reach, three that share the forearm's twist.
2. ✅ Skinned body (`skin.ts`): the body is built as meshes on the bones, then baked into skinned
   meshes, one per material (about 15 draw calls per character, from 50–100), bound standing.
   Each leg is one tube from hip to ankle and each arm one tube from shoulder to wrist, the skin
   shared between bones over the knee and elbow, so they bend in one piece; the forearm twists
   along its length. The bottom of the shirt goes with the hips (it bends at the waist), the top
   of the neck with the head.
3. ✅ Clothes on the same skeleton: shorts hang from the waist and follow the thigh, trousers bend
   with the leg, sleeves go with the shoulder; the shirt keeps its texture layout.
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
