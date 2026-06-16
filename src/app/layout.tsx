import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Verity",
  description:
    "A constrained-interview tool: one sentence in, a structured brief out — answered with only yes, no, or done.",
  robots: { index: false, follow: false },
};

// Set the persisted theme before paint to avoid a light/dark flash. Absent an
// explicit choice, the OS preference (handled in globals.css) applies.
const noFlashTheme = `try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}`;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Do not cap zoom — pinch/text-zoom must stay available (WCAG 1.4.4).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-full bg-surface font-sans text-on-surface antialiased">
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
        {children}
      </body>
    </html>
  );
}
