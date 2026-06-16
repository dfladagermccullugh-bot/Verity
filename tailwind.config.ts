import type { Config } from "tailwindcss";

const token = (name: string) => `rgb(var(--md-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: token("primary"),
        "on-primary": token("on-primary"),
        "primary-container": token("primary-container"),
        "on-primary-container": token("on-primary-container"),
        secondary: token("secondary"),
        "on-secondary": token("on-secondary"),
        "secondary-container": token("secondary-container"),
        "on-secondary-container": token("on-secondary-container"),
        surface: token("surface"),
        "on-surface": token("on-surface"),
        "surface-variant": token("surface-variant"),
        "on-surface-variant": token("on-surface-variant"),
        "surface-container-lowest": token("surface-container-lowest"),
        "surface-container-low": token("surface-container-low"),
        "surface-container": token("surface-container"),
        "surface-container-high": token("surface-container-high"),
        "surface-container-highest": token("surface-container-highest"),
        outline: token("outline"),
        "outline-variant": token("outline-variant"),
        // Hairline — the structural 1px stroke (#e9e9e7 in light).
        hairline: token("hairline"),
        error: token("error"),
        "on-error": token("on-error"),
        "error-container": token("error-container"),
        "on-error-container": token("on-error-container"),
        "inverse-surface": token("inverse-surface"),
        "inverse-on-surface": token("inverse-on-surface"),
        "inverse-primary": token("inverse-primary"),
      },
      fontFamily: {
        sans: [
          "var(--font-inter)",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        // Display uses the same neutral Inter face — hierarchy comes from
        // scale, not font variety (Technical Minimalism).
        display: ["var(--font-inter)", "Inter", "ui-sans-serif", "sans-serif"],
      },
      fontSize: {
        "display-xl": [
          "72px",
          { lineHeight: "1.1", letterSpacing: "-0.04em", fontWeight: "600" },
        ],
        "display-lg": [
          "48px",
          { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        "display-lg-mobile": [
          "32px",
          { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" },
        ],
        "headline-md": [
          "24px",
          { lineHeight: "1.4", letterSpacing: "-0.01em", fontWeight: "600" },
        ],
        "body-lg": ["18px", { lineHeight: "1.6", fontWeight: "400" }],
        "body-md": ["16px", { lineHeight: "1.6", fontWeight: "400" }],
        // Calm small label — normal tracking, medium weight (no engraved caps).
        "label-sm": [
          "12.5px",
          { lineHeight: "1.4", letterSpacing: "0", fontWeight: "500" },
        ],
      },
      spacing: {
        gutter: "24px",
        "margin-mobile": "16px",
        "margin-desktop": "64px",
      },
      maxWidth: {
        frame: "1440px",
      },
      borderRadius: {
        // Soft, friendly radii. Controls round at 6px, cards at 8–12px,
        // pills/avatars fully round.
        none: "0px",
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "12px",
        xl: "16px",
        "2xl": "20px",
        full: "9999px",
        // Legacy aliases remapped onto the soft scale.
        md3: "8px",
        "md3-lg": "12px",
        "md3-xl": "16px",
      },
      boxShadow: {
        // Soft, layered elevation — calm depth, never heavy.
        "elevation-1":
          "0 1px 2px rgb(15 15 15 / 0.06), 0 1px 3px rgb(15 15 15 / 0.04)",
        "elevation-2":
          "0 2px 4px rgb(15 15 15 / 0.06), 0 4px 12px rgb(15 15 15 / 0.08)",
        "elevation-3":
          "0 8px 24px rgb(15 15 15 / 0.12), 0 2px 8px rgb(15 15 15 / 0.06)",
        // Legacy aliases mapped onto the new elevation stack.
        "md3-1":
          "0 1px 2px rgb(15 15 15 / 0.06), 0 1px 3px rgb(15 15 15 / 0.04)",
        "md3-2":
          "0 2px 4px rgb(15 15 15 / 0.06), 0 4px 12px rgb(15 15 15 / 0.08)",
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "pulse-dot": "pulseDot 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
