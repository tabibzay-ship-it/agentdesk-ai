import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// This preview intentionally avoids shared Cloudflare storage bindings. The
// application persists customer data only in the isolated staging Supabase
// project, and every deployment must receive its credentials as Worker secrets.
export default defineCloudflareConfig();
