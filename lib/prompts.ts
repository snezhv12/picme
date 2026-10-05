// Prompt categories the host picks from. Shuffle draws from all of them.
// To add a category, add an entry here. (Custom categories made by the host
// in the app are planned for later and can reuse this same shape.)
export type Category = { id: string; name: string; prompts: string[] };

export const CATEGORIES: Category[] = [
  {
    id: "chaos",
    name: "Camera roll chaos",
    prompts: [
      "The oldest photo in your camera roll",
      "Your most chaotic screenshot",
      "A photo that needs context",
      "The 7th photo in your camera roll",
      "A photo you took by accident",
      "A screenshot you can't explain",
      "The blurriest photo you still kept",
    ],
  },
  {
    id: "food",
    name: "Food",
    prompts: [
      "The last thing you ate",
      "A meal you regret",
      "Your fridge, right now",
      "A meal you're proud of",
      "The worst thing you ever cooked",
      "A drink you'd order again",
      "Food from a trip",
    ],
  },
  {
    id: "throwback",
    name: "Throwbacks",
    prompts: [
      "The oldest photo of yourself",
      "Your worst haircut",
      "A photo from 5+ years ago",
      "A photo from exactly a year ago",
      "A photo from school or uni days",
      "An outfit you'd never wear again",
    ],
  },
  {
    id: "travel",
    name: "Travel",
    prompts: [
      "The best view you've seen",
      "A trip that went wrong",
      "Where you'd go tomorrow",
      "A photo from the furthest place you've been",
      "Your best holiday outfit",
      "An airport or train station moment",
    ],
  },
  {
    id: "nights",
    name: "Nights out",
    prompts: [
      "Your blurriest night-out photo",
      "The last party you went to",
      "The best group photo you have",
      "A photo from 2am",
      "A friend mid-sentence",
      "Proof of a bad decision",
    ],
  },
  {
    id: "embarrassing",
    name: "Embarrassing",
    prompts: [
      "Your worst selfie",
      "A photo you'd never post",
      "Something you bought and regret",
      "Your most dramatic selfie",
      "A photo you took for a dating profile",
      "Your most awkward photo with a celebrity or mascot",
    ],
  },
  {
    id: "birthday",
    name: "The birthday star",
    prompts: [
      "A photo with the birthday person",
      "Your favorite memory with them",
      "The birthday person at their best",
      "The birthday person at their worst",
      "Something that reminds you of them",
      "The oldest photo you have with them",
    ],
  },
];

export const SHUFFLE = "shuffle";

export type Pick = { prompt: string; category: string };

// Random prompt from one category (or all), avoiding ones already played this
// game and the one currently shown, unless there's nothing else left.
export function pickPrompt(from: string, used: string[], avoid?: string): Pick | null {
  const pool: Pick[] =
    from === SHUFFLE
      ? CATEGORIES.flatMap((c) => c.prompts.map((prompt) => ({ prompt, category: c.id })))
      : (CATEGORIES.find((c) => c.id === from)?.prompts ?? []).map((prompt) => ({
          prompt,
          category: from,
        }));
  const fresh = pool.filter((p) => !used.includes(p.prompt) && p.prompt !== avoid);
  const notSame = pool.filter((p) => p.prompt !== avoid);
  const list = fresh.length ? fresh : notSame.length ? notSame : pool;
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

export function categoryName(id: string | null | undefined) {
  return CATEGORIES.find((c) => c.id === id)?.name ?? null;
}
