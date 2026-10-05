# PicMe — prompt upgrade

## Instructions for Claude Code

1. Replace all categories and prompts in the prompts file (e.g. `lib/prompts.ts`) with the
   list below. Keep the existing structure and anything other code depends on.
2. Each prompt can have an optional **hint** (the text after "Hint:"). Show it on the phone
   during the upload phase, small, under the prompt. Don't show hints on the projector.
3. Don't repeat a prompt within the same game. "Another prompt" and Shuffle should only
   draw prompts that haven't been played yet. Reset this when a new game starts.
4. Run `npm run build`, fix errors, commit.

## What makes a good PicMe prompt

- **Everyone has it.** No one should be stuck because they don't have that photo.
- **Findable in 20 seconds.** Recent photos, screenshots, or things the Photos app search
  finds by keyword (food, beach, dog, screenshot).
- **Has a story.** The photo should make people ask "wait, why?"
- **Hard to guess.** Best when the uploader isn't in the photo. Selfie prompts make guessing
  too easy, so there are only a few, for laughs.

---

## Camera roll chaos
- The 7th photo in your camera roll right now. Hint: Count back from the newest. No cheating.
- Your most recent screenshot. Hint: Albums → Screenshots.
- A photo you took by accident
- The most random thing you photographed this month
- A photo that makes zero sense without context
- Something you photographed so you wouldn't forget it
- The last photo you sent to someone
- A blurry photo you never deleted

## Everyday life
- The view from where you spend most of your day
- The last thing you bought that wasn't food
- Something that made you laugh this week
- An animal. Yours, a friend's, or a stranger's. Hint: Search "dog" or "cat" in Photos.
- A sky you stopped to take a photo of. Hint: Search "sunset" or "sky".
- Your favorite corner of your home
- Something you see every single day
- Your outfit on a day you felt good

## Food
- The last thing you ate that was worth a photo. Hint: Search "food" in Photos.
- Something you cooked yourself, proud or not
- Your go-to drink
- The best thing you ate on a trip
- A meal you'd never order again
- A late-night snack situation
- A café or restaurant you'd go back to tomorrow
- Dessert. Any dessert.

## Throwbacks
- The oldest photo in your camera roll. Hint: Scroll all the way up in Library.
- The first photo you took this year
- A photo from around this time last year
- A phase you've grown out of
- Your hair a few years ago
- A place you used to live or spend a lot of time
- A trend you were 100% part of
- A photo that brings back one specific memory

## Travel
- The best view you've ever photographed
- A photo from your last trip
- An airport, train or road trip moment
- Somewhere you'd go back to tomorrow
- A trip where something went wrong
- The most touristy photo you own
- An animal you met while traveling
- Your favorite spot in your own city

## Nights out
- Your last night out in one photo
- A concert, festival or event
- The best outfit you've worn out
- A group photo where someone wasn't ready
- The morning after
- A photo from a night you barely remember
- Something you only find funny at 2am
- The food you ate after a night out

## Embarrassing
- Your worst selfie
- A failed attempt at something (cooking, DIY, a haircut…)
- A photo someone took of you that you hate
- A mirror selfie you'd never post
- Proof of a bad decision
- Your most dramatic face
- A photo you sent to someone asking "is this okay?"
- Something you bought and instantly regretted

## Wholesome
- A moment you were genuinely happy this year
- Someone who makes your life better
- Something you're quietly proud of
- A small win nobody knows about
- A place where you feel calm
- A photo that always makes you smile
- A tradition you love
- The best day of your summer

## The birthday star
- Your first photo with the birthday star
- The funniest photo you have of them
- Your most recent photo with them
- A photo that reminds you of them, even if they're not in it
- A place you've been together
- Them doing something very "them"
- The best memory you have with them
- A photo they'd ask you to delete
