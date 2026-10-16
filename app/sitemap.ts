import type { MetadataRoute } from "next";

const origin = "https://getagentdeskai.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: origin, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/login`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${origin}/register`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/forgot-password`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
