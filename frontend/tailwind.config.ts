import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Iosevka"', '"Cascadia Code"', '"Fira Code"', '"SF Mono"', "Menlo", "Monaco", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
