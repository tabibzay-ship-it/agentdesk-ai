import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AgentDesk AI",
    template: "%s | AgentDesk AI",
  },
  description:
    "Create, train and deploy an AI customer support agent for your website.",
  applicationName: "AgentDesk AI",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
