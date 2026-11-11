import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--tg-theme-bg-color, #0f172a)",
        surface: "var(--tg-theme-secondary-bg-color, #1e293b)",
        text: "var(--tg-theme-text-color, #f8fafc)",
        hint: "var(--tg-theme-hint-color, #94a3b8)",
        link: "var(--tg-theme-link-color, #60a5fa)",
        button: "var(--tg-theme-button-color, #f59e0b)",
        "button-text": "var(--tg-theme-button-text-color, #0f172a)",
        danger: "var(--tg-theme-destructive-text-color, #f87171)",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      animation: {
        "coin-pop": "coin-pop 220ms ease-out",
      },
      keyframes: {
        "coin-pop": {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(0.94)" },
          "100%": { transform: "scale(1)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
