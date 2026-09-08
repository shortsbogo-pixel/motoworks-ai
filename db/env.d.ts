declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    BOOTSTRAP_OWNER_EMAIL?: string;
    DATA_ENCRYPTION_KEY?: string;
    GEMINI_API_KEY?: string;
    GEMINI_VISION_MODEL?: string;
    GEMINI_BASE_URL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_VISION_MODEL?: string;
  }
}
