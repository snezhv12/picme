// Prompt categories the host picks from. Shuffle draws from all of them.
// To add a category, add an entry here. (Custom categories made by the host
// in the app are planned for later and can reuse this same shape.)
//
// A good prompt: everyone has that photo, it's findable in 20 seconds, it has
// a story, and the uploader usually isn't in it (so it's hard to guess).
// A hint is shown small on phones while uploading, never on the projector.
export type Prompt = { text: string; hint?: string };
export type Category = { id: string; name: string; prompts: Prompt[] };

export const CATEGORIES: Category[] = [
  {
    id: "chaos",
    name: "Camera roll chaos",
    prompts: [
      { text: "The 7th photo in your camera roll right now", hint: "Count back from the newest. No cheating." },
      { text: "Your most recent screenshot", hint: "Albums → Screenshots." },
      { text: "A photo you took by accident" },
      { text: "The most random thing you photographed this month" },
      { text: "A photo that makes zero sense without context" },
      { text: "Something you photographed so you wouldn't forget it" },
      { text: "The last photo you sent to someone" },
      { text: "A blurry photo you never deleted" },
    ],
  },
  {
    id: "everyday",
    name: "Everyday life",
    prompts: [
      { text: "The view from where you spend most of your day" },
      { text: "The last thing you bought that wasn't food" },
      { text: "Something that made you laugh this week" },
      { text: "An animal. Yours, a friend's, or a stranger's.", hint: 'Search "dog" or "cat" in Photos.' },
      { text: "A sky you stopped to take a photo of", hint: 'Search "sunset" or "sky".' },
      { text: "Your favorite corner of your home" },
      { text: "Something you see every single day" },
      { text: "Your outfit on a day you felt good" },
    ],
  },
  {
    id: "food",
    name: "Food",
    prompts: [
      { text: "The last thing you ate that was worth a photo", hint: 'Search "food" in Photos.' },
      { text: "Something you cooked yourself, proud or not" },
      { text: "Your go-to drink" },
      { text: "The best thing you ate on a trip" },
      { text: "A meal you'd never order again" },
      { text: "A late-night snack situation" },
      { text: "A café or restaurant you'd go back to tomorrow" },
      { text: "Dessert. Any dessert." },
    ],
  },
  {
    id: "throwback",
    name: "Throwbacks",
    prompts: [
      { text: "The oldest photo in your camera roll", hint: "Scroll all the way up in Library." },
      { text: "The first photo you took this year" },
      { text: "A photo from around this time last year" },
      { text: "A phase you've grown out of" },
      { text: "Your hair a few years ago" },
      { text: "A place you used to live or spend a lot of time" },
      { text: "A trend you were 100% part of" },
      { text: "A photo that brings back one specific memory" },
    ],
  },
  {
    id: "travel",
    name: "Travel",
    prompts: [
      { text: "The best view you've ever photographed" },
      { text: "A photo from your last trip" },
      { text: "An airport, train or road trip moment" },
      { text: "Somewhere you'd go back to tomorrow" },
      { text: "A trip where something went wrong" },
      { text: "The most touristy photo you own" },
      { text: "An animal you met while traveling" },
      { text: "Your favorite spot in your own city" },
    ],
  },
  {
    id: "nights",
    name: "Nights out",
    prompts: [
      { text: "Your last night out in one photo" },
      { text: "A concert, festival or event" },
      { text: "The best outfit you've worn out" },
      { text: "A group photo where someone wasn't ready" },
      { text: "The morning after" },
      { text: "A photo from a night you barely remember" },
      { text: "Something you only find funny at 2am" },
      { text: "The food you ate after a night out" },
    ],
  },
  {
    id: "embarrassing",
    name: "Embarrassing",
    prompts: [
      { text: "Your worst selfie" },
      { text: "A failed attempt at something (cooking, DIY, a haircut…)" },
      { text: "A photo someone took of you that you hate" },
      { text: "A mirror selfie you'd never post" },
      { text: "Proof of a bad decision" },
      { text: "Your most dramatic face" },
      { text: 'A photo you sent to someone asking "is this okay?"' },
      { text: "Something you bought and instantly regretted" },
    ],
  },
  {
    id: "wholesome",
    name: "Wholesome",
    prompts: [
      { text: "A moment you were genuinely happy this year" },
      { text: "Someone who makes your life better" },
      { text: "Something you're quietly proud of" },
      { text: "A small win nobody knows about" },
      { text: "A place where you feel calm" },
      { text: "A photo that always makes you smile" },
      { text: "A tradition you love" },
      { text: "The best day of your summer" },
    ],
  },
  {
    id: "birthday",
    name: "The birthday star",
    prompts: [
      { text: "Your first photo with the birthday star" },
      { text: "The funniest photo you have of them" },
      { text: "Your most recent photo with them" },
      { text: "A photo that reminds you of them, even if they're not in it" },
      { text: "A place you've been together" },
      { text: 'Them doing something very "them"' },
      { text: "The best memory you have with them" },
      { text: "A photo they'd ask you to delete" },
    ],
  },
];

export const SHUFFLE = "shuffle";

export type Pick = { prompt: string; category: string };

// Prompts from one category (or all, for Shuffle) not played yet this game,
// leaving out `avoid` (the prompt currently previewed)
export function unplayed(from: string, used: string[], avoid?: string): Pick[] {
  const cats = from === SHUFFLE ? CATEGORIES : CATEGORIES.filter((c) => c.id === from);
  return cats
    .flatMap((c) => c.prompts.map((p) => ({ prompt: p.text, category: c.id })))
    .filter((p) => !used.includes(p.prompt) && p.prompt !== avoid);
}

// Random unplayed prompt, or null when there are none left
export function pickPrompt(from: string, used: string[], avoid?: string): Pick | null {
  const list = unplayed(from, used, avoid);
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

export function categoryName(id: string | null | undefined) {
  return CATEGORIES.find((c) => c.id === id)?.name ?? null;
}

// Hint for a prompt from this list (none for the host's own prompts)
export function hintFor(prompt: string | null | undefined) {
  if (!prompt) return null;
  for (const c of CATEGORIES) {
    const hit = c.prompts.find((p) => p.text === prompt);
    if (hit) return hit.hint ?? null;
  }
  return null;
}
