
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://getagentdeskai.com"),
  title: {
    default: "AgentDesk AI",
    template: "%s | AgentDesk AI",
  },
  description:
    "Create, train and deploy an AI customer support agent for your website.",
  applicationName: "AgentDesk AI",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "AgentDesk AI",
    title: "AgentDesk AI — AI customer support for your website",
    description: "Create, train and deploy an AI customer support agent for your website.",
  },
  twitter: {
    card: "summary",
    title: "AgentDesk AI — AI customer support for your website",
    description: "Create, train and deploy an AI customer support agent for your website.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('agentdesk-theme');if(t!=='light'&&t!=='dark'&&t!=='system')t='system';var r=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;document.documentElement.dataset.theme=r;document.documentElement.style.colorScheme=r}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
