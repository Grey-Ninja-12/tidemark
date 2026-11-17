// Tidemark settings. Fill these in after creating your Supabase project (see README.md).
// While they are empty the app works on this device only, without sign-in or sync.
window.TIDEMARK_CONFIG = {
  // Supabase → Project Settings → API (Data API) → Project URL, e.g. "https://abcdefgh.supabase.co"
  supabaseUrl: "",

  // Supabase → Project Settings → API Keys → Publishable key ("sb_publishable_...").
  // On older projects the "anon" key works too. This key is safe to publish.
  supabaseKey: "",

  // The PUBLIC key from tools/generate-vapid-keys.html. Needed for reminders.
  vapidPublicKey: "",
};
