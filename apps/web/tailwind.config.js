const sharedPreset = require('@zentuva/config/tailwind/preset.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [sharedPreset],
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};
