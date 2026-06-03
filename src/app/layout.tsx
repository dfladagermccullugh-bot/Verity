import type { Metadata, Viewport } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import ThemeToggle from "@/components/theme-toggle";

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  axes: ["SOFT", "opsz"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Idea Seeder",
  description: "Plant an idea. Answer a few yes/no questions. We do the rest.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7FCF5" },
    { media: "(prefers-color-scheme: dark)", color: "#101411" },
  ],
};

const prePaintScript = `
(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fraunces.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: prePaintScript }} />
      </head>
      <body className="min-h-full bg-surface font-sans text-on-surface">
        <ThemeToggle />
        {children}
      </body>
    </html>
  );
}
