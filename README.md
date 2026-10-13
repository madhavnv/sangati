# Sangati (ಸಂಗತಿ)

One song, many voices.

Type the first line of a devaranama, pick a singer, and the most-viewed matching YouTube recording plays inside the page.

## Deploy (about 10 minutes, free tier)

1. Get a YouTube Data API v3 key: Google Cloud Console > create project > enable "YouTube Data API v3" > Credentials > API key.
2. Put this folder in a GitHub repo, or run `npx vercel` inside it.
3. In Vercel, add the environment variable `YOUTUBE_API_KEY` with your key, then deploy.
4. Open the Vercel URL on your phone.

## How it picks a video

`api/find.js` searches YouTube for "<song> <singer>" (music category, embeddable only), keeps results whose title or channel contains the singer's name and at least half the song's words, and returns the five with the most views. The page plays the first and offers "Not this one" for the rest.

## Limits to plan for

- A YouTube search costs 100 quota units and the free daily quota is 10,000, so about 100 fresh lookups a day. Results are cached at the edge for a week and in each visitor's browser. For real traffic, store the chosen video id per song and singer in a database and look it up there first.
- "Most viewed" can pick a wrong video (a different song with the same singer). The "Not this one" button is the fix for now. Later, let users vote a video up and store the winner.
- Singers added by visitors are saved in their own browser only. Sharing them needs a database (Supabase or Vercel KV).
- Follow YouTube's API Services terms of service when storing or showing results.
