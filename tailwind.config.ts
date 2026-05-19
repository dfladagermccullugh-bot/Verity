import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        seed: {
          bg: "#0e1512",
          card: "#16211c",
          accent: "#6fcf97",
          accentDim: "#3f7d5c",
          text: "#e8f1ec",
          muted: "#9fb3a8",
        },
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
