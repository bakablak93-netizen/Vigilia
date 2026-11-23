/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        lab: {
          bg: "#F7F9FB",
          surface: "#FFFFFF",
          primary: "#142B34",
          accent: "#087F70",
          text: "#17262E",
          muted: "#71818B",
          border: "#E4E9ED",
          danger: "#D95B5B",
          warning: "#D99A36",
          success: "#16886E",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};
