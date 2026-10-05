# PicMe — full feature list

Build everything in this file. Compare it with the current code first and implement
whatever is missing or different. Keep the existing stack (Next.js, Supabase, Vercel).

## Game phases

The whole game runs on one shared phase in `game_state`, so the projector and every
phone always show the same step:

`lobby` → `uploading` → `voting` → `reveal` → (next photo: `voting` again) → back to `lobby`
for the next round, or `scoreboard` at the end of the game.

---

## Host screen (`/host`, on the projector)

Big type, readable from across the room. The main button for each phase can also be
triggered with Space or → on the keyboard.

### 1. Lobby (between rounds)
- PicMe logo
- QR code to join, with the plain link written underneath (for phones that can't scan)
- Player list with live count; each name has a small ✕ to remove that player
- **Category picker:** one button per category, plus **Shuffle** (random prompt from all categories)
- **Prompt preview:** shows the drawn prompt before the round starts
- **Another prompt** button: draws a new prompt from the same category
- **Write my own** input: host can type a one-off prompt instead
- **Timer setting:** 20 s / 40 s / 60 s, default 20 s
- **Start round** button (main action)
- **End game** button → goes to the final scoreboard

### 2. Uploading
- Category name and prompt, very large
- Big countdown, synced across all devices (based on a server timestamp, not local timers)
- Upload counter: "5 of 8 photos in" (no names)
- QR code stays visible for latecomers
- **+10 seconds** button
- **End timer now** button
- Automatically moves on when the timer hits zero or when every player has uploaded
- If nobody uploaded, show "No photos this round" and a **Back to lobby** button

### 3. Voting (one photo at a time)
- The round's prompt stays on top of every photo
- Photo shown large in an instant-photo frame, random order
- "Photo 2 of 6"
- Vote counter: "4 of 7 voted" (never show who voted for what)
- **Close voting** button (main action); voting also closes automatically once everyone has voted

### 4. Reveal
- Same photo and prompt
- Uploader's name appears as a handwritten caption on the photo frame, with
  "Tell us the story" underneath
- Do NOT show who guessed right or how anyone voted
- **Next photo** button (main action) → back to Voting with the next photo
- After the last photo: **Next round** (back to lobby) and **End game** (scoreboard)

### 5. Final scoreboard
- Ranked list of all players with points, winner highlighted, one confetti moment
- **See all photos**: gallery of every photo from the game, each with its prompt and uploader
- **Play again**: same players, scores reset to zero
- **New game**: removes all players, photos and votes

---

## Player screen (`/`, on phones)

Mobile-first, big tap targets, works in iPhone Safari and Android Chrome.

### 1. Join
- Name input and **Join game** button
- Reject duplicate names with a clear message ("That name is taken. Add an initial.")
- Player stays logged in after refreshing the page
- If the host removed them or started a new game, show the join screen again

### 2. Waiting (lobby)
- "You're in, {name}." / "The next prompt shows up here."

### 3. Uploading
- Category name, prompt, and the same synced countdown as the projector
- **Choose a photo** button (camera or gallery)
- After upload: preview of their photo and **Change photo** button (until time runs out)
- When time is up, upload controls disappear:
  - uploaded: "Time's up. Your photo is in."
  - not uploaded: "Time's up. You'll be in the next round."
- Uploads after the deadline must be rejected by the database too, not only hidden in the UI
- Photos are shrunk on the phone before upload (max ~1600 px JPEG); HEIC from iPhones must work

### 4. Voting
- Small version of the current photo, with "Who took this?"
- One button per player name (excluding themselves)
- If it's their own photo: "This one's yours. Keep a straight face." and no buttons
- After tapping: "Vote sent" with the chosen name; they can change the vote until voting closes
- Players who didn't upload this round can still vote

### 5. Reveal
- "Eyes on the big screen."

### 6. Scoreboard
- Their own rank and points, plus the full ranked list

---

## Scoring

- +1 point for each correct guess
- Scores are hidden during the game and only shown on the final scoreboard

## Prompts and categories

Store categories and prompts in one easy-to-edit file (e.g. `lib/prompts.ts`), with
6–8 prompts per category. Starting categories:

- Camera roll chaos (oldest photo, most chaotic screenshot, a photo that needs context)
- Food (last thing you ate, a meal you regret, your fridge right now)
- Throwbacks (oldest photo of yourself, your worst haircut, a photo from 5+ years ago)
- Travel (best view you've seen, a trip that went wrong, where you'd go tomorrow)
- Nights out (blurriest night-out photo, the last party you went to)
- Embarrassing (worst selfie, a photo you'd never post)
- The birthday star (a photo with the birthday person, your favorite memory with them)

Custom categories created by the host are planned for later. Don't build that yet, but keep
the structure easy to extend.

## Design

- Light pink as the main background color
- Dark text (deep berry or near-black) so everything stays readable on a projector
- Keep the instant-photo frames and the handwritten captions
- Phone and projector should look like the same app

## Database

- Design the schema changes needed (e.g. phase and timer in `game_state`/`rounds`,
  a `votes` table with one vote per player per photo)
- Give me the SQL to run in the Supabase SQL Editor, and also save it in `supabase/`
- Enable realtime for any new tables

## When you're done

- Run `npm run build` and fix all errors
- Commit the work (never commit `.env.local`)
- Tell me exactly which SQL I need to run and anything I need to test by hand
- Don't deploy; I'll run `npx vercel --prod` myself
