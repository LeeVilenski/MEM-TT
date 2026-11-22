# Heads made in Blender

The characters' heads are built in code (`src/render/avatar/head.ts`). Any of them can later be
replaced by a head modelled in Blender. This page sets out how a head attaches, so one made in
Blender drops into the same place. The loader for `.glb` heads hasn't been written yet: it comes
with the first Blender head (see [AVATAR_PLAN.md](../AVATAR_PLAN.md)).

## The head contract

Everything on a head (face, eyes, hair, beard, glasses, cap) hangs from the rig's **`head` joint**:

| | |
|---|---|
| Origin | The top of the neck: `HEAD_PIVOT` = (0, 1.55, 0) m on the standing body |
| Units | Metres |
| Axes | +y up, the face looking toward −z, the character's right hand at +x |
| Scale | Model at height scale 1. Each character's `height` in `looks.ts` scales the whole body, head included |

The joint turns and nods the whole head, so nothing on the head may hang from anything else.
`tests/avatar.test.ts` checks this: every mesh above the neck must be on the head joint.

Reference sizes, from the current procedural head:

| | Height above the floor (m) | Other |
|---|---|---|
| Top of the neck (pivot) | 1.55 | The neck is a 4.6–5.2 cm radius cylinder from 1.44 to 1.56; the head should cover its top |
| Middle of the head | 1.615 | About 19 cm wide, 22 cm tall, 20 cm deep |
| Eyes | 1.627 | 6.8 cm apart (x = ±0.034), front of the eyes at z ≈ −0.097 |
| Front of the face | | z ≈ −0.10 from the middle of the head |

## Workflow

1. **Get a reference.** Run `npm run dev`, open `/avatars.html`, pick the character and press
   **Download .glb**. It's the character standing in the rest pose at height scale 1, feet at the
   origin, with the joints named (`head`, `shoulder_R`, …).
2. **Import it into Blender** (File → Import → glTF 2.0) and leave it where it lands: don't move,
   turn or scale it. Blender converts the axes on import and converts them back on export, so
   anything modelled in place comes back in the right place. The character faces Blender's **+Y**,
   so use Back view (Ctrl + Numpad 1) to look at the face.
3. **Model the head in place** over the reference head, as new objects. Keep it light: roughly
   4,000–6,000 triangles and one or two textures of up to 1024 × 1024.
   - Match the skin colour to the character's `skin` in `looks.ts`, so the neck and hands match.
   - Make each eye a separate object named `eye_L` / `eye_R`, with its origin at the middle of the
     eyeball, so the eyes can follow the ball later.
   - A cap or glasses can be part of the model, or left to the code (`cap`, `glasses` in the look).
4. **Export only the head:** select the head objects, then File → Export → glTF 2.0 with Format
   *glTF Binary (.glb)*, Include → *Selected Objects*, Transform → *+Y Up* (the default) and
   Apply Modifiers on. Save it as `public/heads/<character>.glb` (e.g. `public/heads/paul.glb`).

The exported positions are on the standing body (as in the reference). The loader will move the
head onto the head joint by subtracting `HEAD_PIVOT`, put its materials in with the character's
own (so the see-through doubles partner fades it too, and it's freed with the character), and
remove the procedural head it replaces.

The heads are modelled on real people. If you build one from photos, check with the person first.
