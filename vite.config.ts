import vinext from "vinext";
import { defineConfig } from "vite";
import { nitro } from "nitro/vite";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const isNitroBuild = Boolean(process.env.NITRO_PRESET);
export default defineConfig({
  server: isCodexSeatbeltSandbox
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined,
  plugins: [vinext(), ...(isNitroBuild ? [nitro()] : [])],
});
