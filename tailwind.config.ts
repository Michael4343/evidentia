import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}" 
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#3B82F6",
          foreground: "#F8FAFC"
        },
        surface: {
          DEFAULT: "#FFFFFF",
          subtle: "#F1F5F9"
        },
        accent: {
          DEFAULT: "#22D3EE"
        }
      }
    }
  },
  plugins: []
};

export default config;
