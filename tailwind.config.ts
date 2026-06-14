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
        // Neutral charcoal hairline — the structural 1px stroke from the
        // Midnight Precision system. Flat, no gradient.
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
        "label-sm": [
          "12px",
          { lineHeight: "1.0", letterSpacing: "0.2em", fontWeight: "600" },
        ],
      },
      letterSpacing: {
        engrave: "0.25em",
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
        // Architectural & sharp: 0px grounds large surfaces, 4px is the only
        // tactile hint, reserved for interactive elements.
        none: "0px",
        sm: "2px",
        DEFAULT: "4px",
        md: "4px",
        lg: "4px",
        xl: "4px",
        full: "9999px",
        // Legacy aliases kept sharp so any missed usage stays on-system.
        md3: "4px",
        "md3-lg": "4px",
        "md3-xl": "0px",
      },
      boxShadow: {
        // No shadows in Midnight Precision — depth comes from tonal layering.
        "md3-1": "none",
        "md3-2": "none",
      },
      keyframes: {
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        pulseDot: {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        scanline: "scanline 8s linear infinite",
        "pulse-dot": "pulseDot 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
