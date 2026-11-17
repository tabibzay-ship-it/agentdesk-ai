import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/register", "/forgot-password"],
        disallow: [
          "/admin",
          "/api",
          "/agent",
          "/appointments",
          "/billing",
          "/business",
          "/chat",
          "/conversations",
          "/dashboard",
          "/install",
          "/knowledge",
          "/leads",
          "/reports",
          "/reset-password",
          "/settings",
          "/verify-reset-code",
          "/widget",
        ],
      },
    ],
    sitemap: "https://getagentdeskai.com/sitemap.xml",
    host: "https://getagentdeskai.com",
  };
}
