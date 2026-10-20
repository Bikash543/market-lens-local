import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Market Lens · Futures Intelligence",
  description: "Live futures screening with open interest, funding, CVD and market dominance.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{__html:"try{document.documentElement.dataset.theme=localStorage.getItem('market-lens-theme')==='dark'?'dark':'light'}catch{}"}}/></head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
