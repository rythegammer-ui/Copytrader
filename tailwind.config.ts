import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bcdbff",
          300: "#8ec4ff",
          400: "#59a3ff",
          500: "#327eff",
          600: "#1b5ef5",
          700: "#1449e1",
          800: "#173cb6",
          900: "#19388f",
          950: "#142457",
        },
      },
    },
  },
  plugins: [],
};
export default config;
