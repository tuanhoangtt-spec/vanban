import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1c2430",
        paper: "#f7f6f3",
        accent: "#2f5d50",
        accentSoft: "#e4ede9",
        warn: "#b3541e",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "sans-serif"],
        serif: ["var(--font-serif)", "serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(28,36,48,0.06), 0 8px 24px rgba(28,36,48,0.06)",
      },
    },
  },
  plugins: [],
};
export default config;
