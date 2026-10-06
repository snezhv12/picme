# PicMe — next improvements

## Instructions for Claude Code

- Read this whole file and compare it with the current code. Some of these may already be
  done; skip those and tell me which ones.
- Make a plan first, then build in the order below. Ask me before any big decision that
  isn't covered here.
- Keep the security model from the host PIN work: host actions stay server-side behind
  the PIN, and new SQL must not reopen permissions that `006_host_pin.sql` closed.
  Never ask me to re-run 002–005.
- Put each database change in a new numbered SQL file in `supabase/`, safe to run twice.
- At the end: run `npm run build`, fix errors, commit, and tell me exactly which SQL files
  to run, in which order, and what to test by hand.
- Don't deploy; I'll run `npx vercel --prod` myself (or connect Vercel to GitHub).

---

## 1. Bug: removing a player doesn't work

On /host, tapping × to remove the player "Aless 🤗" makes the page grey out for a second,
then nothing happens and the player stays. No error is shown.

- Find the cause (server action failing, a foreign key from photos/votes/reactions, the
  PIN/service-role permissions, or the emoji in the name) and fix it.
- Removing a player must cleanly handle their photos, votes, reactions and turn.
- Show an error message on the host if removing ever fails.
- Make the × tap target bigger on phones.

## 2. No duplicate players

When someone joins with a name that already exists (including different spelling or an
emoji), or opens the installed home-screen app after joining in the browser, offer
"Are you Alessandra? Continue as Alessandra" instead of creating a new player.

- Continuing as an existing player needs host approval, so nobody can take over someone
  else's name.
- The old device gets signed out.

## 3. Host sees who has voted

During voting, the host screen shows which players have already voted and who is still
missing: names with a check mark once they voted, greyed out while waiting.

- Never show who they voted for.
- The player whose photo is on screen doesn't vote; show them as "their photo".
- After voting, players' phones show the same list, so everyone sees who they're waiting for.

## 4. Reactions

- Under each photo on the phone, always show a small label "Send a reaction" with a row of
  emojis directly underneath: ❤️‍🩹 😂 🤭 💪🏻 💅 🐐 😮‍💨 and a "+" at the end that opens the
  phone's full emoji keyboard for any other emoji.
- Each player has one reaction per photo: tapping another emoji replaces it, tapping the
  same one again removes it. Highlight the one they chose.
- Show reactions as small bubbles with counts under the photo, on phones and on the host
  screen, updating live.
- During voting, show only emojis and counts (no names), so reactions don't give away who
  uploaded. After the reveal, tapping the reactions shows who reacted with what.
- Works during voting, reveal, and later in the gallery / past rounds.
- Everyone, including the uploader, can react. Reactions don't affect scores.

## 5. Written stories

After the reveal, the uploader gets an optional text field:
"Tell us the story (one word or a whole novel, up to you)".

- Not required: the game also works with stories told out loud.
- They can add or edit it later.
- Show it on the host, on phones, and in past rounds.

## 6. Two game modes: Party and Slow

The host chooses the mode in the lobby.

**Party mode (live, everyone at once):**
- Picking: 5 minutes, then automatically draw a Shuffle prompt and start the round.
- Uploading: the chosen timer, or with "No timer" a 10-minute safety limit.
- Voting: closes when everyone has voted, or after 3 minutes.
- Reveal: the uploader taps "Done, next photo" after their story; otherwise move on
  automatically after 2 minutes. The host can always press Next.

**Slow mode (casual, runs for days or weeks):**
- Picking: 12 hours. Uploading: 24 hours. Voting: 24 hours.
- Reveal stays until the next round starts.
- The host can change these times.

**For both modes:**
- Store all deadlines in the database and advance phases server-side with a scheduled
  Supabase pg_cron job (every minute), so the game moves on even when nobody has the app
  open.
- If nobody uploaded in a round, go straight to the next picker.
- After the last photo of a round, automatically go to the next round with the next picker.
- Show clear countdowns for every deadline on phones and the host.

## 7. Missed turns and coming back

- If the picker misses the deadline, start a Shuffle prompt and move the turn on.
  No penalty.
- After 2 missed turns in a row, mark the player "away" and skip them when picking until
  they upload, vote, or tap "I'm back". Show away players greyed out.
- A returning player sees the current state and can take part right away
  (upload if open, vote if open).
- Add a "Past rounds" history feed: photos, prompts, who uploaded, stories and reactions.
- Scores keep adding up across rounds and stay hidden until the host ends the game.

## 8. Late joiners

- While waiting for approval: show only "Game in progress · N players" (no names).
- Once let in: show the player names and the current state, e.g.
  "Round 3 is on: voting. You're in from the next upload."
  If uploads are still open, they can upload right away.

## 9. Push notifications

Web push notifications for the installed home-screen app:
"Your turn to pick", "New prompt: …", "Time to vote", "See who it was".

- Ask for permission with a button, not on page load.
- Players can turn notifications off.
- Explain to me exactly which keys or settings I need to add (locally and on Vercel).
